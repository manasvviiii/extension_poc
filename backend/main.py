from pathlib import Path
from datetime import date, datetime
import os
import re
import threading
import uuid
from typing import Any

import json

import networkx as nx

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from pydantic import BaseModel, Field

from providers import (
    ApprovedProviderUnavailable,
    ApprovedRelationshipDataProvider,
    RelationshipDataProvider,
    extension_payload_to_snapshot,
)
from auth import current_context, get_auth_context
from auth.context import AuthContext, compatibility_context, require_authenticated, require_owner_access

from entity_resolution.normalization import parse_company_from_headline
from services.graph_service import (
    GraphService,
    build_graph_from_network as _service_build_graph_from_network,
    profile_node_id,
    normalized_person_name,
)
from services.scoring import (
    RECENCY_WINDOW_DAYS,
    OBSERVED_MUTUAL_BASE_SCORE,
    OBSERVED_MUTUAL_DEGREE_SCORES,
    OBSERVED_MUTUAL_EVIDENCE_SCORES,
    OBSERVED_MUTUAL_SOURCE_SCORES,
    OBSERVED_MUTUAL_MUTUAL_BONUS,
    OBSERVED_MUTUAL_MAX_MUTUAL_BONUS,
    parse_connection_date,
    graph_recency_reference_date,
    score_graph_edge,
    score_path,
    rank_paths,
)

try:
    from db.database import Database
    from repositories.networks import PostgresNetworkRepository
except ImportError:
    Database = None
    PostgresNetworkRepository = None

try:
    from pyvis.network import Network
except ImportError:
    Network = None


# =========================================================
# APP
# =========================================================

app = FastAPI(
    title="Warm Graph Backend",
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# STORAGE
# =========================================================

BASE_DIR = Path(__file__).resolve().parent

DATA_DIR = (
    BASE_DIR /
    "data" /
    "networks"
)

JOBS_DIR = BASE_DIR / "data" / "jobs"
AUDIT_DIR = BASE_DIR / "data" / "audit"
DEALS_DIR = BASE_DIR / "data" / "deals"
FIXTURES_DIR = BASE_DIR / "data" / "fixtures"

def is_demo_mode() -> bool:
    return os.getenv("DEMO_MODE", "false").casefold() in {"true", "1", "yes"}

STORAGE_BACKEND = os.getenv(
    "STORAGE_BACKEND",
    "postgres" if os.getenv("DATABASE_URL") else "json",
).casefold()
_POSTGRES_REPOSITORY = None

DATA_DIR.mkdir(
    parents=True,
    exist_ok=True
)
for storage_dir in (JOBS_DIR, AUDIT_DIR, DEALS_DIR, FIXTURES_DIR):
    storage_dir.mkdir(parents=True, exist_ok=True)


# =========================================================
# IN-MEMORY GRAPHS & GRAPH SERVICE (tenant-isolated cache)
# =========================================================

graph_service = GraphService()
GRAPHS = graph_service.cache

class GraphRepository:
    """Repository interface wrapper for GraphService persistence and retrieval."""
    def get_graph(self, owner_id: str, auth_context: AuthContext | None = None) -> nx.DiGraph | None:
        try:
            return graph_service.get_owner_graph(owner_id, auth_context=auth_context, load_network_fn=load_network)
        except HTTPException:
            return None

    def replace_graph(self, owner_id: str, graph: nx.DiGraph, auth_context: AuthContext | None = None) -> nx.DiGraph:
        return graph_service.replace_graph(owner_id, graph, auth_context=auth_context)

graph_repository = GraphRepository()

JOBS: dict[str, dict[str, Any]] = {}
ROLE_PRIORITIES = {
    "sell_side": ["CFO", "Head of Corporate Development", "CEO", "VP Corporate Development"],
    "buy_side": ["Head of M&A", "Head of Corporate Development", "CFO", "VP Corporate Development"],
}


def get_owner_graph(owner_id: str, auth_context: AuthContext | None = None) -> nx.DiGraph:
    return graph_service.get_owner_graph(owner_id, auth_context=auth_context, load_network_fn=load_network)


def authorized_context(owner_id: str, auth_value: object = None) -> AuthContext:
    context = (
        auth_value
        if isinstance(auth_value, AuthContext)
        else current_context() or compatibility_context(owner_id)
    )
    require_owner_access(context, owner_id)
    return context


def authorized_tenant_context() -> AuthContext:
    context = current_context()
    if context is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication is required for tenant-wide access",
        )
    return require_authenticated(context)


def accessible_owner_ids(auth_value: object = None) -> list[str]:
    context = (
        auth_value
        if isinstance(auth_value, AuthContext)
        else current_context()
    )
    if context is None or not context.authenticated:
        all_owners = list(GRAPHS)
        if not is_demo_mode():
            all_owners = [o for o in all_owners if o not in {"final_demo_owner", "test_owner", "empty_test_owner"}]
        return all_owners
    return [context.owner_id] if context.owner_id else []


# =========================================================
# MODELS
# =========================================================

class Connection(BaseModel):
    name: str

    profile_url: str | None = None

    connection_date: str | None = None

    headline: str | None = None

    degree: str | None = None

    relationship_type: str | None = None

    evidence_type: str | None = None

    source: str | None = None

    page_url: str | None = None

    visible_text: str | None = None


class RelationshipEvidence(BaseModel):
    name: str

    profile_url: str | None = None

    observed_degree: str

    headline: str | None = None

    location: str | None = None

    followers: str | None = None

    mutual_connections_text: str | None = None

    mutual_connection_names: list[str] = Field(
        default_factory=list
    )

    relationship_type: str | None = None

    evidence_type: str

    source: str | None = None

    page_url: str | None = None

    captured_at: str | None = None

    visible_text: str | None = None


