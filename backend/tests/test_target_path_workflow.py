import sys
import unittest
from pathlib import Path

# Add backend directory to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient
import main
from main import app, save_network, graph_service
from auth.context import AuthContext


class TargetPathWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.owner_id = "test_tp_owner"
        self.tenant_id = "tenant_tp_1"

        # Mock network dataset
        self.connections = [
            {
                "profile_url": "https://www.linkedin.com/in/cfo-john-acme/",
                "name": "John Acme",
                "headline": "CFO at Acme Corp",
                "company": "Acme Corp",
                "degree": "1st",
                "source": "linkedin_dom",
            },
            {
                "profile_url": "https://www.linkedin.com/in/swe-jane-beta/",
                "name": "Jane Beta",
                "headline": "Software Engineer at Beta Inc",
                "company": "Beta Inc",
                "degree": "1st",
                "source": "linkedin_dom",
            },
        ]

        self.evidence = [
            {
                "profile_url": "https://www.linkedin.com/in/target-vp-acme/",
                "name": "Target VP",
                "headline": "Head of Corporate Development at Acme Corp",
                "company": "Acme Corp",
                "observed_degree": "2nd",
                "evidence_type": "mutual_connection_ui",
                "mutual_connection_names": ["John Acme"],
                "mutual_connections_text": "Mutual connection: John Acme",
                "source": "linkedin_dom",
            }
        ]

        # Ingest mock network
        network_data = {
            "owner_id": self.owner_id,
            "connections": self.connections,
            "relationship_evidence": self.evidence,
        }
        save_network(self.owner_id, network_data)
        graph_service.invalidate_owner_graph(self.owner_id)

    # 1. FIND TARGET PERSON - MATCH FOUND
    def test_target_search_found(self):
        response = self.client.post(
            "/target/search",
            json={
                "owner_id": self.owner_id,
                "company": "Acme Corp",
                "deal_side": "sell_side",
                "target_role": "CFO",
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["owner_id"], self.owner_id)
        self.assertGreater(len(data["candidates"]), 0)
        c = data["candidates"][0]
        self.assertIn("Acme", c["company"])
        self.assertTrue(c["path_summary"]["available"])

    # 2. FIND TARGET PERSON - NOT FOUND
    def test_target_search_not_found(self):
        response = self.client.post(
            "/target/search",
            json={
                "owner_id": self.owner_id,
                "company": "NonExistentCompanyXYZ",
                "deal_side": "buy_side",
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["candidates"]), 0)
        self.assertIn("message", data)

    # 3. WARM PATH - DIRECT 1-HOP CONNECTION
    def test_warm_path_direct_connection(self):
        response = self.client.post(
            "/graph/path",
            json={
                "owner_id": self.owner_id,
                "source_id": self.owner_id,
                "target_id": "https://www.linkedin.com/in/cfo-john-acme/",
                "cutoff": 4,
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreater(len(data["paths"]), 0)
        p = data["paths"][0]
        self.assertEqual(p.get("hop_count", len(p["path"]) - 1), 1)

    # 4. WARM PATH - 2-HOP EVIDENCE CONNECTION
    def test_warm_path_evidence_connection(self):
        response = self.client.post(
            "/graph/path",
            json={
                "owner_id": self.owner_id,
                "source_id": self.owner_id,
                "target_id": "https://www.linkedin.com/in/target-vp-acme/",
                "cutoff": 4,
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreater(len(data["paths"]), 0)
        p = data["paths"][0]
        self.assertEqual(p.get("hop_count", len(p["path"]) - 1), 2)

    # 5. WARM PATH - UNNORMALIZED URL WITH TRAILING SLASH
    def test_warm_path_unnormalized_urls(self):
        response = self.client.post(
            "/graph/path",
            json={
                "owner_id": self.owner_id,
                "source_id": self.owner_id,
                "target_id": "https://www.linkedin.com/in/cfo-john-acme///",
                "cutoff": 4,
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreater(len(data["paths"]), 0)

    # 6. WARM PATH - NOT FOUND
    def test_warm_path_not_found(self):
        response = self.client.post(
            "/graph/path",
            json={
                "owner_id": self.owner_id,
                "source_id": self.owner_id,
                "target_id": "https://www.linkedin.com/in/non-existent-person",
                "cutoff": 4,
            },
        )
        self.assertEqual(response.status_code, 404)

    # 7. EXPLAIN PATH - BY TARGET ID
    def test_explain_path_by_target_id(self):
        response = self.client.post(
            "/graph/explain-path",
            json={
                "owner_id": self.owner_id,
                "source_id": self.owner_id,
                "target_id": "https://www.linkedin.com/in/cfo-john-acme",
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("explanation", data)
        self.assertIn("directly connected", data["explanation"].lower())

    # 9. IMPORT CREATES GRAPH & AUTO MIGRATION REBUILD
    def test_import_creates_graph_and_auto_migrates(self):
        import_owner = "task882_test_owner"
        payload = {
            "owner_id": import_owner,
            "source": "linkedin_dom",
            "confirmed": True,
            "connections": self.connections,
            "relationship_evidence": self.evidence,
            "completion_status": "complete"
        }
        res_import = self.client.post("/network/import", json=payload)
        self.assertEqual(res_import.status_code, 200)
        import_data = res_import.json()
        self.assertTrue(import_data["success"])
        self.assertGreater(import_data["graph_nodes"], 0)
        self.assertGreater(import_data["graph_edges"], 0)

        # Evict in-memory graph cache to simulate fresh server request or restart
        main.graph_service.cache.invalidate(None, import_owner)

        # GET /graph/{owner_id} must return 200 with nodes, edges, owner_id (never 404)
        res_graph = self.client.get(f"/graph/{import_owner}")
        self.assertEqual(res_graph.status_code, 200)
        graph_data = res_graph.json()
        self.assertEqual(graph_data["owner_id"], import_owner)
        self.assertGreater(len(graph_data["nodes"]), 0)
        self.assertGreater(len(graph_data["edges"]), 0)

        # POST /graph/path must work cleanly
        res_path = self.client.post("/graph/path", json={
            "owner_id": import_owner,
            "source_id": import_owner,
            "target_id": "https://www.linkedin.com/in/cfo-john-acme/",
            "cutoff": 4
        })
        self.assertEqual(res_path.status_code, 200)
        self.assertGreater(len(res_path.json()["paths"]), 0)

    # 10. TASK 8.9.1 - GRAPH PERSISTENCE & SELF-HEALING TEST
    def test_task_891_graph_persistence_and_self_healing(self):
        owner_id = "task891_owner_test"
        payload = {
            "owner_id": owner_id,
            "source": "linkedin_dom",
            "confirmed": True,
            "connections": self.connections,
            "relationship_evidence": self.evidence,
            "completion_status": "complete"
        }
        # Step 1: POST /network/import -> 200 OK
        res_import = self.client.post("/network/import", json=payload)
        self.assertEqual(res_import.status_code, 200)

        # Step 2: GET /network/{owner_id} -> 200 OK
        res_network = self.client.get(f"/network/{owner_id}")
        self.assertEqual(res_network.status_code, 200)
        self.assertEqual(len(res_network.json()["connections"]), len(self.connections))

        # Step 3: GET /graph/{owner_id} -> 200 OK
        res_graph = self.client.get(f"/graph/{owner_id}")
        self.assertEqual(res_graph.status_code, 200)
        self.assertGreater(len(res_graph.json()["nodes"]), 0)

        # Step 4: Invalidate graph cache to simulate server restart / missing cache
        main.graph_service.cache.invalidate(None, owner_id)

        # Step 5: Self-healing POST /graph/path -> 200 OK (rebuilds and persists graph)
        res_path = self.client.post("/graph/path", json={
            "owner_id": owner_id,
            "source_id": owner_id,
            "target_id": "https://www.linkedin.com/in/cfo-john-acme/",
            "cutoff": 4
        })
        self.assertEqual(res_path.status_code, 200)
        self.assertGreater(len(res_path.json()["paths"]), 0)

        # Step 6: Non-existent owner (both raw network & graph absent) -> 404
        res_absent = self.client.get("/graph/totally_non_existent_owner_9999")
        self.assertEqual(res_absent.status_code, 404)


if __name__ == "__main__":
    unittest.main()
