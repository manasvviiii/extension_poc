import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

try:
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import func, inspect, select
    from db.database import Database
    from db.models import (
        Company,
        NetworkMembership,
        Person,
        Relationship,
        RelationshipEvidence,
        Tenant,
    )
    from repositories.networks import PostgresNetworkRepository
    DATABASE_TESTS_AVAILABLE = True
except ImportError:
    DATABASE_TESTS_AVAILABLE = False


@unittest.skipUnless(
    DATABASE_TESTS_AVAILABLE,
    "SQLAlchemy and Alembic are installed by backend/requirements.txt",
)
class DatabasePersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.database_url = f"sqlite:///{self.temp_dir / 'test.db'}"
        self.database = Database(self.database_url)
        self.database.create_schema_for_tests()
        self.repository = PostgresNetworkRepository(self.database)
        fixture_path = Path(__file__).parents[1] / "data" / "fixtures" / "final_demo_owner.json"
        if not fixture_path.exists():
            fixture_path = Path(__file__).parents[1] / "data" / "networks" / "final_demo_owner.json"
        self.network = json.loads(fixture_path.read_text(encoding="utf-8"))

    def test_schema_and_migration_create_fresh_database(self):
        migration_db = Database(f"sqlite:///{self.temp_dir / 'migration.db'}")
        config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.temp_dir / 'migration.db'}")
        database_url = os.environ.pop("DATABASE_URL", None)
        try:
            command.upgrade(config, "head")
        finally:
            if database_url is not None:
                os.environ["DATABASE_URL"] = database_url
        with migration_db.engine.connect() as connection:
            inspector = inspect(connection)
            self.assertTrue(inspector.has_table("tenants"))
            self.assertTrue(inspector.has_table("relationships"))
            self.assertTrue(inspector.has_table("audit_events"))

    def test_import_is_tenant_scoped_and_idempotent(self):
        first = self.repository.save_network("final_demo_owner", self.network)
        second = self.repository.save_network("final_demo_owner", self.network)
        self.assertEqual(first["people"], 2)
        self.assertEqual(second["people"], 2)

        with self.database.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Tenant)), 1)
            self.assertEqual(session.scalar(select(func.count()).select_from(Person)), 4)
            self.assertEqual(session.scalar(select(func.count()).select_from(NetworkMembership)), 2)
            self.assertEqual(session.scalar(select(func.count()).select_from(RelationshipEvidence)), 1)
            self.assertEqual(session.scalar(select(func.count()).select_from(Relationship)), 4)

    def test_company_is_tenant_scoped(self):
        network = json.loads(json.dumps(self.network))
        network["connections"][0]["company"] = "Company A"
        self.repository.save_network("company_owner", network)
        with self.database.session_factory() as session:
            company = session.scalar(select(Company).where(Company.name == "Company A"))
            self.assertIsNotNone(company)
            self.assertEqual(company.tenant_id, session.scalar(select(Tenant.id).where(
                Tenant.compatibility_owner_id == "company_owner"
            )))

    def test_graph_rebuild_matches_json_network(self):
        import main

        self.repository.save_network("final_demo_owner", self.network)
        restored = self.repository.load_network("final_demo_owner")
        graph = main.build_graph_from_network("final_demo_owner", restored)
        expected = main.build_graph_from_network("expected", self.network)
        self.assertEqual(graph.number_of_nodes(), expected.number_of_nodes())
        self.assertEqual(graph.number_of_edges(), expected.number_of_edges())
        self.assertEqual(
            sorted(data["relationship"] for _, _, data in graph.edges(data=True)),
            sorted(data["relationship"] for _, _, data in expected.edges(data=True)),
        )

    def test_import_rolls_back_on_failure(self):
        invalid = json.loads(json.dumps(self.network))
        invalid["relationship_evidence"][0]["confidence"] = "not-a-number"
        with self.assertRaises(ValueError):
            self.repository.save_network("rollback_owner", invalid)
        self.assertIsNone(self.repository.load_network("rollback_owner"))


if __name__ == "__main__":
    unittest.main()