class ImportRequest(BaseModel):
    owner_id: str

    source: str = "linkedin_dom"

    connections: list[dict[str, Any]] = Field(
        default_factory=list
    )

    relationship_evidence: list[
        dict[str, Any]
    ] = Field(
        default_factory=list
    )

    added_connections: list[dict[str, Any]] = Field(default_factory=list)
    updated_connections: list[dict[str, Any]] = Field(default_factory=list)
    relationship_evidence_added: list[dict[str, Any]] = Field(default_factory=list)
    relationship_evidence_updated: list[dict[str, Any]] = Field(default_factory=list)
    removed_connection_ids: list[str] = Field(default_factory=list)

    page_type: str | None = None

    page_url: str | None = None

    confirmed: bool = False

    expected_total: int | None = None

    collected_total: int | None = None

    completion_status: str | None = None


class RelationshipRequest(BaseModel):
    owner_id: str

    source_id: str

    target_id: str

    relationship: str = "KNOWS"

    strength: float = 1.0

    source: str = "manual"

    metadata: dict[str, Any] = Field(
        default_factory=dict
    )


class PathRequest(BaseModel):
    owner_id: str

    source_id: str | None = None

    target_id: str | None = None

    target_url: str | None = None

    target_name: str | None = None

    cutoff: int = 4


class RefreshRequest(BaseModel):
    owner_id: str
    force: bool = False


class TargetSearchRequest(BaseModel):
    owner_id: str
    company: str
    deal_side: str
    sector: str | None = None
    target_role: str | None = None


class DealRequest(BaseModel):
    owner_id: str
    side: str
    target_company: str
    sector: str | None = None
    status: str = "active"


class ContactGraphSearchRequest(BaseModel):
    owner_id: str
    deal: dict[str, Any]
    target_person: str | None = None


RECENCY_WINDOW_DAYS = 365.0
OBSERVED_MUTUAL_BASE_SCORE = 0.30
OBSERVED_MUTUAL_DEGREE_SCORES = {
    "2nd": 0.20,
    "3rd": 0.10,
    "3rd+": 0.05,
}
OBSERVED_MUTUAL_EVIDENCE_SCORES = {
    "mutual_connection_ui": 0.15,
    "profile_page": 0.10,
    "search_result": 0.08,
}
OBSERVED_MUTUAL_SOURCE_SCORES = {
    "linkedin_dom": 0.10,
    "approved": 0.10,
    "fixture": 0.05,
}
OBSERVED_MUTUAL_MUTUAL_BONUS = 0.05
OBSERVED_MUTUAL_MAX_MUTUAL_BONUS = 0.20


# =========================================================
# HELPERS
# =========================================================

def network_path(owner_id: str) -> Path:
    safe_owner = owner_id.replace(
        "/",
        "_"
    ).replace(
        "\\",
        "_"
    )

    return DATA_DIR / f"{safe_owner}.json"


def postgres_repository():
    global _POSTGRES_REPOSITORY

    if STORAGE_BACKEND != "postgres":
        return None
    if _POSTGRES_REPOSITORY is None:
        if Database is None or PostgresNetworkRepository is None:
            raise RuntimeError(
                "PostgreSQL storage requires SQLAlchemy and psycopg. "
                "Install backend/requirements.txt."
            )
        _POSTGRES_REPOSITORY = PostgresNetworkRepository(Database())
    return _POSTGRES_REPOSITORY


def profile_node_id(profile_url: str) -> str:
    return profile_url.rstrip("/")


def save_network(
    owner_id: str,
    data: dict[str, Any],
    auth_context: AuthContext | None = None,
):
    repository = postgres_repository()
    if repository is not None:
        repository.save_network(
            owner_id,
            data,
            auth_context.tenant_id if isinstance(auth_context, AuthContext) and auth_context.authenticated else None,
            auth_context.user_id if isinstance(auth_context, AuthContext) and auth_context.authenticated else None,
        )
        return

    path = network_path(owner_id)

    path.write_text(
        json.dumps(
            data,
            indent=2,
            ensure_ascii=False
        ),
        encoding="utf-8"
    )


def find_and_bind_latest_imported_network(
    owner_id: str,
    auth_context: AuthContext | None = None,
) -> dict[str, Any] | None:
    """
    Step 4 Repair Layer: If graph(owner_id) is missing, check DATA_DIR for existing
    imported network snapshots for this owner (handling slug variations like hyphens vs underscores).
    If found, bind it to owner_id so Warm Path works normally without requiring another import.
    """
    try:
        if not DATA_DIR.exists():
            return None

        json_files = list(DATA_DIR.glob("*.json"))
        if not json_files:
            return None

        normalized_target_owner = (owner_id or "").casefold().replace("-", "").replace("_", "")

        # Sort by modification time descending (latest imported dataset first)
        json_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)

        for filepath in json_files:
            try:
                data = json.loads(filepath.read_text(encoding="utf-8"))
                if not isinstance(data, dict):
                    continue

                connections = data.get("connections", [])
                evidence = data.get("relationship_evidence", [])
                if not connections and not evidence:
                    continue

                file_owner = data.get("owner_id") or filepath.stem
                normalized_file_owner = (file_owner or "").casefold().replace("-", "").replace("_", "")

                # Strict owner matching: bind only if dataset belongs to the same owner
                if normalized_file_owner and normalized_file_owner == normalized_target_owner:
                    data["owner_id"] = owner_id
                    save_network(owner_id, data, auth_context)
                    return data
            except Exception:
                continue
    except Exception:
        pass
    return None


