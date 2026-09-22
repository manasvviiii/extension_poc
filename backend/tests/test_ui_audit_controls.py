import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from fastapi.testclient import TestClient
import main


class UIAuditControlTests(unittest.TestCase):
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
        self.import_owner("audit_owner_a")

    def import_owner(self, owner_id: str):
        connections = [
            {
                "name": f"Conn {index} for {owner_id}",
                "profile_url": f"https://www.linkedin.com/in/conn-{owner_id}-{index}",
                "headline": "CFO at Example Corp" if index == 0 else "Senior Engineer at TechCorp",
                "company": "Example Corp" if index == 0 else "TechCorp",
                "connection_date": "January 1, 2026",
            }
            for index in range(5)
        ]
        evidence = [
            {
                "name": f"Target Person for {owner_id}",
                "profile_url": f"https://www.linkedin.com/in/target-{owner_id}",
                "headline": "Target Executive at Example Corp",
                "observed_degree": "2nd",
                "mutual_connection_names": [f"Conn 0 for {owner_id}"],
                "mutual_connections_text": f"Conn 0 for {owner_id} is a mutual connection",
                "evidence_type": "mutual_connection_ui",
            }
        ]
        return self.client.post(
            "/network/import",
            json={
                "owner_id": owner_id,
                "source": "linkedin_dom",
                "connections": connections,
                "relationship_evidence": evidence,
                "expected_total": 5,
                "collected_total": 5,
                "completion_status": "complete",
                "confirmed": True,
            },
        )

    # 1. VIEW GRAPH
    def test_view_graph_success(self):
        response = self.client.get("/graph/audit_owner_a/view")
        self.assertEqual(response.status_code, 200)
        self.assertIn("html", response.headers["content-type"].lower())
        self.assertIn("vis-network", response.text.lower())

        # Test query parameter route as well
        response_query = self.client.get("/graph/view?owner_id=audit_owner_a")
        self.assertEqual(response_query.status_code, 200)

    def test_view_graph_empty_owner(self):
        response = self.client.get("/graph/non_existent_owner/view")
        # Non-existent owner graph returns 404 Not Found
        self.assertEqual(response.status_code, 404)

    # 2. TARGET SEARCH
    def test_target_search_success(self):
        payload = {
            "owner_id": "audit_owner_a",
            "company": "Example Corp",
            "deal_side": "sell_side",
            "target_role": "CFO",
        }
        response = self.client.post("/target/search", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["owner_id"], "audit_owner_a")
        self.assertIn("candidates", data)
        self.assertGreater(len(data["candidates"]), 0)

    def test_target_search_no_results(self):
        payload = {
            "owner_id": "audit_owner_a",
            "company": "NonExistentCompanyXYZ",
            "deal_side": "sell_side",
        }
        response = self.client.post("/target/search", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["candidates"]), 0)
        self.assertIn("message", data)

    # 3. WARM PATH
    def test_warm_path_success(self):
        payload = {
            "owner_id": "audit_owner_a",
            "source_id": "audit_owner_a",
            "target_id": "https://www.linkedin.com/in/target-audit_owner_a",
            "cutoff": 4,
        }
        response = self.client.post("/graph/path", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("paths", data)
        self.assertGreater(len(data["paths"]), 0)

    def test_warm_path_no_path(self):
        payload = {
            "owner_id": "audit_owner_a",
            "source_id": "audit_owner_a",
            "target_id": "https://www.linkedin.com/in/unconnected-person-999",
            "cutoff": 4,
        }
        response = self.client.post("/graph/path", json=payload)
        # 404 returned when target node does not exist in graph
        self.assertEqual(response.status_code, 404)

    # 4. EXPLAIN PATH
    def test_explain_path_success(self):
        payload = {
            "owner_id": "audit_owner_a",
            "source_id": "audit_owner_a",
            "target_id": "https://www.linkedin.com/in/target-audit_owner_a",
            "cutoff": 4,
        }
        response = self.client.post("/graph/explain-path", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("owner_id", data)
        self.assertIn("explanation", data)

    # 5. REFRESH
    def test_refresh_job_queued(self):
        payload = {
            "owner_id": "audit_owner_a",
            "force": False,
        }
        response = self.client.post("/refresh", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("job_id", data)
        self.assertEqual(data["status"], "queued")

    # 6. SYNC SUCCESS & BLOCKED
    def test_sync_success_complete_rendered_dataset(self):
        payload = {
            "owner_id": "audit_owner_a",
            "source": "linkedin_dom",
            "connections": [
                {"name": "Conn 1", "profile_url": "https://www.linkedin.com/in/c1"}
            ],
            "relationship_evidence": [],
            "expected_total": 6,
            "collected_total": 6,
            "completion_status": "complete_rendered_dataset",
            "confirmed": True,
        }
        response = self.client.post("/network/import", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreaterEqual(data["connection_count"], 1)

    def test_sync_blocked_on_incomplete(self):
        payload = {
            "owner_id": "audit_owner_a",
            "source": "linkedin_dom",
            "connections": [
                {"name": "Conn 1", "profile_url": "https://www.linkedin.com/in/c1"}
            ],
            "expected_total": 100,
            "collected_total": 1,
            "completion_status": "incomplete",
            "confirmed": True,
        }
        response = self.client.post("/network/import", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("incomplete", response.json()["detail"].lower())

    # 7. TENANT ISOLATION
    def test_tenant_isolation(self):
        self.import_owner("audit_owner_b")
        response_a = self.client.get("/graph/audit_owner_a/search?q=audit_owner_a")
        response_b = self.client.get("/graph/audit_owner_b/search?q=audit_owner_a")
        self.assertEqual(response_a.status_code, 200)
        self.assertEqual(response_b.status_code, 200)
        # owner_b's search results should not contain owner_a's contacts
        self.assertEqual(len(response_b.json()["results"]), 0)


if __name__ == "__main__":
    unittest.main()
