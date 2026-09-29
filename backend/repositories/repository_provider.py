from __future__ import annotations

from .graph_repository import GraphRepository
from .local_graph_repository import LocalGraphRepository

_GRAPH_REPOSITORY_INSTANCE: GraphRepository | None = None


def get_graph_repository() -> GraphRepository:
    """
    Factory function returning the active GraphRepository implementation.
    Local first implementation returns LocalGraphRepository.
    In production cloud mode, this can be swapped with PostgresGraphRepository.
    """
    global _GRAPH_REPOSITORY_INSTANCE
    if _GRAPH_REPOSITORY_INSTANCE is None:
        _GRAPH_REPOSITORY_INSTANCE = LocalGraphRepository()
    return _GRAPH_REPOSITORY_INSTANCE


def set_graph_repository(repository: GraphRepository | None) -> None:
    """Override active GraphRepository instance (useful for tests or cloud backend swapping)."""
    global _GRAPH_REPOSITORY_INSTANCE
    _GRAPH_REPOSITORY_INSTANCE = repository
