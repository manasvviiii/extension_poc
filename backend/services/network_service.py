from __future__ import annotations

from typing import Any
from auth.context import AuthContext


def save_connections(
    owner_id: str,
    connections: list[dict[str, Any]],
    auth_context: AuthContext | None = None,
) -> dict[str, Any]:
    """
    Save or update direct connection records for the canonical owner.
    """
    from main import load_network, save_network

    existing = load_network(owner_id, auth_context) or {
        "owner_id": owner_id,
        "connections": [],
        "relationship_evidence": [],
    }
    existing["connections"] = connections
    existing["connection_count"] = len(connections)
    save_network(owner_id, existing, auth_context)
    return existing


def save_relationship_evidence(
    owner_id: str,
    evidence: list[dict[str, Any]],
    auth_context: AuthContext | None = None,
) -> dict[str, Any]:
    """
    Save or update 2nd degree relationship evidence records for the canonical owner.
    """
    from main import load_network, save_network

    existing = load_network(owner_id, auth_context) or {
        "owner_id": owner_id,
        "connections": [],
        "relationship_evidence": [],
    }
    existing["relationship_evidence"] = evidence
    existing["relationship_evidence_count"] = len(evidence)
    save_network(owner_id, existing, auth_context)
    return existing


def load_network_service(
    owner_id: str,
    auth_context: AuthContext | None = None,
) -> dict[str, Any] | None:
    """
    Retrieve stored raw network connections and evidence for owner.
    """
    from main import load_network

    return load_network(owner_id, auth_context)
