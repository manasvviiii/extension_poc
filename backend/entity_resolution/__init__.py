"""Deterministic, tenant-scoped entity normalization and resolution."""

from .normalization import (
    normalize_company_name,
    normalize_domain,
    normalize_email,
    normalize_profile_url,
    normalize_person_name,
)
from .resolver import Resolution, ResolutionOutcome, resolve_company, resolve_person

__all__ = [
    "Resolution",
    "ResolutionOutcome",
    "normalize_company_name",
    "normalize_domain",
    "normalize_email",
    "normalize_person_name",
    "normalize_profile_url",
    "resolve_company",
    "resolve_person",
]
