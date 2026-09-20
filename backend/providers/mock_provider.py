from pathlib import Path
from typing import Any

import json

from .provider_base import RelationshipDataProvider
from .contracts import ProviderCompany, ProviderEvidence, ProviderPerson, ProviderSnapshot


class MockRelationshipDataProvider(RelationshipDataProvider):
    """Fixture-only provider for backend tests and local UI development."""

    name = "mock"

    def __init__(self, records: list[dict[str, Any]] | None = None):
        self.records = records or []

    @classmethod
    def from_json(cls, path: str | Path) -> "MockRelationshipDataProvider":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(data if isinstance(data, list) else data.get("people", []))

    def get_owner_identity(self, owner_id: str) -> dict[str, Any]:
        return {"owner_id": owner_id, "display_name": owner_id}

    def get_connections(self, owner_id: str) -> list[dict[str, Any]]:
        return [record for record in self.records if record.get("owner_id") == owner_id]

    def get_relationship_evidence(self, owner_id: str) -> list[dict[str, Any]]:
        return []

    def search_people(self, query: str) -> list[dict[str, Any]]:
        needle = query.casefold()
        return [
            record for record in self.records
            if needle in " ".join(
                str(record.get(field, ""))
                for field in ("name", "headline", "company", "profile_url")
            ).casefold()
        ]

    def search_company_people(
        self,
        company: str,
        role_filters: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        needle = company.casefold()
        return [
            record for record in self.records
            if needle in str(record.get("company", "")).casefold()
            and (
                not role_filters
                or any(
                    role.casefold() in str(record.get("headline", "")).casefold()
                    for role in role_filters
                )
            )
        ]

    def refresh(self, owner_id: str) -> dict[str, Any]:
        return {"owner_id": owner_id, "records": self.get_connections(owner_id)}

    def fetch_snapshot(self, owner_id: str) -> ProviderSnapshot:
        records = self.get_connections(owner_id)
        people = tuple(
            ProviderPerson(
                display_name=record.get("name", ""),
                provider_record_id=record.get("provider_record_id") or record.get("source_record_id"),
                profile_url=record.get("profile_url"),
                email=record.get("email"),
                company=record.get("company"),
                headline=record.get("headline"),
                location=record.get("location"),
                confidence=float(record.get("confidence", 1.0)),
                metadata={"source": self.name, **record},
            )
            for record in records
        )
        return ProviderSnapshot(provider_name=self.name, people=people)
