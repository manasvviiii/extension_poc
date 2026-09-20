from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Iterable

from .normalization import (
    normalize_company_name,
    normalize_domain,
    normalize_email,
    normalize_profile_url,
    normalize_person_name,
)


class ResolutionOutcome(str, Enum):
    EXACT = "exact"
    STRONG = "strong"
    POSSIBLE = "possible"
    UNRESOLVED = "unresolved"


@dataclass(frozen=True)
class Resolution:
    outcome: ResolutionOutcome
    entity_id: Any | None
    method: str
    confidence: float
    reason: str

    @property
    def should_merge(self) -> bool:
        return self.entity_id is not None and self.outcome in {
            ResolutionOutcome.EXACT,
            ResolutionOutcome.STRONG,
        }


def _value(candidate: Any, field: str) -> Any:
    if isinstance(candidate, dict):
        return candidate.get(field)
    return getattr(candidate, field, None)


def _person_keys(record: Any) -> dict[str, str | None]:
    return {
        "provider_id": str(_value(record, "provider_record_id") or "") or None,
        "profile_url": normalize_profile_url(_value(record, "profile_url")),
        "email": normalize_email(_value(record, "email")),
        "name": normalize_person_name(_value(record, "display_name") or _value(record, "name")),
        "company": normalize_company_name(_value(record, "company")),
        "headline": _collapse_text(_value(record, "headline")),
    }


def _company_keys(record: Any) -> dict[str, str | None]:
    name = _value(record, "name") or _value(record, "display_name") or _value(record, "company")
    return {
        "provider_id": str(_value(record, "provider_record_id") or "") or None,
        "domain": normalize_domain(_value(record, "domain") or _value(record, "company_domain")),
        "name": normalize_company_name(name),
    }


def _collapse_text(value: str | None) -> str:
    return " ".join((value or "").casefold().split())


def resolve_person(record: Any, candidates: Iterable[Any]) -> Resolution:
    keys = _person_keys(record)
    candidates = list(candidates)

    if keys["provider_id"]:
        for candidate in candidates:
            if _person_keys(candidate)["provider_id"] == keys["provider_id"]:
                return Resolution(ResolutionOutcome.EXACT, _value(candidate, "id"), "provider_record_id", 1.0, "Exact provider person ID match")

    if keys["profile_url"]:
        for candidate in candidates:
            if _person_keys(candidate)["profile_url"] == keys["profile_url"]:
                return Resolution(ResolutionOutcome.EXACT, _value(candidate, "id"), "canonical_profile_url", 0.99, "Exact canonical profile URL match")

    if keys["email"]:
        email_matches = [candidate for candidate in candidates if _person_keys(candidate)["email"] == keys["email"]]
        if len(email_matches) == 1:
            return Resolution(ResolutionOutcome.STRONG, _value(email_matches[0], "id"), "normalized_email", 0.97, "Unique normalized email match")
        if len(email_matches) > 1:
            return Resolution(ResolutionOutcome.POSSIBLE, None, "normalized_email_ambiguous", 0.5, "Email matched multiple tenant entities")

    supporting_matches = [
        candidate for candidate in candidates
        if keys["name"]
        and _person_keys(candidate)["name"] == keys["name"]
        and (
            keys["company"] and _person_keys(candidate)["company"] == keys["company"]
            or keys["headline"] and _person_keys(candidate)["headline"] == keys["headline"]
        )
    ]
    if len(supporting_matches) == 1:
        return Resolution(ResolutionOutcome.STRONG, _value(supporting_matches[0], "id"), "name_and_supporting_attribute", 0.90, "Normalized name plus company or headline match")
    if len(supporting_matches) > 1:
        return Resolution(ResolutionOutcome.POSSIBLE, None, "name_and_supporting_attribute_ambiguous", 0.5, "Multiple candidates matched the normalized name and supporting attributes")

    return Resolution(ResolutionOutcome.UNRESOLVED, None, "none", 0.0, "No sufficiently strong tenant-scoped identity match")


def resolve_company(record: Any, candidates: Iterable[Any]) -> Resolution:
    keys = _company_keys(record)
    candidates = list(candidates)

    if keys["provider_id"]:
        for candidate in candidates:
            if _company_keys(candidate)["provider_id"] == keys["provider_id"]:
                return Resolution(ResolutionOutcome.EXACT, _value(candidate, "id"), "provider_record_id", 1.0, "Exact provider company ID match")

    if keys["domain"]:
        domain_matches = [candidate for candidate in candidates if _company_keys(candidate)["domain"] == keys["domain"]]
        if len(domain_matches) == 1:
            return Resolution(ResolutionOutcome.STRONG, _value(domain_matches[0], "id"), "canonical_domain", 0.96, "Unique canonical domain match")
        if len(domain_matches) > 1:
            return Resolution(ResolutionOutcome.POSSIBLE, None, "canonical_domain_ambiguous", 0.5, "Domain matched multiple tenant entities")

    name_matches = [candidate for candidate in candidates if keys["name"] and _company_keys(candidate)["name"] == keys["name"]]
    if len(name_matches) == 1:
        return Resolution(ResolutionOutcome.STRONG, _value(name_matches[0], "id"), "normalized_company_name", 0.85, "Unique normalized company name match")
    if len(name_matches) > 1:
        return Resolution(ResolutionOutcome.POSSIBLE, None, "normalized_company_name_ambiguous", 0.5, "Company name matched multiple tenant entities")

    return Resolution(ResolutionOutcome.UNRESOLVED, None, "none", 0.0, "No sufficiently strong tenant-scoped company match")
