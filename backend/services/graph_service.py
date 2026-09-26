from __future__ import annotations

import re
import time
import uuid
from typing import Any, Callable

import networkx as nx
from fastapi import HTTPException

try:
    from pyvis.network import Network
except ImportError:
    Network = None

from auth.context import AuthContext, current_context, require_owner_access
from auth.audit import security_audit
from .graph_cache import TenantGraphCache
from .scoring import rank_paths, score_path, graph_recency_reference_date


def profile_node_id(profile_url: str) -> str:
    return profile_url.rstrip("/")


def normalized_person_name(value: str | None) -> str:
    return re.sub(
        r"[^\w]",
        "",
        " ".join((value or "").casefold().split())
    )


def normalize_profile_url(value: str | None) -> str | None:
    """
    Treat these as identical:
    - linkedin.com/in/bipin-raj-c-b61670283
    - linkedin.com/in/bipin-raj-c-b61670283/
    - https://www.linkedin.com/in/bipin-raj-c-b61670283
    """
    if not value or not isinstance(value, str):
        return None
    val = value.strip().casefold()
    if not val:
        return None
    val = val.split("?")[0].split("#")[0]
    match = re.search(r"/in/([^/]+)", val)
    if match:
        slug = match.group(1).strip()
        return f"https://www.linkedin.com/in/{slug}"
    val = re.sub(r"^https?://", "", val)
    val = re.sub(r"^www\.", "", val)
    val = val.rstrip("/")
    if val.startswith("linkedin.com/in/"):
        slug = val.replace("linkedin.com/in/", "").strip()
        return f"https://www.linkedin.com/in/{slug}"
    return val


def extract_linkedin_slug(value: str | None) -> str | None:
    if not value or not isinstance(value, str):
        return None
    val = value.strip().casefold()
    match = re.search(r"/in/([^/?#]+)", val)
    if match:
        return match.group(1).strip()
    val = re.sub(r"^https?://", "", val)
    val = re.sub(r"^www\.", "", val)
    val = re.sub(r"^linkedin\.com/in/", "", val)
    val = val.strip("/").split("?")[0].split("#")[0]
    return val if val else None


def build_graph_from_network(
    owner_id: str,
    network_data: dict[str, Any]
) -> nx.DiGraph:
    """
    Build direct KNOWS edges and evidence-backed 2-hop edges into a
    graph that belongs ONLY to this owner. Nothing here reads from or
    writes to any other owner's graph, so two people using the tool
    never see each other's private connections merged together.

    Only explicitly matched 2nd-degree mutual names create
    OBSERVED_MUTUAL edges. 3rd+ observations remain evidence-only.
    """
    graph = nx.DiGraph()
    owner_node = owner_id

    graph.add_node(
        owner_node,
        node_type="Person",
        label=owner_id,
        source="linkedin_dom"
    )

    connections = network_data.get("connections", [])
    connection_by_name = {}

    for connection in connections:
        profile_url = connection.get("profile_url")
        if not profile_url:
            continue

        target_id = profile_node_id(profile_url)
        graph.add_node(
            target_id,
            node_type="Person",
            label=connection.get("name", target_id),
            degree=connection.get("degree", "1st"),
            source=connection.get("source", "linkedin_dom")
        )
        graph.add_edge(
            owner_node,
            target_id,
            relationship="KNOWS",
            strength=1.0,
            source=connection.get("source", "linkedin_dom"),
            evidence_type=connection.get("evidence_type", "connection_card"),
            connection_date=connection.get("connection_date"),
            headline=connection.get("headline")
        )

        normalized_name = normalized_person_name(connection.get("name"))
        if normalized_name:
            connection_by_name[normalized_name] = target_id

    for evidence in network_data.get("relationship_evidence", []):
        if evidence.get("observed_degree") != "2nd":
            continue

        target_url = evidence.get("profile_url")
        if not target_url:
            continue

        target_id = profile_node_id(target_url)
        graph.add_node(
            target_id,
            node_type="Person",
            label=evidence.get("name", target_id),
            observed_degree="2nd",
            source=evidence.get("source", "linkedin_dom")
        )

        matched_names = []
        for mutual_name in evidence.get("mutual_connection_names", []):
            mutual_id = connection_by_name.get(normalized_person_name(mutual_name))
            if mutual_id and mutual_name not in matched_names:
                matched_names.append(mutual_name)

        for mutual_name in matched_names:
            mutual_id = connection_by_name[normalized_person_name(mutual_name)]
            graph.add_edge(
                mutual_id,
                target_id,
                relationship="OBSERVED_MUTUAL",
                strength=1.0,
                source=evidence.get("source", "linkedin_dom"),
                evidence_type=evidence.get("evidence_type", "mutual_connection_ui"),
                mutual_connection_name=mutual_name,
                mutual_connection_count=len(matched_names),
                target_profile_url=target_url,
                evidence_page_url=evidence.get("page_url"),
                captured_at=evidence.get("captured_at"),
                observed_degree=evidence.get("observed_degree")
            )

    return graph


