from typing import Any

from .provider_base import RelationshipDataProvider
from .contracts import ProviderSnapshot


class ApprovedProviderUnavailable(RuntimeError):
    pass


class ApprovedRelationshipDataProvider(RelationshipDataProvider):
    """Explicit production seam for a licensed or official provider.

    This class intentionally performs no LinkedIn access. Configure a real
    approved implementation here when one is available.
    """

    name = "approved"

    def fetch_snapshot(self, owner_id: str) -> ProviderSnapshot:
        self._unavailable()

    def _unavailable(self) -> None:
        raise ApprovedProviderUnavailable(
            "No approved relationship data provider is configured."
        )

    def get_owner_identity(self, owner_id: str) -> dict[str, Any] | None:
        self._unavailable()

    def get_connections(self, owner_id: str) -> list[dict[str, Any]]:
        self._unavailable()

    def get_relationship_evidence(self, owner_id: str) -> list[dict[str, Any]]:
        self._unavailable()

    def search_people(self, query: str) -> list[dict[str, Any]]:
        self._unavailable()

    def search_company_people(
        self,
        company: str,
        role_filters: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        self._unavailable()

    def refresh(self, owner_id: str) -> dict[str, Any]:
        self._unavailable()
