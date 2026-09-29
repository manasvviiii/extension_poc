from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from repositories.repository_provider import get_graph_repository

BASE_DIR = Path(__file__).resolve().parent.parent
SESSIONS_FILE = BASE_DIR / "data" / "sync_sessions.json"


class CloudSyncService:
    """
    Cloud synchronization service (Offline SaaS Layer).
    Uses GraphRepository ONLY for network persistence — zero direct storage or cache imports.
    """

    def __init__(self, repository=None, sessions_file: Path | None = None):
        self.repository = repository or get_graph_repository()
        self.sessions_file = sessions_file or SESSIONS_FILE

    def _load_sessions(self) -> List[Dict[str, Any]]:
        if not self.sessions_file.exists():
            return []
        try:
            data = json.loads(self.sessions_file.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except Exception:
            return []

    def _save_sessions(self, sessions: List[Dict[str, Any]]) -> None:
        self.sessions_file.parent.mkdir(parents=True, exist_ok=True)
        self.sessions_file.write_text(json.dumps(sessions, indent=2, ensure_ascii=False), encoding="utf-8")

    def sync_network(self, user_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        started_at = datetime.utcnow()
        conn_data = payload.get("connections") or payload.get("added_connections") or []
        ev_data = payload.get("relationship_evidence") or payload.get("relationship_evidence_added") or []

        existing_net = self.repository.get_network(user_id) or {
            "owner_id": user_id,
            "connections": [],
            "relationship_evidence": []
        }

        # Merge connections cleanly
        conn_map = {c["profile_url"]: c for c in existing_net.get("connections", []) if c.get("profile_url")}
        for c in conn_data:
            url = c.get("profile_url")
            if url:
                conn_map[url] = c

        merged_connections = list(conn_map.values()) if conn_map else conn_data

        # Merge evidence cleanly
        ev_map = {(e.get("profile_url"), e.get("observed_degree")): e for e in existing_net.get("relationship_evidence", []) if e.get("profile_url")}
        for e in ev_data:
            key = (e.get("profile_url"), e.get("observed_degree"))
            ev_map[key] = e

        merged_evidence = list(ev_map.values()) if ev_map else ev_data

        network_data = {
            "owner_id": user_id,
            "source": payload.get("source", "linkedin_dom"),
            "connection_count": len(merged_connections),
            "connections": merged_connections,
            "relationship_evidence_count": len(merged_evidence),
            "relationship_evidence": merged_evidence,
            "last_synced_at": datetime.utcnow().strftime("%b %d, %Y")
        }

        # Persist network dataset via GraphRepository ONLY
        self.repository.save_network(user_id, network_data)

        completed_at = datetime.utcnow()
        duration_ms = int((completed_at - started_at).total_seconds() * 1000)

        session_id = f"sync_{uuid.uuid4().hex[:8]}"
        session = {
            "id": session_id,
            "user_id": user_id,
            "started_at": started_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "completed_at": completed_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "connections": len(merged_connections),
            "relationships": len(merged_evidence),
            "status": "completed",
            "duration_ms": max(duration_ms, 150)
        }

        sessions = self._load_sessions()
        sessions.insert(0, session)  # Keep newest first
        self._save_sessions(sessions)

        return {
            "success": True,
            "user_id": user_id,
            "session_id": session_id,
            "connections": len(merged_connections),
            "relationships": len(merged_evidence),
            "status": "completed",
            "last_sync": session["completed_at"]
        }

    def sync_relationships(self, user_id: str, evidence: List[Dict[str, Any]] | Dict[str, Any]) -> Dict[str, Any]:
        evidence_list = evidence if isinstance(evidence, list) else (evidence.get("evidence") or evidence.get("relationship_evidence") or [])
        existing_edges = self.repository.get_relationships(user_id)

        ev_map = {(e.get("profile_url"), e.get("observed_degree")): e for e in existing_edges if e.get("profile_url")}
        for e in evidence_list:
            key = (e.get("profile_url"), e.get("observed_degree"))
            ev_map[key] = e

        merged_edges = list(ev_map.values())
        self.repository.save_relationships(user_id, merged_edges)

        return {
            "success": True,
            "user_id": user_id,
            "relationships_count": len(merged_edges),
            "status": "completed"
        }

    def get_sync_status(self, user_id: str) -> Dict[str, Any]:
        sessions = self.get_sync_history(user_id)
        net = self.repository.get_network(user_id)
        conns = len(net.get("connections", [])) if net else 0
        ev = len(net.get("relationship_evidence", [])) if net else 0

        last_session = sessions[0] if sessions else None
        last_sync = last_session.get("completed_at") if last_session else (net.get("last_synced_at") if net else "N/A")

        return {
            "user_id": user_id,
            "status": "completed" if net else "no_network",
            "progress": 100 if net else 0,
            "connections": conns,
            "relationships": ev,
            "last_sync": last_sync
        }

    def get_sync_history(self, user_id: str) -> List[Dict[str, Any]]:
        all_sessions = self._load_sessions()
        return [s for s in all_sessions if s.get("user_id") == user_id]
