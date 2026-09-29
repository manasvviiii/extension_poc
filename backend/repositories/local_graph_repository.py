from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any
import networkx as nx

from .graph_repository import GraphRepository
from services.graph_cache import TenantGraphCache

BASE_DIR = Path(__file__).resolve().parent.parent
GRAPHS_DIR = BASE_DIR / "data" / "graphs"
NETWORKS_DIR = BASE_DIR / "data" / "networks"
FIXTURES_DIR = BASE_DIR / "data" / "fixtures"
USERS_FILE = BASE_DIR / "data" / "users.json"


class LocalGraphRepository(GraphRepository):
    """
    Local-first multi-tenant implementation of GraphRepository backed by JSON file storage
    and thread-safe TenantGraphCache.
    """

    def __init__(self, data_dir: Path | None = None, cache: TenantGraphCache | None = None) -> None:
        self.graphs_dir = data_dir or GRAPHS_DIR
        self.graphs_dir.mkdir(parents=True, exist_ok=True)
        NETWORKS_DIR.mkdir(parents=True, exist_ok=True)
        self.cache = cache if cache is not None else TenantGraphCache()
        self.users_file = USERS_FILE

    def _file_path(self, user_id: str) -> Path:
        safe_user = (user_id or "default").replace("/", "_").replace("\\", "_")
        primary_path = self.graphs_dir / f"{safe_user}.json"
        if primary_path.exists():
            return primary_path
        
        legacy_path = NETWORKS_DIR / f"{safe_user}.json"
        if legacy_path.exists():
            return legacy_path
            
        fixture_path = FIXTURES_DIR / f"{safe_user}.json"
        if fixture_path.exists():
            return fixture_path

        return primary_path

    def get_network(self, user_id: str) -> dict[str, Any] | None:
        path = self._file_path(user_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def save_network(self, user_id: str, network: dict[str, Any]) -> None:
        safe_user = (user_id or "default").replace("/", "_").replace("\\", "_")
        path = self.graphs_dir / f"{safe_user}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(network, indent=2, ensure_ascii=False), encoding="utf-8")
        self.invalidate_graph(user_id)
        self._ensure_user_synced(user_id)

    def get_people(self, user_id: str) -> list[dict[str, Any]]:
        net = self.get_network(user_id)
        if not net:
            return []
        return net.get("connections", [])

    def save_people(self, user_id: str, people: list[dict[str, Any]]) -> None:
        net = self.get_network(user_id) or {"owner_id": user_id, "connections": [], "relationship_evidence": []}
        net["connections"] = people
        net["connection_count"] = len(people)
        self.save_network(user_id, net)

    def get_relationships(self, user_id: str) -> list[dict[str, Any]]:
        net = self.get_network(user_id)
        if not net:
            return []
        return net.get("relationship_evidence", [])

    def save_relationships(self, user_id: str, edges: list[dict[str, Any]]) -> None:
        net = self.get_network(user_id) or {"owner_id": user_id, "connections": [], "relationship_evidence": []}
        net["relationship_evidence"] = edges
        net["relationship_evidence_count"] = len(edges)
        self.save_network(user_id, net)

    def delete_network(self, user_id: str) -> bool:
        self.invalidate_graph(user_id)
        deleted = False
        safe_user = (user_id or "default").replace("/", "_").replace("\\", "_")
        for p in (self.graphs_dir / f"{safe_user}.json", NETWORKS_DIR / f"{safe_user}.json"):
            if p.exists():
                try:
                    p.unlink()
                    deleted = True
                except OSError:
                    pass
        return deleted

    def get_graph(self, user_id: str, auth_context: Any = None) -> nx.DiGraph | None:
        tenant_id = auth_context.tenant_id if hasattr(auth_context, "tenant_id") and hasattr(auth_context, "authenticated") and auth_context.authenticated else None
        return self.cache.get_graph(tenant_id, user_id)

    def replace_graph(self, user_id: str, graph: nx.DiGraph, auth_context: Any = None) -> nx.DiGraph:
        tenant_id = auth_context.tenant_id if hasattr(auth_context, "tenant_id") and hasattr(auth_context, "authenticated") and auth_context.authenticated else None
        self.cache.invalidate(tenant_id, user_id)
        self.cache.set_graph(tenant_id, user_id, graph)
        return graph

    def invalidate_graph(self, user_id: str, auth_context: Any = None) -> bool:
        tenant_id = auth_context.tenant_id if hasattr(auth_context, "tenant_id") and hasattr(auth_context, "authenticated") and auth_context.authenticated else None
        return self.cache.invalidate(tenant_id, user_id)

    def list_users(self) -> list[str]:
        u_records = self.get_users()
        return [u["id"] for u in u_records if "id" in u]

    # -----------------------------------------------------
    # USER MANAGEMENT METHODS (TASK 13.4)
    # -----------------------------------------------------

    def _load_users_raw(self) -> list[dict[str, Any]]:
        if not self.users_file.exists():
            return []
        try:
            data = json.loads(self.users_file.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    def _save_users_raw(self, users: list[dict[str, Any]]) -> None:
        self.users_file.parent.mkdir(parents=True, exist_ok=True)
        self.users_file.write_text(json.dumps(users, indent=2, ensure_ascii=False), encoding="utf-8")

    def get_users(self) -> list[dict[str, Any]]:
        users = self._load_users_raw()
        existing_ids = {u["id"] for u in users if isinstance(u, dict) and "id" in u}

        disk_user_ids = set()
        for d in (self.graphs_dir, NETWORKS_DIR, FIXTURES_DIR):
            if d.exists():
                for p in d.glob("*.json"):
                    if p.name == "users.json":
                        continue
                    try:
                        content = json.loads(p.read_text(encoding="utf-8"))
                        if isinstance(content, dict):
                            uid = content.get("owner_id") or p.stem
                            if uid:
                                disk_user_ids.add(uid)
                    except Exception:
                        disk_user_ids.add(p.stem)

        if "local_user" not in existing_ids and "local_user" not in disk_user_ids:
            disk_user_ids.add("local_user")

        changed = False
        for uid in disk_user_ids:
            if uid not in existing_ids:
                new_u = {
                    "id": uid,
                    "name": "WarmGraph User" if uid == "local_user" else uid.replace("_", " ").replace("-", " ").title(),
                    "email": f"{uid}@warmgraph.dev",
                    "avatar": "",
                    "provider": "local",
                    "created_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "last_sync": datetime.utcnow().strftime("%b %d, %Y")
                }
                users.append(new_u)
                existing_ids.add(uid)
                changed = True

        if changed or not self.users_file.exists():
            self._save_users_raw(users)

        return users

    def get_user(self, user_id: str) -> dict[str, Any] | None:
        for u in self.get_users():
            if u.get("id") == user_id:
                return u
        return None

    def create_user(self, user_data: dict[str, Any]) -> dict[str, Any]:
        user_id = user_data.get("id")
        if not user_id:
            user_id = f"user_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

        record = {
            "id": user_id,
            "name": user_data.get("name") or (user_id.replace("_", " ").replace("-", " ").title() if user_id != "local_user" else "WarmGraph User"),
            "email": user_data.get("email") or f"{user_id}@warmgraph.dev",
            "avatar": user_data.get("avatar") or "",
            "provider": user_data.get("provider") or "local",
            "created_at": user_data.get("created_at") or datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            "last_sync": user_data.get("last_sync") or datetime.utcnow().strftime("%b %d, %Y")
        }

        users = self._load_users_raw()
        idx = next((i for i, u in enumerate(users) if u.get("id") == user_id), None)
        if idx is not None:
            users[idx].update(record)
            record = users[idx]
        else:
            users.append(record)

        self._save_users_raw(users)
        return record

    def update_user(self, user_id: str, user_data: dict[str, Any]) -> dict[str, Any] | None:
        users = self._load_users_raw()
        idx = next((i for i, u in enumerate(users) if u.get("id") == user_id), None)
        if idx is None:
            return None

        users[idx].update(user_data)
        self._save_users_raw(users)
        return users[idx]

    def delete_user(self, user_id: str) -> bool:
        users = self._load_users_raw()
        new_users = [u for u in users if u.get("id") != user_id]
        if len(new_users) != len(users):
            self._save_users_raw(new_users)

        self.delete_network(user_id)
        return True

    def get_user_stats(self, user_id: str) -> dict[str, Any]:
        user_rec = self.get_user(user_id)
        net = self.get_network(user_id)

        if net is None:
            return {
                "connections": 0,
                "companies": 0,
                "relationships": 0,
                "last_sync": user_rec.get("last_sync") if user_rec else "N/A",
                "status": "Error"
            }

        conns = net.get("connections", [])
        ev = net.get("relationship_evidence", [])

        comps = set()
        for c in conns:
            comp = c.get("company") or c.get("headline")
            if comp and isinstance(comp, str) and len(comp.strip()) > 2:
                clean_comp = comp.strip().replace("|", "").strip()
                if clean_comp and not any(k in clean_comp.lower() for k in ["linkedin", "profile", "connection"]):
                    comps.add(clean_comp)

        last_sync = net.get("last_synced_at") or net.get("updated_at") or (user_rec.get("last_sync") if user_rec else None) or datetime.utcnow().strftime("%b %d, %Y")
        status = self._determine_status(net, user_rec)

        return {
            "connections": len(conns),
            "companies": len(comps),
            "relationships": len(ev),
            "last_sync": last_sync,
            "status": status
        }

    def _determine_status(self, net: dict | None, user_rec: dict | None) -> str:
        if net is None:
            return "Error"
        conns = net.get("connections", [])
        ev = net.get("relationship_evidence", [])
        if not conns and not ev:
            return "Idle"

        last_sync = net.get("last_synced_at") or net.get("updated_at") or (user_rec.get("last_sync") if user_rec else None)
        if not last_sync or last_sync == "Just now":
            return "Active"

        for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S", "%b %d, %Y", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(str(last_sync).strip(), fmt)
                delta = datetime.utcnow() - dt
                if delta.total_seconds() < 86400:
                    return "Active"
                else:
                    return "Idle"
            except ValueError:
                continue

        return "Active"

    def _ensure_user_synced(self, user_id: str) -> None:
        user_rec = self.get_user(user_id)
        now_str = datetime.utcnow().strftime("%b %d, %Y")
        if user_rec:
            self.update_user(user_id, {"last_sync": now_str})
        else:
            self.create_user({"id": user_id, "last_sync": now_str})
