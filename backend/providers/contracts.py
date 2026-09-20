from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class ProviderPerson:
    display_name: str
    provider_record_id: str | None = None
    profile_url: str | None = None
    email: str | None = None
    company: str | None = None
    headline: str | None = None
    location: str | None = None
    confidence: float = 1.0
    observed_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProviderCompany:
    name: str
    provider_record_id: str | None = None
    domain: str | None = None
    confidence: float = 1.0
    observed_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProviderRelationship:
    source_provider_record_id: str
    target_provider_record_id: str | None = None
    target_company_provider_record_id: str | None = None
    relationship_type: str = "KNOWS"
    confidence: float = 1.0
    observed_at: datetime | None = None
    provider_record_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProviderEvidence:
    target_provider_record_id: str | None
    evidence_type: str
    observed_degree: str | None = None
    mutual_connection_names: tuple[str, ...] = ()
    confidence: float = 1.0
    observed_at: datetime | None = None
    provider_record_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProviderSnapshot:
    provider_name: str
    people: tuple[ProviderPerson, ...] = ()
    companies: tuple[ProviderCompany, ...] = ()
    relationships: tuple[ProviderRelationship, ...] = ()
    evidence: tuple[ProviderEvidence, ...] = ()
    observed_at: datetime | None = None
