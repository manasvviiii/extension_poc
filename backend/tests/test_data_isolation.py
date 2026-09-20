import json
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import main
from auth.context import AuthContext


class DataIsolationRegressionTests(unittest.TestCase):
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
        self.client = TestClient(main.app)

        self.owner_id = "real_user_owner"
        self.imported_connections = [
            {
                "name": "MahaSkanda S",
                "profile_url": "https://www.linkedin.com/in/mahaskanda-s-4648a1288",
                "headline": "AI & ML Engineering Student | Python",
                "degree": "1st",
                "connection_date": "September 19, 2026",
                "source": "linkedin_dom",
            },
            {
                "name": "Tharun B R",
                "profile_url": "https://www.linkedin.com/in/tharun-b-r-8a670134b",
                "headline": "AI & Data Science Student",
                "degree": "1st",
                "connection_date": "September 17, 2026",
                "source": "linkedin_dom",
            },
            {
                "name": "Jeevith Gowda S R",
                "profile_url": "https://www.linkedin.com/in/jeevith-gowda-sr",
                "headline": "CTO & Co-founder @Blinklean",
                "degree": "1st",
                "connection_date": "September 15, 2026",
                "source": "linkedin_dom",
            },
        ]
        self.imported_evidence = [
            {
                "name": "Real Target Person",
                "profile_url": "https://www.linkedin.com/in/real-target-person",
                "observed_degree": "2nd",
                "headline": "Head of Corporate Development at Blinklean",
                "mutual_connection_names": ["Jeevith Gowda S R"],
                "mutual_connections_text": "Jeevith Gowda S R is a mutual connection",
                "evidence_type": "mutual_connection_ui",
                "source": "linkedin_dom",
            }
        ]

    def _import_real_network(self):
        import_response = self.client.post(
            "/network/import",
            json={
                "owner_id": self.owner_id,
                "source": "linkedin_dom",
                "confirmed": True,
                "connections": self.imported_connections,
                "relationship_evidence": self.imported_evidence,
            },
        )
        self.assertEqual(import_response.status_code, 200)
        return import_response.json()

    def test_startup_does_not_load_synthetic_demo_data(self):
        main.rebuild_all_graphs()
        self.assertNotIn("final_demo_owner", main.GRAPHS)
        self.assertNotIn("test_owner", main.GRAPHS)

    def test_imported_network_is_source_of_truth_and_no_synthetic_leakage(self):
        self._import_real_network()

        network_response = self.client.get(f"/network/{self.owner_id}")
        self.assertEqual(network_response.status_code, 200)
        data = network_response.json()
        names = [c["name"] for c in data["connections"]]
        self.assertIn("MahaSkanda S", names)
        self.assertNotIn("Person C", names)
        self.assertNotIn("Person A", names)
        self.assertNotIn("Target Person", [e["name"] for e in data["relationship_evidence"]])

    def test_target_search_uses_imported_records_only(self):
        self._import_real_network()

        # Search for real target at Blinklean
        search_res = self.client.post(
            "/target/search",
            json={
                "owner_id": self.owner_id,
                "company": "Blinklean",
                "deal_side": "buy_side",
            },
        )
        self.assertEqual(search_res.status_code, 200)
        candidates = search_res.json()["candidates"]
        self.assertTrue(len(candidates) > 0)
        self.assertEqual(candidates[0]["name"], "Real Target Person")
        self.assertNotIn("Target Person", [c["name"] for c in candidates])

    def test_nonexistent_target_returns_no_match(self):
        self._import_real_network()

        # Search for non-existent company
        search_res = self.client.post(
            "/target/search",
            json={
                "owner_id": self.owner_id,
                "company": "Company B",
                "deal_side": "sell_side",
            },
        )
        self.assertEqual(search_res.status_code, 200)
        body = search_res.json()
        self.assertEqual(body["candidates"], [])
        self.assertEqual(body.get("message"), "No matching target found in your imported network.")

    def test_warm_path_and_explain_path_only_use_imported_nodes(self):
        self._import_real_network()

        path_res = self.client.post(
            "/graph/path",
            json={
                "owner_id": self.owner_id,
                "source_id": self.owner_id,
                "target_id": "https://www.linkedin.com/in/real-target-person",
                "cutoff": 4,
            },
        )
        self.assertEqual(path_res.status_code, 200)
        paths = path_res.json()["paths"]
        self.assertTrue(len(paths) > 0)
        for node in paths[0]["path"]:
            self.assertNotIn("person-c", node)
            self.assertNotIn("person-a", node)

        explain_res = self.client.post(
            "/graph/explain-path",
            json={
                "owner_id": self.owner_id,
                "source_id": self.owner_id,
                "target_id": "https://www.linkedin.com/in/real-target-person",
            },
        )
        self.assertEqual(explain_res.status_code, 200)
        explanation = explain_res.json()
        self.assertIn("real-target-person", str(explanation))
        self.assertNotIn("person-c", str(explanation))

    def test_graph_view_uses_imported_graph(self):
        self._import_real_network()

        # Test path-based graph view
        view_res = self.client.get(f"/graph/{self.owner_id}/view")
        self.assertEqual(view_res.status_code, 200)
        html = view_res.text
        self.assertIn("MahaSkanda S", html)
        self.assertNotIn("Person C", html)
        self.assertNotIn("https://www.linkedin.com/in/target-person", html)
        self.assertNotIn("Isolated Target", html)

        # Test query-param based graph view
        query_view_res = self.client.get(f"/graph/view?owner_id={self.owner_id}")
        self.assertEqual(query_view_res.status_code, 200)
        query_html = query_view_res.text
        self.assertIn("MahaSkanda S", query_html)
        self.assertNotIn("Person C", query_html)
        self.assertNotIn("https://www.linkedin.com/in/target-person", query_html)
        self.assertNotIn("Isolated Target", query_html)

    def test_owner_and_tenant_isolation(self):
        self._import_real_network()

        # Other owner cannot access real_user_owner network
        other_owner_res = self.client.get("/network/other_owner")
        self.assertEqual(other_owner_res.status_code, 404)

        # Other owner search returns 0 candidates
        other_search = self.client.post(
            "/target/search",
            json={
                "owner_id": "other_owner",
                "company": "Blinklean",
                "deal_side": "buy_side",
            },
        )
        self.assertEqual(other_search.status_code, 200)
        self.assertEqual(other_search.json()["candidates"], [])

    def test_import_invalidates_stale_graph_cache_and_is_idempotent(self):
        self._import_real_network()
        graph1 = main.get_owner_graph(self.owner_id)
        self.assertTrue(graph1.number_of_nodes() > 0)

        # Re-import with an added connection
        updated_connections = list(self.imported_connections) + [{
            "name": "New Connection",
            "profile_url": "https://www.linkedin.com/in/new-conn",
            "headline": "Software Engineer",
            "degree": "1st",
            "connection_date": "September 20, 2026",
            "source": "linkedin_dom",
        }]

        self.client.post(
            "/network/import",
            json={
                "owner_id": self.owner_id,
                "source": "linkedin_dom",
                "confirmed": True,
                "connections": updated_connections,
                "relationship_evidence": self.imported_evidence,
            },
        )

        graph2 = main.get_owner_graph(self.owner_id)
        self.assertIn("https://www.linkedin.com/in/new-conn", graph2)

    def test_synthetic_fixtures_pass_when_explicitly_run_in_demo_mode(self):
        os.environ["DEMO_MODE"] = "true"
        try:
            main.rebuild_all_graphs()
            self.assertIn("final_demo_owner", main.GRAPHS)
            demo_graph = main.get_owner_graph("final_demo_owner")
            self.assertIn("https://www.linkedin.com/in/person-c", demo_graph)
        finally:
            os.environ.pop("DEMO_MODE", None)

    def test_real_imported_target_search_company_and_role_parsing(self):
        # Realistic imported connections matching requested formats
        connections = [
            {
                "name": "BHARGAV V M",
                "profile_url": "https://www.linkedin.com/in/bhargav-v-m",
                "headline": "SWE @HPE | RVCE CSE’24 | Generative AI | Web Development | LLMs | MERN",
                "degree": "1st",
                "source": "linkedin_dom",
            },
            {
                "name": "D Giridhar Reddy",
                "profile_url": "https://www.linkedin.com/in/d-giridhar-reddy",
                "headline": "Software Engineer @ Lam Research",
                "degree": "1st",
                "source": "linkedin_dom",
            },
            {
                "name": "Faculty Member",
                "profile_url": "https://www.linkedin.com/in/faculty-gat",
                "headline": "Associate Professor at Global Academy of Technology",
                "degree": "1st",
                "source": "linkedin_dom",
            },
            {
                "name": "IT Associate",
                "profile_url": "https://www.linkedin.com/in/it-associate",
                "headline": "Sr. Associate IT | ITC Indivision Limited",
                "degree": "1st",
                "source": "linkedin_dom",
            },
        ]

        self.client.post(
            "/network/import",
            json={
                "owner_id": "real_search_user",
                "source": "linkedin_dom",
                "confirmed": True,
                "connections": connections,
                "relationship_evidence": [],
            },
        )

        # 1. HPE + Software Engineer finds BHARGAV V M
        hpe_res = self.client.post(
            "/target/search",
            json={
                "owner_id": "real_search_user",
                "company": "HPE",
                "deal_side": "sell_side",
                "target_role": "Software Engineer",
            },
        )
        self.assertEqual(hpe_res.status_code, 200)
        hpe_candidates = hpe_res.json()["candidates"]
        self.assertEqual(len(hpe_candidates), 1)
        self.assertEqual(hpe_candidates[0]["name"], "BHARGAV V M")

        # 2. Lam Research finds D Giridhar Reddy
        lam_res = self.client.post(
            "/target/search",
            json={
                "owner_id": "real_search_user",
                "company": "Lam Research",
                "deal_side": "sell_side",
                "target_role": "Software Engineer",
            },
        )
        self.assertEqual(lam_res.status_code, 200)
        lam_candidates = lam_res.json()["candidates"]
        self.assertEqual(len(lam_candidates), 1)
        self.assertEqual(lam_candidates[0]["name"], "D Giridhar Reddy")

        # 3. Global Academy of Technology finds Faculty Member
        gat_res = self.client.post(
            "/target/search",
            json={
                "owner_id": "real_search_user",
                "company": "Global Academy of Technology",
                "deal_side": "sell_side",
                "target_role": "Associate Professor",
            },
        )
        self.assertEqual(gat_res.status_code, 200)
        gat_candidates = gat_res.json()["candidates"]
        self.assertEqual(len(gat_candidates), 1)
        self.assertEqual(gat_candidates[0]["name"], "Faculty Member")

        # 4. ITC Indivision Limited finds IT Associate
        itc_res = self.client.post(
            "/target/search",
            json={
                "owner_id": "real_search_user",
                "company": "ITC Indivision Limited",
                "deal_side": "sell_side",
                "target_role": "Sr. Associate IT",
            },
        )
        self.assertEqual(itc_res.status_code, 200)
        itc_candidates = itc_res.json()["candidates"]
        self.assertEqual(len(itc_candidates), 1)
        self.assertEqual(itc_candidates[0]["name"], "IT Associate")

        # 5. Non-existent company returns zero candidates
        nonexistent_res = self.client.post(
            "/target/search",
            json={
                "owner_id": "real_search_user",
                "company": "Nonexistent Robotics",
                "deal_side": "sell_side",
            },
        )
        self.assertEqual(nonexistent_res.status_code, 200)
        self.assertEqual(nonexistent_res.json()["candidates"], [])
        self.assertEqual(nonexistent_res.json().get("message"), "No matching target found in your imported network.")

        # 6. Tenant isolation - other user cannot access real_search_user network
        other_res = self.client.post(
            "/target/search",
            json={
                "owner_id": "other_isolated_user",
                "company": "HPE",
                "deal_side": "sell_side",
            },
        )
        self.assertEqual(other_res.status_code, 200)
        self.assertEqual(other_res.json()["candidates"], [])


if __name__ == "__main__":
    unittest.main()