def load_network(
    owner_id: str,
    auth_context: AuthContext | None = None,
):
    repository = postgres_repository()
    if repository is not None:
        tenant_id = (
            auth_context.tenant_id
            if isinstance(auth_context, AuthContext) and auth_context.authenticated
            else None
        )
        loaded = repository.load_network(owner_id, tenant_id)
        if loaded is not None:
            return loaded

    path = network_path(owner_id)

    if not path.exists():
        fixture_path = FIXTURES_DIR / f"{owner_id}.json"
        if fixture_path.exists() and (is_demo_mode() or owner_id in {"final_demo_owner", "test_owner", "empty_test_owner"}):
            path = fixture_path
        else:
            fallback = find_and_bind_latest_imported_network(owner_id, auth_context)
            if fallback is not None:
                return fallback
            return None

    try:
        return json.loads(
            path.read_text(
                encoding="utf-8"
            )
        )
    except Exception:
        return None


def provider_for(owner_id: str) -> RelationshipDataProvider:
    return ApprovedRelationshipDataProvider()


def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def audit_log(
    owner_id: str,
    action: str,
    status: str,
    source: str = "system",
    job_id: str | None = None,
    record_count: int = 0,
    auth_context: AuthContext | None = None,
) -> None:
    repository = postgres_repository()
    if repository is not None:
        repository.record_audit(
            owner_id,
            action,
            status,
            source,
            record_count,
            auth_context.tenant_id if isinstance(auth_context, AuthContext) and auth_context.authenticated else None,
            auth_context.user_id if isinstance(auth_context, AuthContext) and auth_context.authenticated else None,
        )
        return

    entry = {
        "timestamp": now_iso(),
        "owner_id": owner_id,
        "action": action,
        "source": source,
        "job_id": job_id,
        "record_count": record_count,
        "status": status,
    }
    path = AUDIT_DIR / f"{datetime.utcnow().date().isoformat()}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def stable_record_id(record: dict[str, Any], prefix: str) -> str:
    return str(
        record.get("source_record_id")
        or record.get("profile_url")
        or f"{prefix}:{normalized_person_name(record.get('name'))}"
    )


def merged_delta_records(
    existing: list[dict[str, Any]],
    records: list[dict[str, Any]],
    prefix: str,
) -> list[dict[str, Any]]:
    result = {
        stable_record_id(record, prefix): record
        for record in existing
    }
    for record in records:
        result[stable_record_id(record, prefix)] = record
    return list(result.values())


def save_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def normalized_person_name(value: str | None) -> str:
    """Normalize visible names for conservative exact matching."""
    return re.sub(
        r"[^\w]",
        "",
        " ".join((value or "").casefold().split())
    )


def parse_connection_date(value: str | None) -> date | None:
    if not value:
        return None

    for format_string in (
        "%B %d, %Y",
        "%b %d, %Y",
        "%Y-%m-%d"
    ):
        try:
            return datetime.strptime(
                value.strip(),
                format_string
            ).date()
        except ValueError:
            continue

    return None


def graph_recency_reference_date(graph: nx.DiGraph) -> date | None:
    connection_dates = [
        parse_connection_date(data.get("connection_date"))
        for _, _, data in graph.edges(data=True)
        if data.get("relationship") == "KNOWS"
    ]
    parsed_dates = [value for value in connection_dates if value]
    return max(parsed_dates) if parsed_dates else None


def score_graph_edge(
    edge: dict[str, Any],
    reference_date: date | None
) -> dict[str, Any]:
    relationship = edge.get("relationship")
    connection_date = edge.get("connection_date")

    if relationship == "KNOWS":
        parsed_date = parse_connection_date(connection_date)
        if parsed_date and reference_date:
            age_days = max(
                0,
                (reference_date - parsed_date).days
            )
            recency_score = 1.0 / (
                1.0 + age_days / RECENCY_WINDOW_DAYS
            )
            score = recency_score
            explanation = (
                "Direct KNOWS edge; connection date is "
                f"{age_days} days before the graph reference date."
            )
        else:
            age_days = None
            recency_score = None
            score = 1.0
            explanation = (
                "Direct KNOWS edge; no parseable connection date "
                "was available, so no recency adjustment was applied."
            )

        return {
            "score": round(score, 6),
            "features": {
                "relationship": "KNOWS",
                "connection_date": connection_date,
                "reference_date": (
                    reference_date.isoformat()
                    if reference_date
                    else None
                ),
                "age_days": age_days,
                "recency_score": (
                    round(recency_score, 6)
                    if recency_score is not None
                    else None
                )
            },
            "explanation": explanation
        }

    if relationship == "OBSERVED_MUTUAL":
        observed_degree = edge.get("observed_degree")
        degree_score = OBSERVED_MUTUAL_DEGREE_SCORES.get(
            observed_degree,
            0.0
        )
        evidence_type = edge.get("evidence_type")
        evidence_score = OBSERVED_MUTUAL_EVIDENCE_SCORES.get(
            evidence_type,
            0.0
        )
        source = edge.get("source")
        source_score = OBSERVED_MUTUAL_SOURCE_SCORES.get(
            source,
            0.0
        )
        mutual_connection_count = edge.get(
            "mutual_connection_count"
        )
        if mutual_connection_count is None:
            mutual_connection_count = int(
                bool(edge.get("mutual_connection_name"))
            )
        mutual_connection_count = max(
            0,
            int(mutual_connection_count)
        )
        mutual_count_bonus = min(
            OBSERVED_MUTUAL_MAX_MUTUAL_BONUS,
            OBSERVED_MUTUAL_MUTUAL_BONUS * mutual_connection_count
        )
        score = min(
            1.0,
            max(
                0.0,
                OBSERVED_MUTUAL_BASE_SCORE
                + degree_score
                + mutual_count_bonus
                + evidence_score
                + source_score
            )
        )
        return {
            "score": round(score, 6),
            "features": {
                "relationship": "OBSERVED_MUTUAL",
                "base_score": OBSERVED_MUTUAL_BASE_SCORE,
                "observed_degree": observed_degree,
                "degree_score": degree_score,
                "mutual_connection_count": mutual_connection_count,
                "mutual_count_bonus": mutual_count_bonus,
                "evidence_type": evidence_type,
                "evidence_score": evidence_score,
                "source": source,
                "source_score": source_score,
                "mutual_connection_name": edge.get(
                    "mutual_connection_name"
                ),
                "evidence_page_url": edge.get(
                    "evidence_page_url"
                ),
                "captured_at": edge.get("captured_at")
            },
            "explanation": (
                "Observed mutual score = base "
                f"{OBSERVED_MUTUAL_BASE_SCORE:.2f} + degree "
                f"{degree_score:.2f} + mutual-count bonus "
                f"{mutual_count_bonus:.2f} + evidence "
                f"{evidence_score:.2f} + source "
                f"{source_score:.2f}, bounded to [0, 1]."
            )
        }

    fallback_score = float(edge.get("strength", 1.0))
    return {
        "score": round(fallback_score, 6),
        "features": {
            "relationship": relationship,
            "strength": fallback_score
        },
        "explanation": (
            "Used the existing edge strength because this relationship "
            "type has no additional warmth features."
        )
    }


