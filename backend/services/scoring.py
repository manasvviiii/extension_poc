from datetime import date, datetime
from typing import Any

import networkx as nx

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


def parse_connection_date(value: str | None) -> date | None:
    if not value:
        return None

    for format_string in (
        "%B %d, %Y",
        "%b %d, %Y",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(
                value.strip(),
                format_string,
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
    reference_date: date | None,
) -> dict[str, Any]:
    relationship = edge.get("relationship")
    connection_date = edge.get("connection_date")

    if relationship == "KNOWS":
        parsed_date = parse_connection_date(connection_date)
        if parsed_date and reference_date:
            age_days = max(
                0,
                (reference_date - parsed_date).days,
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
                ),
            },
            "explanation": explanation,
        }

    if relationship == "OBSERVED_MUTUAL":
        observed_degree = edge.get("observed_degree")
        degree_score = OBSERVED_MUTUAL_DEGREE_SCORES.get(
            observed_degree,
            0.0,
        )
        evidence_type = edge.get("evidence_type")
        evidence_score = OBSERVED_MUTUAL_EVIDENCE_SCORES.get(
            evidence_type,
            0.0,
        )
        source = edge.get("source")
        source_score = OBSERVED_MUTUAL_SOURCE_SCORES.get(
            source,
            0.0,
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
            int(mutual_connection_count),
        )
        mutual_count_bonus = min(
            OBSERVED_MUTUAL_MAX_MUTUAL_BONUS,
            OBSERVED_MUTUAL_MUTUAL_BONUS * mutual_connection_count,
        )
        score = min(
            1.0,
            max(
                0.0,
                OBSERVED_MUTUAL_BASE_SCORE
                + degree_score
                + mutual_count_bonus
                + evidence_score
                + source_score,
            ),
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
                "captured_at": edge.get("captured_at"),
            },
            "explanation": (
                "Observed mutual score = base "
                f"{OBSERVED_MUTUAL_BASE_SCORE:.2f} + degree "
                f"{degree_score:.2f} + mutual-count bonus "
                f"{mutual_count_bonus:.2f} + evidence "
                f"{evidence_score:.2f} + source "
                f"{source_score:.2f}, bounded to [0, 1]."
            ),
        }

    fallback_score = float(edge.get("strength", 1.0))
    return {
        "score": round(fallback_score, 6),
        "features": {
            "relationship": relationship,
            "strength": fallback_score,
        },
        "explanation": (
            "Used the existing edge strength because this relationship "
            "type has no additional warmth features."
        ),
    }


def score_path(
    graph: nx.DiGraph,
    path: list[str],
    reference_date: date | None = None,
) -> dict[str, Any]:
    if reference_date is None:
        reference_date = graph_recency_reference_date(graph)

    edges = []
    edge_explanations = []
    warmth = 1.0

    for index in range(len(path) - 1):
        source = path[index]
        target = path[index + 1]

        edge = graph.get_edge_data(source, target) or {}
        scoring = score_graph_edge(edge, reference_date)
        edge_score = scoring["score"]
        warmth *= edge_score

        edges.append({
            **edge,
            "source": source,
            "target": target,
            "score": edge_score,
            "features": scoring["features"],
            "explanation": scoring["explanation"],
        })
        edge_explanations.append(scoring["explanation"])

    return {
        "path": path,
        "hop_count": len(path) - 1,
        "warmth": round(warmth, 6),
        "warmth_explanation": (
            "Path warmth is the product of its deterministic "
            "per-edge scores: " + " ".join(edge_explanations)
        ),
        "edges": edges,
    }


def rank_paths(paths_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        paths_data,
        key=lambda item: (
            -item["warmth"],
            item["hop_count"],
            tuple(item["path"]),
        ),
    )
