from abc import ABC, abstractmethod
from typing import Any

from .contracts import ProviderSnapshot


class RelationshipDataProvider(ABC):
    """Provider boundary; graph code consumes normalized records only."""

    name = "provider"

    def fetch_snapshot(self, owner_id: str) -> ProviderSnapshot:
        """Return normalized provider data without touching persistence or graphs."""
        return ProviderSnapshot(provider_name=self.name)

    @abstractmethod
    def get_owner_identity(self, owner_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    @abstractmethod
    def get_connections(self, owner_id: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def get_relationship_evidence(self, owner_id: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def search_people(self, query: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def search_company_people(
        self,
        company: str,
        role_filters: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def refresh(self, owner_id: str) -> dict[str, Any]:
        raise NotImplementedError
