"""
WarmGraph — Relationship Evidence Engine (Task 11.0)
Resolves structured relationship evidence for network edges across 6 priority tiers:
1. Same College (0.96)
2. Student ↔ Faculty (0.92)
3. Same Department (0.88)
4. Same Company (0.85)
5. Same City (0.75)
6. Existing LinkedIn 1st Degree (0.70)
"""

import re
from typing import Any

# Academic / College Patterns
COLLEGE_KEYWORDS = [
  "global academy of technology", "gat", "iit", "nit", "iiit",
  "bits", "rvce", "bmsce", "msrit", "pesu", "university",
  "college", "academy", "institute of technology"
]

# Department Keywords
DEPT_KEYWORDS = [
  "dept of cse", "dept. of cse", "computer science", "information science",
  "dept of ise", "dept of ece", "artificial intelligence", "ai/ml",
  "finance", "m&a", "investment banking", "dept of eee"
]

# City Keywords
CITY_KEYWORDS = [
  "bengaluru", "bangalore", "san francisco", "new york", "london",
  "singapore", "seattle", "hyderabad", "mumbai", "pune", "delhi"
]

class RelationshipEvidenceEngine:
    @staticmethod
    def extract_evidence(
        source_data: dict[str, Any],
        target_data: dict[str, Any],
        edge_data: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        """
        Evaluate edge relationship between source and target nodes and return
        ordered evidence objects according to priority resolution rules.
        """
        evidence_list: list[dict[str, Any]] = []

        s_headline = (source_data.get("headline") or "").casefold()
        t_headline = (target_data.get("headline") or "").casefold()
        s_company = (source_data.get("company") or "").casefold()
        t_company = (target_data.get("company") or "").casefold()
        s_label = (source_data.get("label") or "").casefold()
        t_label = (target_data.get("label") or "").casefold()
        s_role = (source_data.get("role_type") or source_data.get("role") or "").casefold()
        t_role = (target_data.get("role_type") or target_data.get("role") or "").casefold()

        # Combine text representations for parsing
        s_full = f"{s_headline} {s_company} {s_label}"
        t_full = f"{t_headline} {t_company} {t_label}"

        # -------------------------------------------------------------
        # Tier 1: Same College (0.96)
        # -------------------------------------------------------------
        college_match = RelationshipEvidenceEngine._find_shared_keyword(s_full, t_full, COLLEGE_KEYWORDS)
        if college_match:
            evidence_list.append({
                "type": "same_college",
                "label": college_match.title(),
                "confidence": 0.96
            })
        elif s_company and t_company and s_company == t_company and RelationshipEvidenceEngine._is_college(s_company):
            evidence_list.append({
                "type": "same_college",
                "label": source_data.get("company") or "Global Academy of Technology",
                "confidence": 0.96
            })

        # -------------------------------------------------------------
        # Tier 2: Student ↔ Faculty (0.92)
        # -------------------------------------------------------------
        is_s_student = "student" in s_role or any(k in s_headline for k in ["student", "intern", "undergraduate", "pursuing"])
        is_t_student = "student" in t_role or any(k in t_headline for k in ["student", "intern", "undergraduate", "pursuing"])
        is_s_faculty = "faculty" in s_role or any(k in s_headline for k in ["professor", "lecturer", "faculty", "dept", "dean"])
        is_t_faculty = "faculty" in t_role or any(k in t_headline for k in ["professor", "lecturer", "faculty", "dept", "dean"])

        if (is_s_student and is_t_faculty) or (is_s_faculty and is_t_student):
            evidence_list.append({
                "type": "student_faculty",
                "label": "Student ↔ Faculty Relationship",
                "confidence": 0.92
            })

        # -------------------------------------------------------------
        # Tier 3: Same Department (0.88)
        # -------------------------------------------------------------
        dept_match = RelationshipEvidenceEngine._find_shared_keyword(s_headline, t_headline, DEPT_KEYWORDS)
        if dept_match:
            evidence_list.append({
                "type": "same_dept",
                "label": dept_match.title(),
                "confidence": 0.88
            })

        # -------------------------------------------------------------
        # Tier 4: Same Company (0.85)
        # -------------------------------------------------------------
        raw_s_comp = source_data.get("company") or ""
        raw_t_comp = target_data.get("company") or ""
        if raw_s_comp and raw_t_comp and raw_s_comp.casefold() == raw_t_comp.casefold() and not RelationshipEvidenceEngine._is_college(raw_s_comp):
            evidence_list.append({
                "type": "same_company",
                "label": raw_s_comp,
                "confidence": 0.85
            })

        # -------------------------------------------------------------
        # Tier 5: Same City (0.75)
        # -------------------------------------------------------------
        city_match = RelationshipEvidenceEngine._find_shared_keyword(s_full, t_full, CITY_KEYWORDS)
        if city_match:
            evidence_list.append({
                "type": "same_city",
                "label": city_match.title(),
                "confidence": 0.75
            })

        # -------------------------------------------------------------
        # Tier 6: Existing LinkedIn 1st Degree (0.70)
        # -------------------------------------------------------------
        is_1st = False
        if edge_data:
            rel = edge_data.get("relationship")
            deg = edge_data.get("degree") or source_data.get("degree") or target_data.get("degree")
            if rel == "KNOWS" or deg in ["1st", "1st Degree"]:
                is_1st = True
        else:
            is_1st = True

        if is_1st or not evidence_list:
            evidence_list.append({
                "type": "linkedin_1st_degree",
                "label": "LinkedIn 1st Degree Connection",
                "confidence": 0.70
            })

        # Sort evidence by confidence descending
        evidence_list.sort(key=lambda x: x["confidence"], reverse=True)
        return evidence_list

    @staticmethod
    def _is_college(text: str) -> bool:
        lower = text.casefold()
        return any(k in lower for k in COLLEGE_KEYWORDS)

    @staticmethod
    def _find_shared_keyword(text_a: str, text_b: str, keywords: list[str]) -> str | None:
        for kw in keywords:
            if kw in text_a and kw in text_b:
                return kw
        return None


def resolve_path_evidence(
    graph: Any,
    path: list[str]
) -> list[dict[str, Any]]:
    """
    Given a network graph and node path, resolve all edge evidence objects.
    """
    all_evidence: list[dict[str, Any]] = []
    seen_evidence_keys = set()

    for u, v in zip(path, path[1:]):
        u_data = graph.nodes[u] if u in graph else {"label": u}
        v_data = graph.nodes[v] if v in graph else {"label": v}
        edge_data = graph.get_edge_data(u, v) or {}

        edge_evidences = RelationshipEvidenceEngine.extract_evidence(u_data, v_data, edge_data)
        for ev in edge_evidences:
            key = f"{ev['type']}_{ev['label']}"
            if key not in seen_evidence_keys:
                seen_evidence_keys.add(key)
                all_evidence.append(ev)

    all_evidence.sort(key=lambda x: x["confidence"], reverse=True)
    return all_evidence
