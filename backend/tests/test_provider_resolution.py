import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from entity_resolution import (
    ResolutionOutcome,
    normalize_company_name,
    normalize_domain,
    normalize_email,
    normalize_profile_url,
    normalize_person_name,
    resolve_company,
    resolve_person,
)
from providers import (
    ApprovedProviderUnavailable,
    ApprovedRelationshipDataProvider,
    MockRelationshipDataProvider,
)
from providers.contracts import ProviderSnapshot
try:
    from db.database import Database
    from db.models import Person, Relationship, Tenant
    from repositories.networks import PostgresNetworkRepository
    from services.provider_ingestion import ProviderIngestionService
    from sqlalchemy import func, select
    DATABASE_TESTS_AVAILABLE = True
except ImportError:
    DATABASE_TESTS_AVAILABLE = False


@unittest.skipUnless(
    DATABASE_TESTS_AVAILABLE,
    "SQLAlchemy is required for provider repository tests",
)
class ProviderResolutionTests(unittest.TestCase):
    def test_normalization_is_conservative_and_deterministic(self):
        self.assertEqual(normalize_person_name("  Ana-Maria O'Neil "), "anamaria oneil")
        self.assertEqual(normalize_company_name("Acme, Inc."), "acme inc")
        self.assertEqual(normalize_domain("HTTPS://WWW.Acme.example/path"), "acme.example")
        self.assertEqual(normalize_email(" Person@Example.COM "), "person@example.com")
        self.assertEqual(
            normalize_profile_url("HTTPS://Example.com/in/person/?trk=abc"),
            "https://example.com/in/person",
        )

    def test_provider_id_and_profile_url_are_exact_matches(self):
        candidate = {"id": "person-1", "provider_record_id": "p-1", "profile_url": "https://example.com/in/a"}
        self.assertEqual(
            resolve_person({"provider_record_id": "p-1", "name": "Different"}, [candidate]).outcome,
            ResolutionOutcome.EXACT,
        )
        self.assertEqual(
            resolve_person({"profile_url": "https://EXAMPLE.com/in/a/"}, [candidate]).entity_id,
            "person-1",
        )

    def test_email_and_supporting_attribute_matches_are_strong(self):
        candidate = {
            "id": "person-1",
            "display_name": "Asha Rao",
            "email": "asha@example.com",
            "company": "Acme Inc",
        }
        email_result = resolve_person({"email": "ASHA@example.com", "name": "Other"}, [candidate])
        name_result = resolve_person({"name": "Asha Rao", "company": "Acme, Inc."}, [candidate])
        self.assertEqual(email_result.outcome, ResolutionOutcome.STRONG)
        self.assertEqual(name_result.outcome, ResolutionOutcome.STRONG)

    def test_ambiguous_name_does_not_merge(self):
        candidates = [
            {"id": "p-1", "display_name": "Rahul Sharma", "company": "A"},
            {"id": "p-2", "display_name": "Rahul Sharma", "company": "B"},
        ]
        result = resolve_person({"name": "Rahul Sharma"}, candidates)
        self.assertEqual(result.outcome, ResolutionOutcome.UNRESOLVED)
        self.assertFalse(result.should_merge)

    def test_company_domain_resolution_and_ambiguity(self):
        candidates = [{"id": "c-1", "name": "Acme", "domain": "acme.example"}]
        self.assertEqual(
            resolve_company({"name": "Other", "domain": "www.acme.example"}, candidates).outcome,
            ResolutionOutcome.STRONG,
        )
        ambiguous = resolve_company(
            {"name": "Acme"},
            [{"id": "c-1", "name": "Acme"}, {"id": "c-2", "name": "Acme"}],
        )
        self.assertEqual(ambiguous.outcome, ResolutionOutcome.POSSIBLE)
        self.assertFalse(ambiguous.should_merge)

    def test_provider_contracts(self):
        provider = MockRelationshipDataProvider([{
            "owner_id": "owner-a",
            "name": "Person A",
            "provider_record_id": "person-a",
            "profile_url": "https://example.test/in/a",
            "source": "mock",
        }])
        snapshot = provider.fetch_snapshot("owner-a")
        self.assertEqual(snapshot.provider_name, "mock")
        self.assertEqual(snapshot.people[0].provider_record_id, "person-a")
        with self.assertRaises(ApprovedProviderUnavailable):
            ApprovedRelationshipDataProvider().fetch_snapshot("owner-a")

    def test_provider_ingestion_preserves_provider_metadata_and_metrics(self):
        temp_dir = Path(tempfile.mkdtemp())
        database = Database(f"sqlite:///{temp_dir / 'ingestion.db'}")
        database.create_schema_for_tests()
        service = ProviderIngestionService(PostgresNetworkRepository(database))
        from providers.contracts import ProviderPerson
        snapshot = ProviderSnapshot(
            provider_name="mock",
            people=(ProviderPerson(
                display_name="Person A",
                provider_record_id="a",
                profile_url="https://example.test/a",
                metadata={"fixture": True},
            ),),
        )
        metrics = service.ingest("owner-a", snapshot)
        self.assertEqual(metrics.provider, "mock")
        self.assertEqual(metrics.fetched, 1)
        restored = service.repository.load_network("owner-a")
        self.assertEqual(restored["connections"][0]["source"], "mock")
        self.assertEqual(restored["connections"][0]["source_record_id"], "a")

    def test_repository_reconciles_provider_ids_and_keeps_ambiguous_people_separate(self):
        temp_dir = Path(tempfile.mkdtemp())
        database = Database(f"sqlite:///{temp_dir / 'provider.db'}")
        database.create_schema_for_tests()
        repository = PostgresNetworkRepository(database)
        first = {
            "owner_id": "owner-a",
            "connections": [{
                "name": "Rahul Sharma",
                "provider_record_id": "p-1",
                "profile_url": "https://example.test/in/rahul",
                "company": "Acme",
                "source": "mock",
            }],
            "relationship_evidence": [],
        }
        duplicate = json.loads(json.dumps(first))
        repository.save_network("owner-a", first)
        repository.save_network("owner-a", duplicate)
        with database.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Person)), 2)
            self.assertEqual(session.scalar(select(func.count()).select_from(Relationship)), 1)

        second = {
            "owner_id": "owner-a",
            "connections": [{
                "name": "Rahul Sharma",
                "profile_url": "https://example.test/in/rahul-2",
                "company": "Different Co",
                "source": "mock",
            }],
            "relationship_evidence": [],
        }
        repository.save_network("owner-a", second)
        with database.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Person)), 3)
            self.assertEqual(session.scalar(select(func.count()).select_from(Tenant)), 1)

    def test_repository_resolution_is_tenant_scoped(self):
        temp_dir = Path(tempfile.mkdtemp())
        database = Database(f"sqlite:///{temp_dir / 'tenant.db'}")
        database.create_schema_for_tests()
        repository = PostgresNetworkRepository(database)
        for owner_id in ("owner-a", "owner-b"):
            repository.save_network(owner_id, {
                "owner_id": owner_id,
                "connections": [{
                    "name": "Same Person",
                    "provider_record_id": "same-provider-id",
                    "profile_url": f"https://example.test/{owner_id}",
                    "source": "mock",
                }],
                "relationship_evidence": [],
            })
        with database.session_factory() as session:
            self.assertEqual(session.scalar(select(func.count()).select_from(Person)), 4)
            self.assertEqual(session.scalar(select(func.count()).select_from(Tenant)), 2)


if __name__ == "__main__":
    unittest.main()
