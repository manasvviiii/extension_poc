import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import main


class BackendArchitectureTests(unittest.TestCase):
    def setUp(self):
        main.STORAGE_BACKEND = "json"
        main._POSTGRES_REPOSITORY = None
        self.temp_dir = Path(tempfile.mkdtemp())
        main.DATA_DIR = self.temp_dir / "networks"
        main.JOBS_DIR = self.temp_dir / "jobs"
        main.AUDIT_DIR = self.temp_dir / "audit"
        main.DEALS_DIR = self.temp_dir / "deals"
        for path in (main.DATA_DIR, main.JOBS_DIR, main.AUDIT_DIR, main.DEALS_DIR):
            path.mkdir(parents=True, exist_ok=True)
        main.GRAPHS.clear()
        main.JOBS.clear()

    def import_owner(self, owner_id, count=10):
        connections = [
            {
                "name": f"Direct Person {index}",
                "profile_url": f"https://example.test/in/direct-{owner_id}-{index}",
                "headline": "CFO at Example Corp" if index == 0 else "Engineer",
                "company": "Example Corp" if index == 0 else "Other Co",
                "connection_date": "January 1, 2026",
                "source": "fixture",
            }
            for index in range(count)
        ]
        evidence = [{
            "name": "Target Person",
            "profile_url": f"https://example.test/in/target-{owner_id}",
            "observed_degree": "2nd",
            "mutual_connection_names": ["Direct Person 0"],
            "mutual_connections_text": "Direct Person 0 is a mutual connection",
            "evidence_type": "mutual_connection_ui",
            "source": "fixture",
            "page_url": "fixture://search",
            "captured_at": "2026-01-02T00:00:00Z",
        }, {
            "name": "Third Person",
            "profile_url": f"https://example.test/in/third-{owner_id}",
            "observed_degree": "3rd+",
            "evidence_type": "degree_indicator",
            "source": "fixture",
        }]
        return main.import_network(main.ImportRequest(
            owner_id=owner_id,
            source="fixture",
            connections=connections,
            relationship_evidence=evidence,
            confirmed=True,
        ))

    def test_owner_isolation_and_two_hop(self):
        self.import_owner("owner_a", 201)
        self.import_owner("owner_b", 10)
        graph_a = main.get_owner_graph("owner_a")
        graph_b = main.get_owner_graph("owner_b")
        self.assertEqual(sum(data.get("relationship") == "KNOWS" for _, _, data in graph_a.edges(data=True)), 201)
        self.assertNotIn("https://example.test/in/direct-owner_b-0", graph_a)
        observed = [data for _, _, data in graph_a.edges(data=True) if data.get("relationship") == "OBSERVED_MUTUAL"]
        self.assertEqual(len(observed), 1)
        self.assertNotIn("https://example.test/in/direct-owner_a-0", graph_b)

    def test_delta_is_idempotent(self):
        request = main.ImportRequest(
            owner_id="delta",
            source="fixture",
            added_connections=[{"name": "A", "profile_url": "https://example.test/in/a"}],
            confirmed=True,
        )
        main.import_network(request)
        main.import_network(request)
        self.assertEqual(len(main.load_network("delta")["connections"]), 1)
        self.assertEqual(main.get_owner_graph("delta").number_of_edges(), 1)

    def test_warmth_and_no_path(self):
        self.import_owner("warm")
        result = main.find_paths(main.PathRequest(
            owner_id="warm",
            source_id="warm",
            target_id="https://example.test/in/target-warm",
            cutoff=4,
        ))
        self.assertEqual(result["paths"][0]["hop_count"], 2)
        self.assertLess(result["paths"][0]["warmth"], 1.0)
        main.get_owner_graph("warm").add_node("https://example.test/in/orphan")
        no_path = main.find_paths(main.PathRequest(
            owner_id="warm",
            source_id="warm",
            target_id="https://example.test/in/orphan",
            cutoff=4,
        ))
        self.assertEqual(no_path["paths"], [])

    def test_graph_view_accepts_url_shaped_owner_id(self):
        owner_id = "https://www.linkedin.com/in/manasvi-p-8a88402ab"
        main.GRAPHS[owner_id] = main.nx.DiGraph()
        main.GRAPHS[owner_id].add_node(owner_id, label=owner_id)

        response = main.graph_view_query(owner_id)

        route_paths = [route.path for route in main.app.routes]
        self.assertIn("/graph/view", route_paths)
        self.assertLess(
            route_paths.index("/graph/view"),
            route_paths.index("/graph/{owner_id}"),
        )
        self.assertIn(response.status_code, {200, 500})
        self.assertNotIn("No graph found", response.body.decode())

    def test_edge_scoring_variants(self):
        recent = main.score_graph_edge(
            {"relationship": "KNOWS", "connection_date": "2026-01-01"},
            main.date(2026, 1, 2),
        )
        older = main.score_graph_edge(
            {"relationship": "KNOWS", "connection_date": "2024-01-01"},
            main.date(2026, 1, 2),
        )
        no_date = main.score_graph_edge(
            {"relationship": "KNOWS", "connection_date": None},
            main.date(2026, 1, 2),
        )
        one_mutual = main.score_graph_edge({
            "relationship": "OBSERVED_MUTUAL",
            "observed_degree": "2nd",
            "mutual_connection_count": 1,
            "evidence_type": "mutual_connection_ui",
            "source": "linkedin_dom",
        }, None)
        multiple_mutuals = main.score_graph_edge({
            "relationship": "OBSERVED_MUTUAL",
            "observed_degree": "2nd",
            "mutual_connection_count": 3,
            "evidence_type": "mutual_connection_ui",
            "source": "linkedin_dom",
        }, None)

        self.assertGreater(recent["score"], older["score"])
        self.assertEqual(no_date["score"], 1.0)
        self.assertGreater(multiple_mutuals["score"], one_mutual["score"])
        self.assertEqual(
            multiple_mutuals["features"]["mutual_connection_count"],
            3,
        )
        self.assertIn("mutual-count bonus", multiple_mutuals["explanation"])

    def test_path_warmth_is_product_and_paths_sort_by_warmth(self):
        graph = main.nx.DiGraph()
        graph.add_edge(
            "warm",
            "short",
            relationship="KNOWS",
            connection_date="2026-01-01",
        )
        graph.add_edge(
            "short",
            "target",
            relationship="OBSERVED_MUTUAL",
            observed_degree="2nd",
            mutual_connection_count=1,
            evidence_type="mutual_connection_ui",
            source="linkedin_dom",
        )
        graph.add_edge(
            "warm",
            "long-a",
            relationship="KNOWS",
            connection_date="2026-01-01",
        )
        graph.add_edge(
            "long-a",
            "long-b",
            relationship="KNOWS",
            connection_date="2026-01-01",
        )
        graph.add_edge(
            "long-b",
            "target",
            relationship="OBSERVED_MUTUAL",
            observed_degree="2nd",
            mutual_connection_count=3,
            evidence_type="mutual_connection_ui",
            source="linkedin_dom",
        )
        main.GRAPHS["warm"] = graph

        result = main.find_paths(main.PathRequest(
            owner_id="warm",
            source_id="warm",
            target_id="target",
            cutoff=4,
        ))

        paths_by_second_node = {
            path["path"][1]: path
            for path in result["paths"]
        }
        short_path = paths_by_second_node["short"]
        long_path = paths_by_second_node["long-a"]
        expected_short_warmth = 1.0 * main.score_graph_edge(
            graph["short"]["target"], main.date(2026, 1, 1)
        )["score"]
        self.assertEqual(short_path["warmth"], round(expected_short_warmth, 6))
        self.assertEqual(
            short_path["warmth"],
            round(
                short_path["edges"][0]["score"]
                * short_path["edges"][1]["score"],
                6,
            ),
        )
        self.assertGreaterEqual(long_path["warmth"], short_path["warmth"])
        self.assertEqual(result["paths"][0]["path"][1], "long-a")

    def test_target_search_and_deal(self):
        self.import_owner("targets")
        result = main.search_targets(main.TargetSearchRequest(
            owner_id="targets", company="Example Corp", deal_side="sell_side"
        ))
        self.assertEqual(result["candidates"][0]["matched_role"], "CFO")
        deal = main.create_deal(main.DealRequest(
            owner_id="targets", side="sell_side", target_company="Example Corp"
        ))
        self.assertEqual(main.get_deal("targets", deal["id"])["id"], deal["id"])

    def test_refresh_job_fails_without_approved_provider(self):
        result = main.refresh(main.RefreshRequest(owner_id="missing"))
        job = main.get_job(result["job_id"])
        self.assertIn(job["status"], {"running", "failed"})


if __name__ == "__main__":
    unittest.main()
