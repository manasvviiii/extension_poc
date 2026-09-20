from __future__ import annotations

from datetime import datetime
from typing import Any

from .contracts import (
    ProviderCompany,
    ProviderEvidence,
    ProviderPerson,
    ProviderRelationship,
    ProviderSnapshot,
)


def parse_iso_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


from entity_resolution.normalization import parse_company_from_headline


def extension_payload_to_snapshot(payload: dict[str, Any]) -> ProviderSnapshot:
    """Converts extracted extension network JSON payload into a Phase 7 ProviderSnapshot."""
    owner_id = payload.get("owner_id") or "owner"
    provider_name = payload.get("source") or "linkedin_dom"

    people: list[ProviderPerson] = []
    companies: list[ProviderCompany] = []
    relationships: list[ProviderRelationship] = []
    evidence: list[ProviderEvidence] = []

    seen_person_ids: set[str] = set()
    seen_company_names: set[str] = set()

    # Owner person node
    owner_record_id = f"owner:{owner_id}"
    people.append(ProviderPerson(
        display_name=owner_id,
        provider_record_id=owner_record_id,
        metadata={"is_owner": True, "owner_id": owner_id},
    ))
    seen_person_ids.add(owner_record_id)

    # Process direct connections
    connections = payload.get("connections", [])
    for connection in connections:
        profile_url = connection.get("profile_url")
        name = connection.get("name") or "Unknown Person"
        person_id = connection.get("source_record_id") or profile_url or f"conn:{name}"
        company_name = connection.get("company") or parse_company_from_headline(connection.get("headline"))

        if person_id not in seen_person_ids:
            seen_person_ids.add(person_id)
            people.append(ProviderPerson(
                display_name=name,
                provider_record_id=person_id,
                profile_url=profile_url,
                company=company_name,
                headline=connection.get("headline"),
                location=connection.get("location"),
                confidence=float(connection.get("confidence", 1.0)),
                observed_at=parse_iso_timestamp(connection.get("captured_at") or connection.get("observed_at")),
                metadata=dict(connection),
            ))

        if company_name and company_name.casefold() not in seen_company_names:
            seen_company_names.add(company_name.casefold())
            companies.append(ProviderCompany(
                name=company_name,
                provider_record_id=f"company:{company_name.casefold()}",
                metadata={"source_record": dict(connection)},
            ))

        # Direct KNOWS relationship from owner to connection
        relationships.append(ProviderRelationship(
            source_provider_record_id=owner_record_id,
            target_provider_record_id=person_id,
            relationship_type="KNOWS",
            confidence=float(connection.get("confidence", 1.0)),
            provider_record_id=f"rel:{owner_record_id}:{person_id}",
            metadata=dict(connection),
        ))

    # Process relationship evidence
    relationship_evidence = payload.get("relationship_evidence", [])
    for item in relationship_evidence:
        profile_url = item.get("profile_url")
        name = item.get("name") or "Unknown Evidence Target"
        person_id = item.get("source_record_id") or profile_url or f"evidence:{name}"
        company_name = item.get("company") or parse_company_from_headline(item.get("headline"))

        if person_id not in seen_person_ids:
            seen_person_ids.add(person_id)
            people.append(ProviderPerson(
                display_name=name,
                provider_record_id=person_id,
                profile_url=profile_url,
                company=company_name,
                headline=item.get("headline"),
                location=item.get("location"),
                confidence=float(item.get("confidence", 1.0)),
                observed_at=parse_iso_timestamp(item.get("captured_at")),
                metadata=dict(item),
            ))

        if company_name and company_name.casefold() not in seen_company_names:
            seen_company_names.add(company_name.casefold())
            companies.append(ProviderCompany(
                name=company_name,
                provider_record_id=f"company:{company_name.casefold()}",
                metadata={"source_record": dict(item)},
            ))

        mutual_names = tuple(item.get("mutual_connection_names", []))
        evidence.append(ProviderEvidence(
            target_provider_record_id=person_id,
            evidence_type=item.get("evidence_type", "relationship_evidence"),
            observed_degree=item.get("observed_degree", "2nd"),
            mutual_connection_names=mutual_names,
            confidence=float(item.get("confidence", 1.0)),
            observed_at=parse_iso_timestamp(item.get("captured_at")),
            provider_record_id=f"ev:{person_id}:{item.get('observed_degree', '2nd')}",
            metadata=dict(item),
        ))

    return ProviderSnapshot(
        provider_name=provider_name,
        people=tuple(people),
        companies=tuple(companies),
        relationships=tuple(relationships),
        evidence=tuple(evidence),
        observed_at=datetime.utcnow(),
    )
