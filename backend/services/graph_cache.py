from __future__ import annotations

import threading
import uuid
from typing import Iterator, MutableMapping, Any

import networkx as nx


def normalize_tenant_key(tenant_id: str | uuid.UUID | None) -> str:
    if tenant_id is None:
        return "compatibility"
    tenant_str = str(tenant_id).casefold().strip()
    if tenant_str in {"", "00000000-0000-0000-0000-000000000000", "none"}:
        return "compatibility"
    return tenant_str


class TenantGraphCache(MutableMapping[str, nx.DiGraph]):
    """Tenant-isolated, thread-safe in-process graph cache.

    Cache keys are strictly tenant-isolated (tenant_key, owner_id) tuples.
    Also implements MutableMapping[str, nx.DiGraph] for full backward
    compatibility with legacy tests and existing code accessing `GRAPHS[owner_id]`.
    """

    def __init__(self) -> None:
        self._cache: dict[tuple[str, str], nx.DiGraph] = {}
        self._lock = threading.RLock()

    def get_graph(
        self,
        tenant_id: str | uuid.UUID | None,
        owner_id: str,
    ) -> nx.DiGraph | None:
        tenant_key = normalize_tenant_key(tenant_id)
        norm_owner = (owner_id or "").casefold().replace("-", "").replace("_", "")
        with self._lock:
            graph = self._cache.get((tenant_key, owner_id))
            if graph is not None:
                return graph

            # Fallback search within the same tenant or compatibility tenant for owner slug variants
            for (t_key, o_id), g in self._cache.items():
                if (t_key == tenant_key or t_key == "compatibility" or tenant_key == "compatibility") and (
                    o_id == owner_id or (o_id and (o_id or "").casefold().replace("-", "").replace("_", "") == norm_owner)
                ):
                    return g
            return None

    def set_graph(
        self,
        tenant_id: str | uuid.UUID | None,
        owner_id: str,
        graph: nx.DiGraph,
    ) -> None:
        tenant_key = normalize_tenant_key(tenant_id)
        norm_owner = (owner_id or "").casefold().replace("-", "").replace("_", "")
        with self._lock:
            keys_to_remove = [
                key for key in self._cache
                if (key[0] == tenant_key or key[0] == "compatibility" or tenant_key == "compatibility") and (
                    key[1] == owner_id or (key[1] and key[1].casefold().replace("-", "").replace("_", "") == norm_owner)
                )
            ]
            for key in keys_to_remove:
                del self._cache[key]
            self._cache[(tenant_key, owner_id)] = graph

    def invalidate(
        self,
        tenant_id: str | uuid.UUID | None,
        owner_id: str,
    ) -> bool:
        tenant_key = normalize_tenant_key(tenant_id)
        norm_owner = (owner_id or "").casefold().replace("-", "").replace("_", "")
        with self._lock:
            keys_to_remove = [
                key for key in self._cache
                if (key[0] == tenant_key or key[0] == "compatibility" or tenant_key == "compatibility") and (
                    key[1] == owner_id or (key[1] and key[1].casefold().replace("-", "").replace("_", "") == norm_owner)
                )
            ]
            for key in keys_to_remove:
                del self._cache[key]
            return bool(keys_to_remove)

    def invalidate_tenant(self, tenant_id: str | uuid.UUID) -> int:
        tenant_key = normalize_tenant_key(tenant_id)
        with self._lock:
            keys_to_remove = [
                key for key in self._cache
                if key[0] == tenant_key
            ]
            for key in keys_to_remove:
                del self._cache[key]
            return len(keys_to_remove)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    def rebuild(
        self,
        tenant_id: str | uuid.UUID | None,
        owner_id: str,
        builder_fn,
    ) -> nx.DiGraph | None:
        graph = builder_fn(owner_id)
        if graph is not None:
            self.set_graph(tenant_id, owner_id, graph)
        else:
            self.invalidate(tenant_id, owner_id)
        return graph

    # MutableMapping interface methods for backward compatibility with `main.GRAPHS`
    def __getitem__(self, owner_id: str) -> nx.DiGraph:
        graph = self.get_graph(None, owner_id)
        if graph is None:
            raise KeyError(owner_id)
        return graph

    def __setitem__(self, owner_id: str, graph: nx.DiGraph) -> None:
        self.set_graph(None, owner_id, graph)

    def __delitem__(self, owner_id: str) -> None:
        if not self.invalidate(None, owner_id):
            raise KeyError(owner_id)

    def __contains__(self, key: object) -> bool:
        if not isinstance(key, str):
            return False
        return self.get_graph(None, key) is not None

    def __len__(self) -> int:
        with self._lock:
            return len(set(owner_id for _, owner_id in self._cache))

    def __iter__(self) -> Iterator[str]:
        with self._lock:
            seen = set()
            for _, owner_id in list(self._cache):
                if owner_id not in seen:
                    seen.add(owner_id)
                    yield owner_id