class GraphService:
    """Encapsulates graph construction, caching, retrieval, path finding, and visualization."""

    def __init__(self, cache: TenantGraphCache | None = None) -> None:
        self.cache = cache if cache is not None else TenantGraphCache()

    def get_owner_graph(
        self,
        owner_id: str,
        auth_context: AuthContext | None = None,
        load_network_fn: Callable[[str, AuthContext | None], dict[str, Any] | None] | None = None,
    ) -> nx.DiGraph:
        context = auth_context if isinstance(auth_context, AuthContext) else current_context()
        if context is not None and context.authenticated:
            require_owner_access(context, owner_id)
        tenant_id = context.tenant_id if isinstance(context, AuthContext) and context.authenticated else None

        cached_graph = self.cache.get_graph(tenant_id, owner_id)
        if cached_graph is not None and cached_graph.number_of_nodes() > 0:
            security_audit("graph_cache_hit", "success", {"owner_id": owner_id})
            return cached_graph

        security_audit("graph_cache_miss", "info", {"owner_id": owner_id})
        if load_network_fn is not None:
            network_data = load_network_fn(owner_id, context)
            if network_data is not None and (network_data.get("connections") or network_data.get("relationship_evidence")):
                graph = build_graph_from_network(owner_id, network_data)
                self.replace_graph(owner_id, graph, auth_context=context)
                security_audit("graph_rebuild", "completed", {"owner_id": owner_id, "nodes": graph.number_of_nodes()})
                return graph

        raise HTTPException(
            status_code=404,
            detail=(
                f"No graph found for owner '{owner_id}'. "
                "Import a network for this owner first."
            )
        )

    def build_from_connections(
        self,
        owner_id: str,
        network_data: dict[str, Any] | None = None,
        auth_context: AuthContext | None = None,
        load_network_fn: Callable[[str, AuthContext | None], dict[str, Any] | None] | None = None,
    ) -> nx.DiGraph:
        """
        Build direct KNOWS and 2nd degree OBSERVED_MUTUAL edges into a graph for owner.
        """
        if network_data is None and load_network_fn is not None:
            network_data = load_network_fn(owner_id, auth_context)
        if not network_data:
            network_data = {"owner_id": owner_id, "connections": [], "relationship_evidence": []}
        return build_graph_from_network(owner_id, network_data)

    def replace_graph(
        self,
        owner_id: str,
        graph: nx.DiGraph,
        auth_context: AuthContext | None = None,
    ) -> nx.DiGraph:
        """
        Delete previous graph for owner and insert new nodes + edges into repository/cache.
        """
        context = auth_context if isinstance(auth_context, AuthContext) else current_context()
        tenant_id = context.tenant_id if isinstance(context, AuthContext) and context.authenticated else None
        self.cache.invalidate(tenant_id, owner_id)
        self.cache.set_graph(tenant_id, owner_id, graph)
        security_audit("graph_replaced", "completed", {
            "owner_id": owner_id,
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
        })
        return graph

    def invalidate_owner_graph(
        self,
        owner_id: str,
        auth_context: AuthContext | None = None,
    ) -> None:
        context = auth_context if isinstance(auth_context, AuthContext) else current_context()
        tenant_id = context.tenant_id if isinstance(context, AuthContext) and context.authenticated else None
        self.cache.invalidate(tenant_id, owner_id)
        security_audit("graph_cache_invalidated", "completed", {"owner_id": owner_id})

    def rebuild_owner_graph(
        self,
        owner_id: str,
        network_data: dict[str, Any] | None,
        auth_context: AuthContext | None = None,
    ) -> nx.DiGraph | None:
        context = auth_context if isinstance(auth_context, AuthContext) else current_context()
        if network_data is None:
            self.invalidate_owner_graph(owner_id, auth_context=context)
            return None
        graph = build_graph_from_network(owner_id, network_data)
        return self.replace_graph(owner_id, graph, auth_context=context)

    def serialize_graph(self, owner_id: str, graph: nx.DiGraph) -> dict[str, Any]:
        nodes = []
        for node_id, attrs in graph.nodes(data=True):
            nodes.append({"id": node_id, **attrs})

        edges = []
        for source, target, attrs in graph.edges(data=True):
            edges.append({"source": source, "target": target, **attrs})

        return {
            "owner_id": owner_id,
            "nodes": nodes,
            "edges": edges,
        }

    def find_node(
        self,
        graph: nx.DiGraph,
        profile_url: str | None = None,
        slug: str | None = None,
        name: str | None = None,
    ) -> str | None:
        """
        Canonicalize target node resolution in priority order:
        1. Exact profile URL
        2. Normalized profile URL
        3. LinkedIn slug
        4. Stored node_id
        5. Case-insensitive name match
        """
        if not graph:
            return None

        norm_target_url = normalize_profile_url(profile_url) or normalize_profile_url(slug)
        target_slug = extract_linkedin_slug(slug) or extract_linkedin_slug(profile_url)
        norm_name = normalized_person_name(name) or normalized_person_name(slug if slug and not slug.startswith("http") else None)

        # 1. Exact profile URL / exact node_id match
        if profile_url and profile_url in graph:
            return profile_url
        if slug and slug in graph:
            return slug

        for node_id, attrs in graph.nodes(data=True):
            p_url = attrs.get("profile_url")
            if profile_url and (p_url == profile_url or str(node_id) == profile_url):
                return str(node_id)

        # 2. Normalized profile URL
        if norm_target_url:
            for node_id, attrs in graph.nodes(data=True):
                p_url = attrs.get("profile_url")
                if normalize_profile_url(str(node_id)) == norm_target_url or normalize_profile_url(p_url) == norm_target_url:
                    return str(node_id)

        # 3. LinkedIn slug
        if target_slug:
            for node_id, attrs in graph.nodes(data=True):
                p_url = attrs.get("profile_url")
                n_slug = extract_linkedin_slug(str(node_id)) or extract_linkedin_slug(p_url)
                if n_slug and n_slug == target_slug:
                    return str(node_id)

        # 4. Stored node_id (case-insensitive / profile_node_id match)
        if slug:
            clean_slug = profile_node_id(slug).casefold()
            for node_id, attrs in graph.nodes(data=True):
                if str(node_id).casefold() == clean_slug or profile_node_id(str(node_id)).casefold() == clean_slug:
                    return str(node_id)

        # 5. Case-insensitive name match
        if norm_name:
            for node_id, attrs in graph.nodes(data=True):
                lbl = attrs.get("label") or attrs.get("name")
                if lbl and normalized_person_name(lbl) == norm_name:
                    return str(node_id)

        return None

    def resolve_node_id(self, graph: nx.DiGraph, query: str | None) -> str | None:
        if not query:
            return None
        return self.find_node(graph, profile_url=query, slug=query, name=query)

    def find_paths(
        self,
        owner_id: str,
        source_id: str | None = None,
        target_id: str | None = None,
        target_url: str | None = None,
        target_name: str | None = None,
        cutoff: int = 4,
        auth_context: AuthContext | None = None,
        load_network_fn: Callable[[str, AuthContext | None], dict[str, Any] | None] | None = None,
    ) -> dict[str, Any]:
        start_time = time.perf_counter()
        graph = self.get_owner_graph(owner_id, auth_context, load_network_fn)

        resolved_source = self.find_node(graph, profile_url=source_id, slug=source_id, name=owner_id) or source_id or owner_id
        resolved_target = self.find_node(graph, profile_url=target_url, slug=target_id, name=target_name)

        if not resolved_target:
            resolved_target = self.find_node(graph, profile_url=target_id, slug=target_url, name=target_name)

        if resolved_source not in graph:
            raise HTTPException(
                status_code=404,
                detail=f"Source node '{source_id or owner_id}' not found in graph."
            )

        if not resolved_target or resolved_target not in graph:
            target_desc = target_name or target_id or target_url or "unknown"
            raise HTTPException(
                status_code=404,
                detail=f"Target node '{target_desc}' not found in graph."
            )

        effective_cutoff = min(max(cutoff, 0), 4)

        try:
            raw_paths = list(
                nx.all_simple_paths(
                    graph,
                    resolved_source,
                    resolved_target,
                    cutoff=effective_cutoff
                )
            )
        except nx.NetworkXNoPath:
            raw_paths = []

        reference_date = graph_recency_reference_date(graph)
        scored_paths = [
            score_path(graph, path, reference_date)
            for path in raw_paths
        ]
        ranked = rank_paths(scored_paths)
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

        security_audit("path_search_executed", "completed", {
            "owner_id": owner_id,
            "paths_found": len(ranked),
            "duration_ms": duration_ms,
        })

        return {
            "owner_id": owner_id,
            "source": resolved_source,
            "target": resolved_target,
            "paths": ranked[:3],
        }

    def explain_path(
        self,
        owner_id: str,
        path: list[str] | None = None,
        source_id: str | None = None,
        target_id: str | None = None,
        target_url: str | None = None,
        target_name: str | None = None,
        cutoff: int = 4,
        auth_context: AuthContext | None = None,
        load_network_fn: Callable[[str, AuthContext | None], dict[str, Any] | None] | None = None,
    ) -> dict[str, Any]:
        graph = self.get_owner_graph(owner_id, auth_context, load_network_fn)

        if not path:
            effective_source = source_id or owner_id
            resolved_target = self.find_node(graph, profile_url=target_url, slug=target_id, name=target_name)
            if not resolved_target:
                raise HTTPException(
                    status_code=400,
                    detail="target_id or target_url is required"
                )

            path_result = self.find_paths(
                owner_id=owner_id,
                source_id=effective_source,
                target_id=target_id,
                target_url=target_url,
                target_name=target_name,
                cutoff=cutoff,
                auth_context=auth_context,
                load_network_fn=load_network_fn,
            )

            paths = path_result.get("paths") or []
            if not paths:
                raise HTTPException(
                    status_code=404,
                    detail="No warm path found"
                )

            best_path = paths[0]
            path = best_path.get("path") or []

        if len(path) < 2:
            raise HTTPException(
                status_code=400,
                detail="A valid path must contain at least two nodes"
            )

        statements = []

        for source, target in zip(path, path[1:]):
            edge = graph.get_edge_data(source, target)
            if not edge:
                # Check resolved node IDs
                s_res = self.resolve_node_id(graph, source) or source
                t_res = self.resolve_node_id(graph, target) or target
                edge = graph.get_edge_data(s_res, t_res)

            source_name = graph.nodes[source].get("label") if source in graph else source
            if source == owner_id or source_name == owner_id:
                source_name = "You"
            target_name = graph.nodes[target].get("label") if target in graph else target

            if not edge:
                statements.append(f"{source_name} is connected to {target_name}.")
                continue

            rel = edge.get("relationship", "KNOWS")
            if rel == "KNOWS":
                statements.append(
                    f"{source_name} is directly connected to {target_name}."
                )
            elif rel == "OBSERVED_MUTUAL":
                mutual_name = (
                    edge.get("mutual_connection_name")
                    or source_name
                )
                statements.append(
                    f"{mutual_name} appears as a mutual connection for {target_name}."
                )
            else:
                statements.append(
                    f"{source_name} has observed relationship evidence for {target_name}."
                )

        hop_count = len(path) - 1
        explanation = " ".join(statements)
        explanation += f" This produces a {hop_count}-hop warm path."

        return {
            "owner_id": owner_id,
            "path": path,
            "hops": hop_count,
            "explanation": explanation,
        }

    def generate_graph_html(self, graph: nx.DiGraph) -> str:
        if Network is not None:
            try:
                net = Network(
                    height="800px",
                    width="100%",
                    directed=True
                )

                for node_id, attrs in graph.nodes(data=True):
                    label = attrs.get("label", node_id)
                    net.add_node(
                        node_id,
                        label=label,
                        title=str(attrs)
                    )

                for source, target, attrs in graph.edges(data=True):
                    relationship = attrs.get("relationship", "KNOWS")
                    strength = attrs.get("strength", 1.0)
                    net.add_edge(
                        source,
                        target,
                        label=relationship,
                        value=strength,
                        title=str(attrs)
                    )

                return net.generate_html()
            except Exception:
                pass

        # Fallback interactive HTML visualization using vis-network standalone CDN
        nodes_list = [{"id": node_id, "label": attrs.get("label", node_id)} for node_id, attrs in graph.nodes(data=True)]
        edges_list = [{"from": source, "to": target, "label": attrs.get("relationship", "KNOWS")} for source, target, attrs in graph.edges(data=True)]
        nodes_json = json.dumps(nodes_list)
        edges_json = json.dumps(edges_list)

        return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Warm Graph Network</title>
    <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
    <style>#mynetwork {{ width: 100%; height: 800px; border: 1px solid lightgray; }}</style>
</head>
<body>
    <div id="mynetwork"></div>
    <script type="text/javascript">
        var nodes = new vis.DataSet({nodes_json});
        var edges = new vis.DataSet({edges_json});
        var container = document.getElementById('mynetwork');
        var data = {{ nodes: nodes, edges: edges }};
        var options = {{ edges: {{ arrows: 'to' }} }};
        var network = new vis.Network(container, data, options);
    </script>
</body>
</html>"""
