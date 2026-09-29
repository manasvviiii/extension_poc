from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any
import networkx as nx


class GraphRepository(ABC):
    """
    Abstract GraphRepository interface separating graph operations and storage logic
    from downstream scoring, pathfinder, and API layers.
    """

    @abstractmethod
    def get_network(self, user_id: str) -> dict[str, Any] | None:
        """Retrieve full network dataset for a user."""
        pass

    @abstractmethod
    def save_network(self, user_id: str, network: dict[str, Any]) -> None:
        """Save full network dataset for a user."""
        pass

    @abstractmethod
    def get_people(self, user_id: str) -> list[dict[str, Any]]:
        """Retrieve connection/people records for a user."""
        pass

    @abstractmethod
    def save_people(self, user_id: str, people: list[dict[str, Any]]) -> None:
        """Save connection/people records for a user."""
        pass

    @abstractmethod
    def get_relationships(self, user_id: str) -> list[dict[str, Any]]:
        """Retrieve relationship evidence/edge records for a user."""
        pass

    @abstractmethod
    def save_relationships(self, user_id: str, edges: list[dict[str, Any]]) -> None:
        """Save relationship evidence/edge records for a user."""
        pass

    @abstractmethod
    def delete_network(self, user_id: str) -> bool:
        """Delete network data and invalidate graph cache for a user."""
        pass

    @abstractmethod
    def get_graph(self, user_id: str, auth_context: Any = None) -> nx.DiGraph | None:
        """Retrieve constructed or cached NetworkX graph for a user."""
        pass

    @abstractmethod
    def replace_graph(self, user_id: str, graph: nx.DiGraph, auth_context: Any = None) -> nx.DiGraph:
        """Store NetworkX graph in cache for a user."""
        pass

    @abstractmethod
    def invalidate_graph(self, user_id: str, auth_context: Any = None) -> bool:
        """Invalidate cached graph for a user."""
        pass

    @abstractmethod
    def list_users(self) -> list[str]:
        """List all user IDs stored in the repository."""
        pass

    @abstractmethod
    def get_users(self) -> list[dict[str, Any]]:
        """Retrieve list of user schema objects."""
        pass

    @abstractmethod
    def create_user(self, user_data: dict[str, Any]) -> dict[str, Any]:
        """Create or register a user schema object."""
        pass

    @abstractmethod
    def update_user(self, user_id: str, user_data: dict[str, Any]) -> dict[str, Any] | None:
        """Update properties of an existing user."""
        pass

    @abstractmethod
    def delete_user(self, user_id: str) -> bool:
        """Delete user schema record and associated network data."""
        pass

    @abstractmethod
    def get_user(self, user_id: str) -> dict[str, Any] | None:
        """Retrieve user schema object by user ID."""
        pass

    @abstractmethod
    def get_user_stats(self, user_id: str) -> dict[str, Any]:
        """Retrieve aggregated network statistics for a user."""
        pass
