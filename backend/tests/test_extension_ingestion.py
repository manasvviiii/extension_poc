import json
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import main
from auth.context import AuthContext
from auth.dependencies import AuthSettings, configure_settings
import auth.dependencies as auth_dependencies
from providers.extension_adapter import extension_payload_to_snapshot

try:
    from fastapi.testclient import TestClient
    TEST_CLIENT_AVAILABLE = True
except (ImportError, RuntimeError):
    TestClient = None
    TEST_CLIENT_AVAILABLE = False

try:
    from db.database import Database
    from db.models import Person, Relationship, Tenant
    from repositories.networks import PostgresNetworkRepository
    from services.provider_ingestion import ProviderIngestionService
    from sqlalchemy import func, select
    DATABASE_TESTS_AVAILABLE = True
except ImportError:
    DATABASE_TESTS_AVAILABLE = False


class ExtensionIngestionTests(unittest.TestCase):
    def setUp(self):
        self.original_settings = auth_dependencies.settings
        self.temp_dir = Path(tempfile.mkdtemp())
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

        self.sample_payload = {
            "owner_id": "owner-ext-1",
            "source": "linkedin_dom",
            "page_type": "connections_list",
            "page_url": "https://linkedin.com/mynetwork",
            "connections": [
                {
                    "name": "Sarah Connor",
                    "profile_url": "https://example.test/in/sarah",
                    "headline": "Head of Corporate Development at Cyberdyne",
                    "company": "Cyberdyne Systems",
                    "connection_date": "January 10, 2026",
                    "degree": "1st",
                    "source": "linkedin_dom",
                }
            ],
            "relationship_evidence": [
                {
                    "name": "Kyle Reese",
                    "profile_url": "https://example.test/in/kyle",
                    "headline": "Lead Engineer",
                    "observed_degree": "2nd",
                    "mutual_connection_names": ["Sarah Connor"],
                    "evidence_type": "mutual_connection_ui",
                    "source": "linkedin_dom",
                    "captured_at": "2026-01-12T00:00:00Z",
                }
            ],
        }

    def tearDown(self):
        configure_settings(self.original_settings)

    def test_extension_payload_to_snapshot_conversion(self):
        snapshot = extension_payload_to_snapshot(self.sample_payload)

        self.assertEqual(snapshot.provider_name, "linkedin_dom")
        self.assertGreaterEqual(len(snapshot.people), 3)  # Owner + Sarah + Kyle
        self.assertTrue(any(p.display_name == "Sarah Connor" for p in snapshot.people))
        self.assertTrue(any(p.display_name == "Kyle Reese" for p in snapshot.people))
        self.assertTrue(any(c.name == "Cyberdyne Systems" for c in snapshot.companies))
        self.assertTrue(any(r.relationship_type == "KNOWS" for r in snapshot.relationships))
        self.assertEqual(len(snapshot.evidence), 1)
        self.assertEqual(snapshot.evidence[0].mutual_connection_names, ("Sarah Connor",))

    def test_confirmation_required_and_unconfirmed_rejected(self):
        unconfirmed = dict(self.sample_payload)
        unconfirmed["confirmed"] = False

        with self.assertRaises(main.HTTPException) as ctx:
            main.import_network(main.ImportRequest(**unconfirmed))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("confirmation", ctx.exception.detail.lower())

    def test_successful_confirmed_import_and_graph_update(self):
        confirmed = dict(self.sample_payload)
        confirmed["confirmed"] = True

        result = main.import_network(main.ImportRequest(**confirmed))

        self.assertTrue(result["success"])
        self.assertEqual(result["connection_count"], 1)
        self.assertEqual(result["relationship_evidence_count"], 1)
        self.assertGreaterEqual(result["graph_nodes"], 3)
        self.assertGreaterEqual(result["graph_edges"], 2)

        # Verify graph is retrievable via GraphService
        graph = main.get_owner_graph("owner-ext-1")
        self.assertIn("https://example.test/in/sarah", graph)
        self.assertIn("https://example.test/in/kyle", graph)

    def test_duplicate_import_idempotency(self):
        request = main.ImportRequest(**{**self.sample_payload, "confirmed": True})

        res1 = main.import_network(request)
        res2 = main.import_network(request)

        self.assertEqual(res1["connection_count"], res2["connection_count"])
        self.assertEqual(res1["graph_nodes"], res2["graph_nodes"])
        self.assertEqual(res1["graph_edges"], res2["graph_edges"])

    def test_warm_path_calculation_after_extension_import(self):
        main.import_network(main.ImportRequest(**{**self.sample_payload, "confirmed": True}))

        path_result = main.find_paths(main.PathRequest(
            owner_id="owner-ext-1",
            source_id="owner-ext-1",
            target_id="https://example.test/in/kyle",
            cutoff=4,
        ))

        self.assertTrue(path_result["paths"])
        best = path_result["paths"][0]
        self.assertEqual(best["hop_count"], 2)
        self.assertEqual(best["path"], ["owner-ext-1", "https://example.test/in/sarah", "https://example.test/in/kyle"])

    def test_existing_api_compatibility(self):
        main.import_network(main.ImportRequest(**{**self.sample_payload, "confirmed": True}))

        network = main.get_network("owner-ext-1")
        self.assertEqual(network["owner_id"], "owner-ext-1")
        self.assertEqual(len(network["connections"]), 1)

        evidence = main.get_relationship_evidence("owner-ext-1")
        self.assertEqual(evidence["count"], 1)

    def test_progressive_payload_ingestion_with_multiple_connections(self):
        progressive_payload = {
            "owner_id": "owner-progressive-1",
            "source": "linkedin_dom",
            "confirmed": True,
            "page_type": "linkedin_network",
            "page_url": "https://www.linkedin.com/mynetwork/invite-connect/connections/",
            "connections": [
                {
                    "name": "Person 1",
                    "profile_url": "https://www.linkedin.com/in/person-1",
                    "headline": "CEO at Corp 1",
                    "degree": "1st",
                    "connection_date": "Connected 2 days ago"
                },
                {
                    "name": "Person 2",
                    "profile_url": "https://www.linkedin.com/in/person-2",
                    "headline": "CTO at Corp 2",
                    "degree": "1st",
                    "connection_date": "Connected 5 days ago"
                }
            ],
            "relationship_evidence": []
        }

        result = main.import_network(main.ImportRequest(**progressive_payload))
        self.assertTrue(result["success"])
        self.assertEqual(result["connection_count"], 2)

    def test_progressive_unconfirmed_payload_rejection(self):
        unconfirmed_progressive = {
            "owner_id": "owner-progressive-2",
            "source": "linkedin_dom",
            "confirmed": False,
            "page_type": "linkedin_network",
            "page_url": "https://www.linkedin.com/mynetwork/invite-connect/connections/",
            "connections": [
                {
                    "name": "Person 1",
                    "profile_url": "https://www.linkedin.com/in/person-1",
                    "headline": "CEO at Corp 1",
                    "degree": "1st"
                }
            ],
            "relationship_evidence": []
        }

        with self.assertRaises(main.HTTPException) as ctx:
            main.import_network(main.ImportRequest(**unconfirmed_progressive))
        self.assertEqual(ctx.exception.status_code, 400)

    @unittest.skipUnless(DATABASE_TESTS_AVAILABLE, "SQLAlchemy required for database tests")
    def test_database_provider_ingestion_and_tenant_isolation(self):
        db_path = self.temp_dir / "ext_test.db"
        database = Database(f"sqlite:///{db_path}")
        database.create_schema_for_tests()
        repository = PostgresNetworkRepository(database)
        service = ProviderIngestionService(repository)

        snapshot_a = extension_payload_to_snapshot({**self.sample_payload, "owner_id": "user-a"})
        snapshot_b = extension_payload_to_snapshot({**self.sample_payload, "owner_id": "user-b"})

        service.ingest("user-a", snapshot_a)
        service.ingest("user-b", snapshot_b)

        with database.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Tenant)), 2)
            self.assertEqual(session.scalar(select(func.count()).select_from(Person)), 8)


if __name__ == "__main__":
    unittest.main()
