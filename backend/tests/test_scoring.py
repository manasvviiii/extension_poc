import sys
import unittest
from datetime import date
from pathlib import Path

import networkx as nx

sys.path.insert(0, str(Path(__file__).parents[1]))

from services.scoring import (
    RECENCY_WINDOW_DAYS,
    graph_recency_reference_date,
    parse_connection_date,
    rank_paths,
    score_graph_edge,
    score_path,
)


class ScoringEngineTests(unittest.TestCase):
    def test_parse_connection_date(self):
        self.assertEqual(parse_connection_date("January 1, 2026"), date(2026, 1, 1))
        self.assertEqual(parse_connection_date("Jan 1, 2026"), date(2026, 1, 1))
        self.assertEqual(parse_connection_date("2026-01-01"), date(2026, 1, 1))
        self.assertIsNone(parse_connection_date(None))
        self.assertIsNone(parse_connection_date("invalid-date"))

    def test_knows_scoring_recency_and_fallback(self):
        ref_date = date(2026, 1, 1)

        recent = score_graph_edge(
            {"relationship": "KNOWS", "connection_date": "2026-01-01"},
            ref_date,
        )
        self.assertEqual(recent["score"], 1.0)
        self.assertEqual(recent["features"]["age_days"], 0)

        older = score_graph_edge(
            {"relationship": "KNOWS", "connection_date": "2025-01-01"},
            ref_date,
        )
        self.assertLess(older["score"], 1.0)
        expected_recency = 1.0 / (1.0 + 365.0 / RECENCY_WINDOW_DAYS)
        self.assertAlmostEqual(older["score"], round(expected_recency, 6))

        no_date = score_graph_edge(
            {"relationship": "KNOWS", "connection_date": None},
            ref_date,
        )
        self.assertEqual(no_date["score"], 1.0)
        self.assertIsNone(no_date["features"]["age_days"])

    def test_observed_mutual_scoring_and_bounds(self):
        edge_1 = score_graph_edge({
            "relationship": "OBSERVED_MUTUAL",
            "observed_degree": "2nd",
            "mutual_connection_count": 1,
            "evidence_type": "mutual_connection_ui",
            "source": "linkedin_dom",
        }, None)

        edge_3 = score_graph_edge({
            "relationship": "OBSERVED_MUTUAL",
            "observed_degree": "2nd",
            "mutual_connection_count": 3,
            "evidence_type": "mutual_connection_ui",
            "source": "linkedin_dom",
        }, None)

        self.assertGreater(edge_3["score"], edge_1["score"])

        # Test score bounds [0, 1]
        high_bonus_edge = score_graph_edge({
            "relationship": "OBSERVED_MUTUAL",
            "observed_degree": "2nd",
            "mutual_connection_count": 10,
            "evidence_type": "mutual_connection_ui",
            "source": "linkedin_dom",
        }, None)
        self.assertLessEqual(high_bonus_edge["score"], 1.0)
        self.assertGreaterEqual(high_bonus_edge["score"], 0.0)

    def test_path_warmth_is_product(self):
        graph = nx.DiGraph()
        graph.add_edge("a", "b", relationship="KNOWS", connection_date="2026-01-01")
        graph.add_edge("b", "c", relationship="KNOWS", connection_date="2025-01-01")

        path_result = score_path(graph, ["a", "b", "c"], date(2026, 1, 1))
        edge1 = score_graph_edge(graph["a"]["b"], date(2026, 1, 1))["score"]
        edge2 = score_graph_edge(graph["b"]["c"], date(2026, 1, 1))["score"]

        self.assertEqual(path_result["warmth"], round(edge1 * edge2, 6))
        self.assertEqual(path_result["hop_count"], 2)

    def test_rank_paths_deterministic(self):
        paths = [
            {"path": ["a", "b", "d"], "hop_count": 2, "warmth": 0.8},
            {"path": ["a", "c", "d"], "hop_count": 2, "warmth": 0.9},
            {"path": ["a", "e", "f", "d"], "hop_count": 3, "warmth": 0.9},
        ]
        ranked = rank_paths(paths)
        self.assertEqual(ranked[0]["path"], ["a", "c", "d"])
        self.assertEqual(ranked[1]["path"], ["a", "e", "f", "d"])
        self.assertEqual(ranked[2]["path"], ["a", "b", "d"])


if __name__ == "__main__":
    unittest.main()
