from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from auth.context import AuthContext
from providers.contracts import ProviderSnapshot
from repositories.networks import PostgresNetworkRepository


@dataclass(frozen=True)
class IngestionMetrics:
    provider: str
    fetched: int
    resolved: int
    created: int
    ambiguous: int
    unresolved: int
    deduplicated: int


class ProviderIngestionService:
    """Orchestrates provider snapshots into the normalized repository boundary."""

    def __init__(self, repository: PostgresNetworkRepository):
        self.repository = repository

    def snapshot_to_network(self, snapshot: ProviderSnapshot) -> dict[str, Any]:
        connections = []
        for person in snapshot.people:
            connections.append({
                "name": person.display_name,
                "profile_url": person.profile_url,
                "email": person.email,
                "company": person.company,
                "headline": person.headline,
                "location": person.location,
                "source": snapshot.provider_name,
                "source_record_id": person.provider_record_id,
                "confidence": person.confidence,
                "observed_at": person.observed_at.isoformat() if person.observed_at else None,
                "provider_metadata": dict(person.metadata),
            })

        evidence = []
        for item in snapshot.evidence:
            metadata = dict(item.metadata)
            evidence.append({
                "name": metadata.get("name", ""),
                "profile_url": metadata.get("profile_url"),
                "company": metadata.get("company"),
                "target_name": metadata.get("name", ""),
                "observed_degree": item.observed_degree,
                "mutual_connection_names": list(item.mutual_connection_names),
                "evidence_type": item.evidence_type,
                "source": snapshot.provider_name,
                "source_record_id": item.provider_record_id,
                "confidence": item.confidence,
                "captured_at": item.observed_at.isoformat() if item.observed_at else None,
                "provider_metadata": metadata,
            })

        return {
            "source": snapshot.provider_name,
            "companies": [
                {
                    "name": company.name,
                    "domain": company.domain,
                    "source": snapshot.provider_name,
                    "source_record_id": company.provider_record_id,
                    "confidence": company.confidence,
                    "observed_at": company.observed_at.isoformat() if company.observed_at else None,
                    "provider_metadata": dict(company.metadata),
                }
                for company in snapshot.companies
            ],
            "connections": connections,
            "relationship_evidence": evidence,
            "relationships": [
                {
                    "source_provider_record_id": relationship.source_provider_record_id,
                    "target_provider_record_id": relationship.target_provider_record_id,
                    "target_company_provider_record_id": relationship.target_company_provider_record_id,
                    "relationship": relationship.relationship_type,
                    "source": snapshot.provider_name,
                    "source_record_id": relationship.provider_record_id,
                    "confidence": relationship.confidence,
                    "observed_at": relationship.observed_at.isoformat() if relationship.observed_at else None,
                    "metadata": dict(relationship.metadata),
                }
                for relationship in snapshot.relationships
            ],
        }

    def ingest(
        self,
        owner_id: str,
        snapshot: ProviderSnapshot,
        auth_context: AuthContext | None = None,
    ) -> IngestionMetrics:
        network = self.snapshot_to_network(snapshot)
        result = self.repository.save_network(
            owner_id,
            network,
            auth_context.tenant_id if auth_context and auth_context.authenticated else None,
            auth_context.user_id if auth_context and auth_context.authenticated else None,
        )
        fetched = len(snapshot.people) + len(snapshot.evidence) + len(snapshot.relationships)
        stored = result.get("people", 0) + result.get("evidence", 0)
        return IngestionMetrics(
            provider=snapshot.provider_name,
            fetched=fetched,
            resolved=result.get("resolved", 0),
            created=max(0, result.get("created", 0) - 1),
            ambiguous=result.get("ambiguous", 0),
            unresolved=max(0, result.get("unresolved", 0) - 1),
            deduplicated=max(0, fetched - result.get("created", 0)),
        )
