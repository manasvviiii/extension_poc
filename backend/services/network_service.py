from __future__ import annotations

from typing import Any
from auth.context import AuthContext


from repositories.repository_provider import get_graph_repository


def save_connections(
    owner_id: str,
    connections: list[dict[str, Any]],
    auth_context: AuthContext | None = None,
) -> dict[str, Any]:
    """
    Save or update direct connection records for the canonical owner using GraphRepository.
    """
    repo = get_graph_repository()
    repo.save_people(owner_id, connections)
    return repo.get_network(owner_id) or {"owner_id": owner_id, "connections": connections, "relationship_evidence": []}


def save_relationship_evidence(
    owner_id: str,
    evidence: list[dict[str, Any]],
    auth_context: AuthContext | None = None,
) -> dict[str, Any]:
    """
    Save or update 2nd degree relationship evidence records for the canonical owner using GraphRepository.
    """
    repo = get_graph_repository()
    repo.save_relationships(owner_id, evidence)
    return repo.get_network(owner_id) or {"owner_id": owner_id, "connections": [], "relationship_evidence": evidence}


def load_network_service(
    owner_id: str,
    auth_context: AuthContext | None = None,
) -> dict[str, Any] | None:
    """
    Retrieve stored raw network connections and evidence for owner using GraphRepository.
    """
    repo = get_graph_repository()
    return repo.get_network(owner_id)