# =========================================================
# GRAPH BUILDING & LIFECYCLE
# =========================================================

def build_graph_from_network(
    owner_id: str,
    network_data: dict[str, Any]
) -> nx.DiGraph:
    """Delegate graph building to GraphService and cache result."""
    return graph_service.rebuild_owner_graph(owner_id, network_data)


def rebuild_owner_graph(owner_id: str, auth_context: AuthContext | None = None) -> nx.DiGraph | None:
    """Rebuild just this owner's graph from their saved network file."""
    data = load_network(owner_id, auth_context)
    return graph_service.rebuild_owner_graph(owner_id, data, auth_context=auth_context)


def _load_fixtures_into_cache():
    if not FIXTURES_DIR.exists():
        return
    for path in FIXTURES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            owner_id = data.get("owner_id")
            if owner_id:
                build_graph_from_network(owner_id, data)
        except Exception:
            continue


def rebuild_all_graphs():
    """Rebuild every owner's graph at startup into tenant-safe cache."""
    GRAPHS.clear()

    repository = postgres_repository()
    if repository is not None:
        for owner_id in repository.list_owner_ids():
            if owner_id:
                rebuild_owner_graph(owner_id)
        if is_demo_mode():
            _load_fixtures_into_cache()
        return

    for path in DATA_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            owner_id = data.get("owner_id")
            if not owner_id:
                continue
            if data.get("source") in {"synthetic_test", "manual_test"} and not is_demo_mode():
                continue
            build_graph_from_network(owner_id, data)
        except Exception:
            continue

    if is_demo_mode():
        _load_fixtures_into_cache()


# =========================================================
# STARTUP
# =========================================================

@app.on_event("startup")
def startup():
    rebuild_all_graphs()


# =========================================================
# HEALTH
# =========================================================

@app.get("/")
def root():
    return {
        "service": "warm-graph-backend",
        "status": "running",
        "version": "0.4.0"
    }


# =========================================================
# IMPORT LINKEDIN DATA
# =========================================================

