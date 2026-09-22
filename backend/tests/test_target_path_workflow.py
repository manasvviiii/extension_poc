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

    # 8. EXPLAIN PATH - BY EXPLICIT PATH LIST
    def test_explain_path_by_path_list(self):
        response = self.client.post(
            "/graph/explain-path",
            json={
                "owner_id": self.owner_id,
                "path": [
                    self.owner_id,
                    "https://www.linkedin.com/in/cfo-john-acme",
                    "https://www.linkedin.com/in/target-vp-acme",
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("explanation", data)
        self.assertEqual(data["hops"], 2)


if __name__ == "__main__":
    unittest.main()
