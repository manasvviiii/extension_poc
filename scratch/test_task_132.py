"""
Task 13.2 — Acceptance Verification Script
Repository & Database Adapter (Local First)
"""

import sys
import os
import networkx as nx

# Add backend directory to sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from repositories.graph_repository import GraphRepository
from repositories.local_graph_repository import LocalGraphRepository
from repositories.repository_provider import get_graph_repository, set_graph_repository
from services.graph_service import GraphService

print("=========================================")
print("RUNNING TASK 13.2 ACCEPTANCE TEST SUITE")
print("=========================================\n")

passed = 0
failed = 0

function_assert = True

def assert_test(condition, message):
    global passed, failed
    if condition:
        print(f"[PASS] {message}")
        passed += 1
    else:
        print(f"[FAIL] {message}")
        failed += 1


# 1. Test Factory Provider
print("1. Testing Repository Provider Factory...")
repo = get_graph_repository()
assert_test(isinstance(repo, GraphRepository), "get_graph_repository() returns an instance of GraphRepository")
assert_test(isinstance(repo, LocalGraphRepository), "get_graph_repository() defaults to LocalGraphRepository")

# 2. Test LocalGraphRepository CRUD API Methods
print("\n2. Testing LocalGraphRepository API Methods...")
test_user = "test_user_task132"

test_network = {
    "owner_id": test_user,
    "connections": [
        {"name": "Alice Smith", "profile_url": "https://www.linkedin.com/in/alicesmith", "degree": "1st"}
    ],
    "relationship_evidence": [
        {"name": "Bob Jones", "profile_url": "https://www.linkedin.com/in/bobjones", "observed_degree": "2nd"}
    ]
}

# Save network
repo.save_network(test_user, test_network)
loaded_net = repo.get_network(test_user)
assert_test(loaded_net is not None and loaded_net.get("owner_id") == test_user, "get_network() retrieves saved network data")

# People API
people = repo.get_people(test_user)
assert_test(len(people) == 1 and people[0]["name"] == "Alice Smith", "get_people() returns connections list")

new_people = [
    {"name": "Alice Smith", "profile_url": "https://www.linkedin.com/in/alicesmith", "degree": "1st"},
    {"name": "Charlie Brown", "profile_url": "https://www.linkedin.com/in/charliebrown", "degree": "1st"}
]
repo.save_people(test_user, new_people)
updated_people = repo.get_people(test_user)
assert_test(len(updated_people) == 2, "save_people() updates connections list")

# Relationships API
rels = repo.get_relationships(test_user)
assert_test(len(rels) == 1 and rels[0]["name"] == "Bob Jones", "get_relationships() returns relationship evidence list")

new_rels = [
    {"name": "Bob Jones", "profile_url": "https://www.linkedin.com/in/bobjones", "observed_degree": "2nd"},
    {"name": "Dana White", "profile_url": "https://www.linkedin.com/in/danawhite", "observed_degree": "2nd"}
]
repo.save_relationships(test_user, new_rels)
updated_rels = repo.get_relationships(test_user)
assert_test(len(updated_rels) == 2, "save_relationships() updates evidence list")

# 3. Test GraphService Repository Integration
print("\n3. Testing GraphService Integration with GraphRepository...")
service = GraphService()
assert_test(hasattr(service, "repository"), "GraphService holds a reference to GraphRepository")

# Build and cache graph through GraphService
graph = service.build_from_connections(test_user)
assert_test(isinstance(graph, nx.DiGraph), "GraphService builds NetworkX DiGraph")

service.replace_graph(test_user, graph)
retrieved_graph = repo.get_graph(test_user)
assert_test(retrieved_graph is not None, "replace_graph() caches graph in repository")

# Delete network
deleted = repo.delete_network(test_user)
assert_test(deleted, "delete_network() removes stored dataset and invalidates cache")

loaded_after_delete = repo.get_network(test_user)
assert_test(loaded_after_delete is None, "get_network() returns None after delete_network()")

# Summary
print("\n-----------------------------------------")
print(f"TEST SUMMARY: {passed} PASSED, {failed} FAILED")
print("-----------------------------------------")

if failed > 0:
    sys.exit(1)
else:
    print("SUCCESS: Task 13.2 Acceptance Criteria Met!\n")
    sys.exit(0)
