import sys
import os

# Add backend directory to PYTHONPATH
backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, backend_dir)

import networkx as nx
from services.relationship_service import RelationshipEvidenceEngine, resolve_path_evidence
from services.graph_service import GraphService

def test_relationship_evidence_engine():
    print("=================================================")
    print("RUNNING TASK 11.0 RELATIONSHIP EVIDENCE TESTS")
    print("=================================================")

    # Test 1: Priority Resolution Tiers
    print("\n[TEST 1] Testing Priority Tier Resolution...")

    # Tier 1: Same College (0.96)
    s1 = {"headline": "Assistant Professor at Global Academy of Technology", "company": "Global Academy of Technology", "role_type": "faculty"}
    t1 = {"headline": "AI/ML Student at Global Academy of Technology", "company": "Global Academy of Technology", "role_type": "student"}
    ev1 = RelationshipEvidenceEngine.extract_evidence(s1, t1)

    types1 = [e["type"] for e in ev1]
    confidences1 = {e["type"]: e["confidence"] for e in ev1}

    assert "same_college" in types1, "Tier 1 same_college missing"
    assert confidences1["same_college"] == 0.96, f"Expected confidence 0.96, got {confidences1['same_college']}"
    print("[OK] Tier 1 (same_college): 0.96 verified!")

    # Tier 2: Student <-> Faculty (0.92)
    assert "student_faculty" in types1, "Tier 2 student_faculty missing"
    assert confidences1["student_faculty"] == 0.92, f"Expected confidence 0.92, got {confidences1['student_faculty']}"
    print("[OK] Tier 2 (student_faculty): 0.92 verified!")

    # Tier 3: Same Department (0.88)
    s3 = {"headline": "Lecturer, Dept of CSE", "company": "GAT"}
    t3 = {"headline": "Assistant Professor | Dept of CSE", "company": "GAT"}
    ev3 = RelationshipEvidenceEngine.extract_evidence(s3, t3)
    types3 = [e["type"] for e in ev3]
    confidences3 = {e["type"]: e["confidence"] for e in ev3}

    assert "same_dept" in types3, "Tier 3 same_dept missing"
    assert confidences3["same_dept"] == 0.88, f"Expected confidence 0.88, got {confidences3['same_dept']}"
    print("[OK] Tier 3 (same_dept): 0.88 verified!")

    # Tier 4: Same Company (0.85)
    s4 = {"headline": "Senior Software Engineer", "company": "Microsoft"}
    t4 = {"headline": "Principal Architect", "company": "Microsoft"}
    ev4 = RelationshipEvidenceEngine.extract_evidence(s4, t4)
    types4 = [e["type"] for e in ev4]
    confidences4 = {e["type"]: e["confidence"] for e in ev4}

    assert "same_company" in types4, "Tier 4 same_company missing"
    assert confidences4["same_company"] == 0.85, f"Expected confidence 0.85, got {confidences4['same_company']}"
    print("[OK] Tier 4 (same_company): 0.85 verified!")

    # Tier 5: Same City (0.75)
    s5 = {"headline": "Engineer in Bengaluru", "company": "Company A"}
    t5 = {"headline": "Designer based in Bengaluru", "company": "Company B"}
    ev5 = RelationshipEvidenceEngine.extract_evidence(s5, t5)
    types5 = [e["type"] for e in ev5]
    confidences5 = {e["type"]: e["confidence"] for e in ev5}

    assert "same_city" in types5, "Tier 5 same_city missing"
    assert confidences5["same_city"] == 0.75, f"Expected confidence 0.75, got {confidences5['same_city']}"
    print("[OK] Tier 5 (same_city): 0.75 verified!")

    # Tier 6: LinkedIn 1st Degree (0.70)
    assert "linkedin_1st_degree" in types5, "Tier 6 linkedin_1st_degree missing"
    assert confidences5["linkedin_1st_degree"] == 0.70, f"Expected confidence 0.70, got {confidences5['linkedin_1st_degree']}"
    print("[OK] Tier 6 (linkedin_1st_degree): 0.70 verified!")

    # Test 2: GraphService.explain_path return structure
    print("\n[TEST 2] Testing GraphService.explain_path response structure...")
    graph_service = GraphService()
    owner_id = "manasvi-p-8a88402ab"

    graph = nx.DiGraph()
    graph.add_node(owner_id, label="Manasvi P", headline="Student at Global Academy of Technology", company="Global Academy of Technology", role_type="student")
    graph.add_node("reshma-hegde", label="Reshma Hegde", headline="Assistant Professor, Dept of CSE", company="Global Academy of Technology", role_type="faculty")
    graph.add_edge(owner_id, "reshma-hegde", relationship="KNOWS", degree="1st")

    graph_service.cache[owner_id] = graph

    res = graph_service.explain_path(owner_id=owner_id, path=[owner_id, "reshma-hegde"])

    assert "path" in res, "Missing path in explain_path result"
    assert "hops" in res, "Missing hops in explain_path result"
    assert "explanation" in res, "Missing explanation in explain_path result"
    assert "evidence" in res, "Missing evidence in explain_path result"
    assert isinstance(res["evidence"], list), "Evidence must be a list of objects"
    assert len(res["evidence"]) > 0, "Evidence list must not be empty"

    for ev in res["evidence"]:
        assert "type" in ev, "Evidence object missing type"
        assert "label" in ev, "Evidence object missing label"
        assert "confidence" in ev, "Evidence object missing confidence"
        assert isinstance(ev["confidence"], float), "Confidence must be a float"

    print("[OK] GraphService.explain_path returned rich structured evidence objects!")
    print("\n=================================================")
    print("ALL TASK 11.0 ACCEPTANCE TESTS PASSED SUCCESSFULLY! [OK]")

if __name__ == "__main__":
    test_relationship_evidence_engine()