@app.post("/network/import")
def import_network(
    request: ImportRequest,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(request.owner_id, auth_context)

    if not request.confirmed:
        raise HTTPException(
            status_code=400,
            detail="Explicit confirmation is required before sharing network data."
        )

    # Validate completion status for import safety guard
    status_str = (request.completion_status or "").lower()
    allowed_statuses = {"complete", "complete_rendered_dataset"}

    if not status_str:
        collected = request.collected_total if request.collected_total is not None else len(request.connections)
        expected = request.expected_total
        if expected is None or expected <= 0 or collected >= expected:
            status_str = "complete"
        elif collected == expected - 1:
            status_str = "complete_rendered_dataset"

    if status_str not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Import rejected: Dataset is incomplete. Backend sync requires complete or complete_rendered_dataset status."
        )

    # Convert request payload into Phase 7 ProviderSnapshot
    snapshot = extension_payload_to_snapshot(request.model_dump())

    repository = postgres_repository()
    if repository is not None:
        from services.provider_ingestion import ProviderIngestionService
        ingestion_service = ProviderIngestionService(repository)
        ingestion_service.ingest(request.owner_id, snapshot, auth_context)

    existing = load_network(request.owner_id, auth_context)

    if existing is None:
        existing = {
            "owner_id":
                request.owner_id,

            "source":
                request.source,

            "connection_count":
                0,

            "connections":
                [],

            "relationship_evidence_count":
                0,

            "relationship_evidence":
                []
        }

    # -----------------------------------------------------
    # MERGE DIRECT CONNECTIONS
    # -----------------------------------------------------

    connection_map = {}

    for connection in existing.get(
        "connections",
        []
    ):
        if connection.get("source") in {"synthetic_test", "manual_test", "fixture", "synthetic"} or connection.get("name") in {"Target Person", "Isolated Target", "Person C"}:
            continue

        url = connection.get(
            "profile_url"
        )

        if url:
            connection_map[url] = connection

    incoming_connections = (
        request.connections
        + request.added_connections
        + request.updated_connections
    )

    for connection in incoming_connections:
        url = connection.get("profile_url")
        if not url:
            continue
        if not connection.get("company"):
            extracted = parse_company_from_headline(connection.get("headline"))
            if extracted:
                connection["company"] = extracted
        connection_map[url] = connection

    merged_connections = list(
        connection_map.values()
    )

    # -----------------------------------------------------
    # MERGE RELATIONSHIP EVIDENCE
    # -----------------------------------------------------

    evidence_map = {}

    for evidence in existing.get(
        "relationship_evidence",
        []
    ):
        if evidence.get("source") in {"synthetic_test", "manual_test", "fixture", "synthetic"} or evidence.get("name") in {"Target Person", "Isolated Target", "Person C"}:
            continue

        key = (
            evidence.get("profile_url"),
            evidence.get("observed_degree")
        )

        evidence_map[key] = evidence

    incoming_evidence = (
        request.relationship_evidence
        + request.relationship_evidence_added
        + request.relationship_evidence_updated
    )

    for evidence in incoming_evidence:
        key = (
            evidence.get("profile_url"),
            evidence.get("observed_degree")
        )
        if not evidence.get("company"):
            extracted = parse_company_from_headline(evidence.get("headline"))
            if extracted:
                evidence["company"] = extracted
        evidence_map[key] = evidence

    for record_id in request.removed_connection_ids:
        connection_map.pop(record_id, None)
        connection_map.pop(profile_node_id(record_id), None)

    merged_evidence = list(
        evidence_map.values()
    )

    # -----------------------------------------------------
    # SAVE
    # -----------------------------------------------------

    network_data = {
        "owner_id":
            request.owner_id,

        "source":
            request.source,

        "connection_count":
            len(merged_connections),

        "connections":
            merged_connections,

        "relationship_evidence_count":
            len(merged_evidence),

        "relationship_evidence":
            merged_evidence,

        "last_page_type":
            request.page_type,

        "last_page_url":
            request.page_url
    }

    save_network(
        request.owner_id,
        network_data,
        auth_context,
    )

    audit_log(
        request.owner_id,
        "data_import",
        "completed",
        request.source,
        record_count=len(merged_connections) + len(merged_evidence),
        auth_context=auth_context,
    )

    # Rebuild, replace, and verify this owner's graph
    graph = graph_service.build_from_connections(request.owner_id, network_data=network_data, auth_context=auth_context)

    graph_repository.replace_graph(
        owner_id=request.owner_id,
        graph=graph,
        auth_context=auth_context,
    )

    stored = graph_repository.get_graph(request.owner_id, auth_context=auth_context)

    if stored is None or stored.number_of_nodes() == 0:
        raise HTTPException(
            status_code=500,
            detail="Graph persistence failed after import."
        )

    return {
        "success": True,

        "owner_id":
            request.owner_id,

        "connection_count":
            len(merged_connections),

        "relationship_evidence_count":
            len(merged_evidence),

        "graph_nodes":
            stored.number_of_nodes(),

        "graph_edges":
            stored.number_of_edges()
    }


# =========================================================
# GET STORED NETWORK
# =========================================================

@app.get(
    "/network/{owner_id}"
)
def get_network(
    owner_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(owner_id, auth_context)

    data = load_network(owner_id, auth_context)

    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Network not found."
        )

    audit_log(owner_id, "network_read", "completed", record_count=len(data.get("connections", [])), auth_context=auth_context)

    return data


# =========================================================
# RELATIONSHIP EVIDENCE
# =========================================================

