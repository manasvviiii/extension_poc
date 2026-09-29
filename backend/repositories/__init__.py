"""Database & Graph repositories."""

from .graph_repository import GraphRepository
from .local_graph_repository import LocalGraphRepository
from .repository_provider import get_graph_repository, set_graph_repository
try:
    from .networks import PostgresNetworkRepository
except ImportError:
    PostgresNetworkRepository = None

__all__ = [
    "GraphRepository",
    "LocalGraphRepository",
    "PostgresNetworkRepository",
    "get_graph_repository",
    "set_graph_repository",
]
