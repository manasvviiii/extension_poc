#!/usr/bin/env python3
"""
Acceptance test for TASK 13.4 — Multi-User Repository Simulation (Cloud Ready)
Verifies:
1. LocalGraphRepository implements multi-user repository methods (get_users, create_user, update_user, delete_user, get_user, get_user_stats).
2. Seed demo users generates isolated graph datasets in backend/data/graphs/ and user records in backend/data/users.json.
3. AdminService aggregation methods (get_platform_metrics, get_all_users, get_company_distribution, get_recent_syncs, get_network_health) derive metrics from Repository.
4. Deleting a user updates KPIs automatically and removes graph dataset file without affecting local_user.
5. Zero graph_cache imports in admin_service.py.
"""

import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

def test_no_graph_cache_in_admin_service():
    admin_service_path = backend_dir / "services" / "admin_service.py"
    code = admin_service_path.read_text(encoding="utf-8")
    assert "graph_cache" not in code, "admin_service.py must NOT import graph_cache!"
    print("[OK] admin_service.py contains zero graph_cache imports")

def test_seed_demo_users_and_storage_layout():
    from dev.seed_demo_users import seed_demo_users
    from repositories.repository_provider import get_graph_repository

    repo = get_graph_repository()
    users_before = len(repo.get_users())

    seeded = seed_demo_users(count=5)
    assert len(seeded) == 5, "Expected 5 seeded demo users"

    users_after = repo.get_users()
    assert len(users_after) >= 5, f"Expected at least 5 users in repository, got {len(users_after)}"

    # Verify storage layout
    graphs_dir = backend_dir / "data" / "graphs"
    users_file = backend_dir / "data" / "users.json"
    assert graphs_dir.exists(), "backend/data/graphs directory must exist"
    assert users_file.exists(), "backend/data/users.json file must exist"

    for i in range(1, 6):
        graph_file = graphs_dir / f"demo_user_{i}.json"
        assert graph_file.exists(), f"Graph file for demo_user_{i} must exist in backend/data/graphs/"
        net = repo.get_network(f"demo_user_{i}")
        assert net is not None, f"get_network(demo_user_{i}) must return valid network"
        assert len(net.get("connections", [])) >= 80, f"demo_user_{i} connections count should be >= 80"

    print("[OK] Demo Seeder and storage layout backend/data/users.json & backend/data/graphs/ verified")

def test_repository_user_management():
    from repositories.repository_provider import get_graph_repository

    repo = get_graph_repository()
    test_uid = "temp_test_user_99"

    # 1. create_user
    u_data = {
        "id": test_uid,
        "name": "Temp Test User",
        "email": "temp@warmgraph.dev",
        "provider": "local"
    }
    created = repo.create_user(u_data)
    assert created["id"] == test_uid, "create_user must return record with matching id"

    # 2. get_user
    fetched = repo.get_user(test_uid)
    assert fetched is not None, "get_user must return created user"
    assert fetched["name"] == "Temp Test User", "get_user name mismatch"

    # 3. update_user
    updated = repo.update_user(test_uid, {"name": "Updated Temp User"})
    assert updated["name"] == "Updated Temp User", "update_user name update failed"

    # 4. save_network & get_user_stats
    repo.save_network(test_uid, {
        "owner_id": test_uid,
        "connections": [{"name": "Conn 1", "headline": "Dev at Google", "company": "Google"}],
        "relationship_evidence": []
    })
    stats = repo.get_user_stats(test_uid)
    assert stats["connections"] == 1, "get_user_stats connections mismatch"
    assert stats["companies"] == 1, "get_user_stats companies mismatch"
    assert stats["status"] in ["Active", "Idle", "Error"], "Invalid user status"

    # 5. delete_user
    deleted = repo.delete_user(test_uid)
    assert deleted is True, "delete_user should return True"
    assert repo.get_user(test_uid) is None, "User should be removed from repository after deletion"
    assert repo.get_network(test_uid) is None, "Graph file should be deleted after user deletion"

    print("[OK] Repository user management methods (get_users, create_user, update_user, delete_user, get_user, get_user_stats) verified")

def test_admin_service_aggregations():
    from services.admin_service import AdminService
    from repositories.repository_provider import get_graph_repository

    repo = get_graph_repository()
    service = AdminService(repo)

    metrics_before = service.get_platform_metrics()
    total_users_before = metrics_before["total_users"]
    total_people_before = metrics_before["total_people"]

    assert total_users_before >= 5, "AdminService platform metrics expected at least 5 users"
    assert total_people_before > 0, "AdminService platform metrics expected > 0 people"

    # Test individual AdminService aggregation methods
    users_list = service.get_all_users()
    assert len(users_list) == total_users_before, "get_all_users length mismatch"

    comp_dist = service.get_company_distribution()
    assert isinstance(comp_dist, list), "get_company_distribution must return list"

    recent_syncs = service.get_recent_syncs()
    assert isinstance(recent_syncs, list), "get_recent_syncs must return list"

    health = service.get_network_health()
    assert "avg_network_size" in health, "get_network_health missing avg_network_size"

    # Verify user deletion automatically updates KPIs
    test_user = "demo_user_5"
    repo.delete_user(test_user)

    metrics_after = service.get_platform_metrics()
    assert metrics_after["total_users"] == total_users_before - 1, "Deleting user must decrement total_users KPI"
    assert metrics_after["total_people"] < total_people_before, "Deleting user must reduce total_people KPI"

    print("[OK] AdminService aggregation methods & KPI auto-updating on user deletion verified")

def test_fastapi_admin_routes():
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)

    res_get = client.get("/admin/metrics")
    assert res_get.status_code == 200, "GET /admin/metrics failed"
    data = res_get.json()
    assert "kpis" in data, "FastAPI /admin/metrics missing kpis"

    # Test DELETE route
    res_del = client.delete("/admin/users/demo_user_4")
    assert res_del.status_code == 200, "DELETE /admin/users/demo_user_4 failed"
    assert res_del.json()["success"] is True

    print("[OK] FastAPI endpoints GET /admin/metrics and DELETE /admin/users/{id} verified")

if __name__ == "__main__":
    test_no_graph_cache_in_admin_service()
    test_seed_demo_users_and_storage_layout()
    test_repository_user_management()
    test_admin_service_aggregations()
    test_fastapi_admin_routes()
    print("\nALL TASK 13.4 ACCEPTANCE TESTS PASSED SUCCESSFULLY!")