@app.get(
    "/network/{owner_id}/relationship-evidence"
)
def get_relationship_evidence(
    owner_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(owner_id, auth_context)

    data = load_network(owner_id, auth_context)

    if data is None:
        raise HTTPException(
            status_code=404,
            detail="Network not found."
        )

    audit_log(owner_id, "relationship_evidence_read", "completed", record_count=len(data.get("relationship_evidence", [])), auth_context=auth_context)

    return {
        "owner_id":
            owner_id,

        "count":
            data.get(
                "relationship_evidence_count",
                0
            ),

        "relationship_evidence":
            data.get(
                "relationship_evidence",
                []
            )
    }


# =========================================================
# GRAPH
# =========================================================

@app.get(
    "/graph/view",
    response_class=HTMLResponse
)
def graph_view_query(
    owner_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(owner_id, auth_context)
    return graph_view(owner_id, auth_context=auth_context)


@app.get("/graph/{owner_id}")
def get_graph(
    owner_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(owner_id, auth_context)

    try:
        graph = get_owner_graph(owner_id, auth_context=auth_context)
    except HTTPException as e:
        if e.status_code == 404:
            network_data = load_network(owner_id, auth_context) or find_and_bind_latest_imported_network(owner_id, auth_context)
            if network_data and (network_data.get("connections") or network_data.get("relationship_evidence")):
                graph = rebuild_owner_graph(owner_id, auth_context)
            else:
                raise e
        else:
            raise e

    if graph is None:
        raise HTTPException(
            status_code=404,
            detail=f"No graph found for owner '{owner_id}'."
        )

    serialized = graph_service.serialize_graph(owner_id, graph)

    audit_log(owner_id, "graph_read", "completed", record_count=len(serialized["edges"]), auth_context=auth_context)

    return serialized


# =========================================================
# ADD VERIFIED RELATIONSHIP MANUALLY
# =========================================================

@app.post(
    "/graph/relationship"
)
def add_relationship(
    request: RelationshipRequest,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(request.owner_id, auth_context)

    try:
        graph = graph_service.get_owner_graph(request.owner_id, auth_context, load_network)
    except HTTPException:
        graph = nx.DiGraph()
        tenant_id = auth_context.tenant_id if auth_context and auth_context.authenticated else None
        graph_service.cache.set_graph(tenant_id, request.owner_id, graph)

    graph.add_node(
        request.source_id,
        node_type="Person"
    )

    graph.add_node(
        request.target_id,
        node_type="Person"
    )

    graph.add_edge(
        request.source_id,
        request.target_id,
        relationship=request.relationship,
        strength=request.strength,
        source=request.source,
        **request.metadata
    )

    return {
        "success": True,
        "owner_id": request.owner_id,
        "source": request.source_id,
        "target": request.target_id,
        "relationship": request.relationship
    }


# =========================================================
# FIND PATHS
# =========================================================

@app.post("/graph/path")
def find_paths(
    request: PathRequest,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(request.owner_id, auth_context)

    source_id = request.source_id or request.owner_id
    target_id = request.target_id
    target_url = request.target_url

    if not target_id and not target_url and not request.target_name:
        raise HTTPException(
            status_code=400,
            detail="target_id, target_url, or target_name is required"
        )

    result = graph_service.find_paths(
        owner_id=request.owner_id,
        source_id=source_id,
        target_id=target_id,
        target_url=target_url,
        target_name=request.target_name,
        cutoff=request.cutoff,
        auth_context=auth_context,
        load_network_fn=load_network,
    )

    audit_log(
        request.owner_id,
        "path_search",
        "completed",
        record_count=len(result.get("paths", [])),
        auth_context=auth_context,
    )

    return result


# =========================================================
# GRAPH VISUALIZATION
# =========================================================

@app.get(
    "/graph/{owner_id}/view",
    response_class=HTMLResponse
)
def graph_view(
    owner_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(owner_id, auth_context)

    graph = get_owner_graph(owner_id, auth_context=auth_context)
    html = graph_service.generate_graph_html(graph)

    return HTMLResponse(content=html)


# =========================================================
# SEARCH, TARGETS, DEALS, JOBS, AND REFRESH
# =========================================================


def person_records(
    owner_id: str,
    auth_context: AuthContext | None = None,
) -> list[dict[str, Any]]:
    data = load_network(owner_id, auth_context) or {}

    records = []

    # =====================================================
    # FIRST-DEGREE CONNECTIONS
    # =====================================================

    for connection in data.get("connections", []):
        headline = connection.get("headline")
        company = connection.get("company") or parse_company_from_headline(headline)

        records.append({
            "person_id":
                connection.get("profile_url")
                or stable_record_id(
                    connection,
                    "person"
                ),

            "name":
                connection.get(
                    "name",
                    ""
                ),

            "title":
                headline,

            "company":
                company,

            "profile_url":
                connection.get(
                    "profile_url"
                ),

            "location":
                connection.get(
                    "location"
                ),

            "source":
                connection.get(
                    "source",
                    "linkedin_dom"
                ),

            "confidence":
                connection.get(
                    "confidence",
                    1.0
                ),

            "degree":
                connection.get(
                    "degree",
                    "1st"
                ),

            "record_type":
                "connection"
        })


    # =====================================================
    # RELATIONSHIP-EVIDENCE PEOPLE
    #
    # These are usually 2nd/3rd-degree people who are not
    # direct connections but can still be valid target
    # people for a warm-introduction search.
    # =====================================================

    existing_ids = {
        record["person_id"]
        for record in records
        if record.get("person_id")
    }


    for evidence in data.get(
        "relationship_evidence",
        []
    ):

        profile_url =evidence.get("profile_url")


        person_id = (
            profile_url
            or stable_record_id(
                evidence,
                "evidence_person"
            )
        )


        # Avoid duplicating a person that already exists
        # as a first-degree connection.
        if person_id in existing_ids:
            continue

        headline = evidence.get("headline")
        company = evidence.get("company") or parse_company_from_headline(headline)

        records.append({

            "person_id":
                person_id,

            "name":
                evidence.get(
                    "name",
                    ""
                ),

            "title":
                headline,

            "company":
                company,

            "profile_url":
                profile_url,

            "location":
                evidence.get(
                    "location"
                ),

            "source":
                evidence.get(
                    "source",
                    "linkedin_dom"
                ),

            "confidence":
                evidence.get(
                    "confidence",
                    1.0
                ),

            "degree":
                evidence.get(
                    "observed_degree"
                ),

            "record_type":
                "relationship_evidence",

            "mutual_connections_text":
                evidence.get(
                    "mutual_connections_text"
                ),

            "mutual_connection_names":
                evidence.get(
                    "mutual_connection_names",
                    []
                ),

            "evidence_type":
                evidence.get(
                    "evidence_type"
                )
        })

        existing_ids.add(person_id)


    return records


ROLE_ALIASES: dict[str, list[str]] = {
    "software engineer": ["software engineer", "swe", "software developer", "software dev", "sde", "engineer"],
    "head of corporate development": ["head of corporate development", "vp corporate development", "head of m&a", "corp dev"],
    "cfo": ["cfo", "chief financial officer"],
    "ceo": ["ceo", "chief executive officer"],
    "cto": ["cto", "chief technology officer"],
    "associate professor": ["associate professor", "professor", "faculty", "lecturer"],
}


def role_match(title: str, roles: list[str]) -> tuple[str | None, int | None]:
    normalized_title = title.casefold()
    for index, role in enumerate(roles, start=1):
        role_lower = role.casefold()
        aliases = ROLE_ALIASES.get(role_lower, [role_lower])
        for alias in aliases:
            if re.search(r"\b" + re.escape(alias) + r"\b", normalized_title) or alias in normalized_title:
                return role, index
    return None, None


def candidate_for_person(
    owner_id: str,
    person: dict[str, Any],
    company: str,
    roles: list[str],
    auth_context: AuthContext | None = None,
) -> dict[str, Any] | None:
    comp_fold = company.casefold().strip()
    p_company = str(person.get("company") or "").casefold()
    p_title = str(person.get("title") or "").casefold()
    p_name = str(person.get("name") or "").casefold()

    if comp_fold not in p_company and comp_fold not in p_title and comp_fold not in p_name:
        return None

    matched_role, priority = role_match(p_title, roles)
    if not matched_role:
        # If user searched for a company without a strict matching executive role, include all company matches
        matched_role = person.get("title") or "Connection"
        priority = 10

    graph = graph_service.get_owner_graph(owner_id, auth_context, load_network)
    target_id = person.get("person_id") or person.get("profile_url") or ""
    resolved_target = graph_service.resolve_node_id(graph, target_id)

    path_data = []
    if resolved_target and resolved_target in graph:
        try:
            path_data = graph_service.find_paths(
                owner_id=owner_id,
                source_id=owner_id,
                target_id=resolved_target,
                cutoff=4,
                auth_context=auth_context,
                load_network_fn=load_network,
            )["paths"]
        except HTTPException:
            path_data = []

    confidence = round(
        min(1.0, 0.55 + (max(1, len(roles) - priority + 1)) * 0.08),
        2,
    )
    return {
        **person,
        "person_id": resolved_target or target_id,
        "matched_role": matched_role,
        "role_priority": priority,
        "confidence": confidence,
        "reason": f"Current {matched_role} at {person.get('company') or company}",
        "path_summary": {
            "available": bool(path_data),
            "path_count": len(path_data),
        },
        "path_count": len(path_data),
        "paths": path_data,
    }


@app.get("/graph/{owner_id}/search")
def search_graph(
    owner_id: str,
    q: str = "",
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(owner_id, auth_context)
    needle = q.casefold().strip()
    matches = [
        person for person in person_records(owner_id, auth_context)
        if not needle or needle in " ".join(
            str(person.get(field) or "")
            for field in ("name", "title", "company", "profile_url")
        ).casefold()
    ]
    audit_log(owner_id, "network_search", "completed", record_count=len(matches[:50]), auth_context=auth_context)
    return {"owner_id": owner_id, "results": matches[:50]}


@app.post("/target/search")
def search_targets(
    request: TargetSearchRequest,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(request.owner_id, auth_context)
    roles = [request.target_role] if request.target_role else ROLE_PRIORITIES.get(
        request.deal_side
    )
    if not roles:
        raise HTTPException(status_code=400, detail="deal_side must be buy_side or sell_side")
    candidates = [
        result for person in person_records(request.owner_id, auth_context)
        if (result := candidate_for_person(
            request.owner_id, person, request.company, roles, auth_context=auth_context
        )) is not None
    ]
    candidates.sort(key=lambda item: (
        -item["path_summary"]["available"],
        item["role_priority"],
        -item["confidence"],
        item["name"].casefold(),
    ))
    audit_log(request.owner_id, "target_search", "completed", record_count=len(candidates), auth_context=auth_context)
    response_data: dict[str, Any] = {
        "owner_id": request.owner_id,
        "company": request.company,
        "deal_side": request.deal_side,
        "candidates": candidates[:10],
    }
    if not candidates:
        response_data["message"] = "No matching target found in your imported network."
    return response_data

@app.post("/graph/explain-path")
def explain_path(
    request: dict[str, Any],
    auth_context: AuthContext = Depends(get_auth_context),
):
    owner_id = request.get("owner_id")

    if not owner_id:
        raise HTTPException(
            status_code=400,
            detail="owner_id is required"
        )
    authorized_context(owner_id, auth_context)

    return graph_service.explain_path(
        owner_id=owner_id,
        path=request.get("path"),
        source_id=request.get("source_id"),
        target_id=request.get("target_id"),
        target_url=request.get("target_url"),
        target_name=request.get("target_name"),
        cutoff=request.get("cutoff", 4),
        auth_context=auth_context,
        load_network_fn=load_network,
    )


@app.get("/company/search")
def search_companies(
    q: str = "",
    auth_context: AuthContext = Depends(get_auth_context),
):
    context = auth_context if isinstance(auth_context, AuthContext) else current_context()
    if context is not None and context.authenticated:
        require_authenticated(context)
    needle = q.casefold().strip()
    groups: dict[str, list[dict[str, Any]]] = {}
    for owner_id in accessible_owner_ids(auth_context):
        for person in person_records(owner_id, auth_context):
            company = str(person.get("company") or "").strip()
            if company and (not needle or needle in company.casefold()):
                groups.setdefault(company.casefold(), []).append(person)
    return {
        "results": [
            {"company_id": key, "name": values[0]["company"], "domain": None, "people_count": len(values)}
            for key, values in sorted(groups.items())
        ][:50]
    }


@app.get("/company/{company_id}/people")
def company_people(
    company_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    context = auth_context if isinstance(auth_context, AuthContext) else current_context()
    if context is not None and context.authenticated:
        require_authenticated(context)
    return {
        "company_id": company_id,
        "people": [
            person for owner_id in accessible_owner_ids(auth_context)
            for person in person_records(owner_id, auth_context)
            if str(person.get("company") or "").casefold() == company_id.casefold()
        ],
    }


@app.post("/deals")
def create_deal(
    request: DealRequest,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(request.owner_id, auth_context)
    if request.side not in ROLE_PRIORITIES:
        raise HTTPException(status_code=400, detail="side must be buy_side or sell_side")
    deal = {
        "id": uuid.uuid4().hex,
        "owner_id": request.owner_id,
        **request.model_dump(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    path = DEALS_DIR / f"{request.owner_id}.json"
    deals = load_json(path, [])
    deals.append(deal)
    save_json(path, deals)
    return deal


@app.get("/deals/{owner_id}")
def get_deals(
    owner_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(owner_id, auth_context)
    return {"owner_id": owner_id, "deals": load_json(DEALS_DIR / f"{owner_id}.json", [])}


@app.get("/deals/{owner_id}/{deal_id}")
def get_deal(
    owner_id: str,
    deal_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(owner_id, auth_context)
    deal = next((item for item in load_json(DEALS_DIR / f"{owner_id}.json", []) if item["id"] == deal_id), None)
    if deal is None:
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal


def run_refresh_job(job_id: str, request: RefreshRequest) -> None:
    job = JOBS[job_id]
    job.update({"status": "running", "started_at": now_iso(), "progress": 0.1})
    save_json(JOBS_DIR / f"{job_id}.json", job)
    audit_log(request.owner_id, "refresh_started", "running", "approved", job_id)
    try:
        provider_for(request.owner_id).refresh(request.owner_id)
        job.update({"status": "completed", "progress": 1.0, "completed_at": now_iso()})
        save_json(JOBS_DIR / f"{job_id}.json", job)
        audit_log(request.owner_id, "refresh_completed", "completed", "approved", job_id)
    except ApprovedProviderUnavailable as error:
        job.update({"status": "failed", "progress": 1.0, "completed_at": now_iso(), "errors": [str(error)]})
        save_json(JOBS_DIR / f"{job_id}.json", job)
        audit_log(request.owner_id, "refresh_failed", "failed", "approved", job_id)


@app.post("/refresh")
def refresh(
    request: RefreshRequest,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(request.owner_id, auth_context)
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {
        "job_id": job_id, "owner_id": request.owner_id,
        "status": "queued", "progress": 0.0,
        "records_processed": 0, "records_added": 0, "records_updated": 0,
        "records_removed": 0, "errors": [], "created_at": now_iso(),
    }
    save_json(JOBS_DIR / f"{job_id}.json", JOBS[job_id])
    threading.Thread(target=run_refresh_job, args=(job_id, request), daemon=True).start()
    return {"job_id": job_id, "status": "queued"}


def _load_job(job_id: str) -> dict[str, Any]:
    job = JOBS.get(job_id) or load_json(JOBS_DIR / f"{job_id}.json", None)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _authorize_job(job: dict[str, Any], auth_value: object = None) -> None:
    owner_id = job.get("owner_id")
    if owner_id:
        authorized_context(owner_id, auth_value)
        return
    context = current_context()
    if context is not None and context.authenticated:
        raise HTTPException(status_code=403, detail="Job ownership is unavailable")


@app.get("/jobs/{job_id}")
def get_job(
    job_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    job = _load_job(job_id)
    _authorize_job(job, auth_context)
    return job


@app.get("/jobs/{job_id}/result")
def get_job_result(
    job_id: str,
    auth_context: AuthContext = Depends(get_auth_context),
):
    job = _load_job(job_id)
    _authorize_job(job, auth_context)
    if job.get("status") != "completed":
        return {"job_id": job_id, "status": job.get("status"), "result": None}
    return {"job_id": job_id, "status": "completed", "result": job.get("result")}


@app.post("/jobs/contact-search")
def start_contact_search(
    request: ContactGraphSearchRequest,
    auth_context: AuthContext = Depends(get_auth_context),
):
    authorized_context(request.owner_id, auth_context)
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {
        "job_id": job_id,
        "owner_id": request.owner_id,
        "status": "running",
        "progress": 0.1,
        "created_at": now_iso(),
    }
    save_json(JOBS_DIR / f"{job_id}.json", JOBS[job_id])
    try:
        if request.target_person:
            target = request.target_person
            result = {"target_candidates": [], "results": [find_paths(PathRequest(request.owner_id, request.owner_id, target, 4))]}
        else:
            target_request = TargetSearchRequest(
                owner_id=request.owner_id,
                company=request.deal.get("target_company", ""),
                deal_side=request.deal.get("side", "sell_side"),
                sector=request.deal.get("sector"),
            )
            result = search_targets(target_request)
        JOBS[job_id].update({"status": "completed", "progress": 1.0, "completed_at": now_iso(), "result": result})
        save_json(JOBS_DIR / f"{job_id}.json", JOBS[job_id])
        audit_log(request.owner_id, "search_completed", "completed", "system", job_id)
    except Exception as error:
        JOBS[job_id].update({"status": "failed", "progress": 1.0, "completed_at": now_iso(), "error": str(error)})
        save_json(JOBS_DIR / f"{job_id}.json", JOBS[job_id])
    return {"job_id": job_id, "status": JOBS[job_id]["status"], **({"result": result} if "result" in locals() else {})}


@app.post("/contact-graph/search")
def contact_graph_search(
    request: ContactGraphSearchRequest,
    auth_context: AuthContext = Depends(get_auth_context),
):
    """Synchronous convenience endpoint over the local job contract."""
    response = start_contact_search(request, auth_context)
    result = response.get("result", {})
    return {
        "job_id": response["job_id"],
        "status": response["status"],
        "target_candidates": result.get("candidates", result.get("target_candidates", [])),
        "results": result.get("paths", result.get("results", [])),
    }


def start_contact_graph_search(request: ContactGraphSearchRequest) -> dict[str, Any]:
    return start_contact_search(request)


def get_contact_graph_job_status(job_id: str) -> dict[str, Any]:
    return get_job(job_id)


def get_contact_graph_result(job_id: str) -> dict[str, Any]:
    return get_job_result(job_id)


def explain_contact_path(request: dict[str, Any]) -> dict[str, Any]:
    return explain_path(request)


def refresh_contact_graph(request: RefreshRequest) -> dict[str, Any]:
    return refresh(request)