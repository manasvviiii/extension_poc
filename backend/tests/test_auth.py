import json
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

try:
    from fastapi.testclient import TestClient
    TEST_CLIENT_AVAILABLE = True
except (ImportError, RuntimeError):
    TestClient = None
    TEST_CLIENT_AVAILABLE = False

sys.path.insert(0, str(Path(__file__).parents[1]))

import main
from auth.dependencies import AuthSettings, configure_settings
import auth.dependencies as auth_dependencies


@unittest.skipUnless(
    TEST_CLIENT_AVAILABLE,
    "FastAPI TestClient requires the optional HTTP test client dependency",
)
class AuthenticationIsolationTests(unittest.TestCase):
    def setUp(self):
        self.original_settings = auth_dependencies.settings
        self.original_audit_dir = os.environ.get("AUDIT_DIR")
        self.temp_dir = Path(tempfile.mkdtemp())
        os.environ["AUDIT_DIR"] = str(self.temp_dir / "audit")
        main.STORAGE_BACKEND = "json"
        main._POSTGRES_REPOSITORY = None
        main.DATA_DIR = self.temp_dir / "networks"
        main.JOBS_DIR = self.temp_dir / "jobs"
        main.AUDIT_DIR = self.temp_dir / "audit"
        main.DEALS_DIR = self.temp_dir / "deals"
        for path in (main.DATA_DIR, main.JOBS_DIR, main.AUDIT_DIR, main.DEALS_DIR):
            path.mkdir(parents=True, exist_ok=True)
        main.GRAPHS.clear()
        main.JOBS.clear()

        self.owner_a = "tenant_a_owner"
        self.owner_b = "tenant_b_owner"
        self.token_a = "token-a"
        self.token_b = "token-b"
        configure_settings(AuthSettings(
            mode="development",
            dev_tokens={
                self.token_a: {
                    "user_id": str(uuid.uuid4()),
                    "tenant_id": str(uuid.uuid4()),
                    "owner_id": self.owner_a,
                    "roles": ["member"],
                },
                self.token_b: {
                    "user_id": str(uuid.uuid4()),
                    "tenant_id": str(uuid.uuid4()),
                    "owner_id": self.owner_b,
                    "roles": ["member"],
                },
            },
        ))
        self.client = TestClient(main.app)
        self._import(self.owner_a, self.token_a, "Company A")
        self._import(self.owner_b, self.token_b, "Company B")

    def tearDown(self):
        configure_settings(self.original_settings)
        if self.original_audit_dir is None:
            os.environ.pop("AUDIT_DIR", None)
        else:
            os.environ["AUDIT_DIR"] = self.original_audit_dir

    def _import(self, owner_id: str, token: str, company: str):
        response = self.client.post(
            "/network/import",
            headers={"X-WarmGraph-Dev-Token": token},
            json={
                "owner_id": owner_id,
                "source": "test",
                "confirmed": True,
                "connections": [{
                    "name": f"{company} contact",
                    "profile_url": f"https://example.test/{owner_id}/contact",
                    "headline": f"CFO at {company}",
                    "company": company,
                }],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)

    def test_valid_auth_and_own_tenant_access(self):
        response = self.client.get(
            f"/network/{self.owner_a}",
            headers={"X-WarmGraph-Dev-Token": self.token_a},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["owner_id"], self.owner_a)

    def test_missing_invalid_and_disabled_authentication(self):
        self.assertEqual(
            self.client.get(f"/network/{self.owner_a}").status_code,
            401,
        )
        self.assertEqual(
            self.client.get(
                f"/network/{self.owner_a}",
                headers={"X-WarmGraph-Dev-Token": "wrong"},
            ).status_code,
            401,
        )
        configure_settings(AuthSettings(mode="disabled"))
        self.assertEqual(
            self.client.get(
                f"/network/{self.owner_a}",
                headers={"X-WarmGraph-Dev-Token": self.token_a},
            ).status_code,
            401,
        )

    def test_cross_tenant_network_graph_and_owner_bypass_are_denied(self):
        headers = {"X-WarmGraph-Dev-Token": self.token_a}
        self.assertEqual(self.client.get(f"/network/{self.owner_b}", headers=headers).status_code, 403)
        self.assertEqual(self.client.get(f"/graph/{self.owner_b}", headers=headers).status_code, 403)
        self.assertEqual(
            self.client.get(
                "/graph/view",
                params={"owner_id": self.owner_b},
                headers=headers,
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/graph/path",
                headers=headers,
                json={
                    "owner_id": self.owner_b,
                    "source_id": self.owner_b,
                    "target_id": "missing",
                },
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/target/search",
                headers=headers,
                json={
                    "owner_id": self.owner_b,
                    "company": "Company B",
                    "deal_side": "sell_side",
                },
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/graph/explain-path",
                headers=headers,
                json={"owner_id": self.owner_b, "target_id": "missing"},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/deals",
                headers=headers,
                json={
                    "owner_id": self.owner_b,
                    "side": "sell_side",
                    "target_company": "Company B",
                },
            ).status_code,
            403,
        )

    def test_job_access_is_tenant_scoped(self):
        response = self.client.post(
            "/refresh",
            headers={"X-WarmGraph-Dev-Token": self.token_a},
            json={"owner_id": self.owner_a},
        )
        self.assertEqual(response.status_code, 200)
        job_id = response.json()["job_id"]
        self.assertEqual(
            self.client.get(
                f"/jobs/{job_id}",
                headers={"X-WarmGraph-Dev-Token": self.token_a},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                f"/jobs/{job_id}",
                headers={"X-WarmGraph-Dev-Token": self.token_b},
            ).status_code,
            403,
        )

    def test_company_search_is_tenant_scoped(self):
        headers = {"X-WarmGraph-Dev-Token": self.token_a}
        companies = self.client.get("/company/search?q=Company", headers=headers)
        self.assertEqual(companies.status_code, 200)
        self.assertEqual([item["name"] for item in companies.json()["results"]], ["Company A"])
        people = self.client.get("/company/company%20b/people", headers=headers)
        self.assertEqual(people.status_code, 200)
        self.assertEqual(people.json()["people"], [])

    def test_authorization_failure_is_audited_without_token(self):
        response = self.client.get(
            f"/network/{self.owner_b}",
            headers={"X-WarmGraph-Dev-Token": self.token_a},
        )
        self.assertEqual(response.status_code, 403)
        audit_files = list((self.temp_dir / "audit").glob("*.jsonl"))
        records = [
            json.loads(line)
            for path in audit_files
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.assertTrue(any(record["action"] == "authorization_failure" for record in records))
        self.assertNotIn(self.token_a, json.dumps(records))


if __name__ == "__main__":
    unittest.main()
