#!/usr/bin/env python3
"""
Acceptance test for TASK 13.5 — Cloud Sync Adapter (Offline SaaS Layer)
Verifies:
1. CloudSyncService uses GraphRepository ONLY (zero graph_cache imports).
2. 208 connections and evidence sync successfully via CloudSyncService.sync_network().
3. Sync sessions are recorded in backend/data/sync_sessions.json with newest session first.
4. GET /sync/status exposes progress=100 and connections count.
5. Recent Sync Activity in Admin Dashboard updates automatically.
6. Extension adapter extension/cloud_sync.js defines CloudSyncAdapter & warmgraph_pending_sync queue logic.
"""

import sys
import json
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

def test_no_graph_cache_in_cloud_sync_service():
    cloud_sync_path = backend_dir / "services" / "cloud_sync_service.py"
    assert cloud_sync_path.exists(), "cloud_sync_service.py must exist"
    code = cloud_sync_path.read_text(encoding="utf-8")
    assert "graph_cache" not in code, "cloud_sync_service.py must NOT import graph_cache!"
    print("[OK] cloud_sync_service.py contains zero graph_cache imports")

def test_cloud_sync_service_208_connections():
    from services.cloud_sync_service import CloudSyncService
    from repositories.repository_provider import get_graph_repository

    repo = get_graph_repository()
    service = CloudSyncService(repo)
    user_id = "cloud_test_user_208"

    # Generate test payload with 208 connections & 36 evidence items
    connections = [
        {"name": f"Person {i}", "headline": f"Role {i} at Company {i % 10}", "profile_url": f"https://linkedin.com/in/person-{i}", "company": f"Company {i % 10}"}
        for i in range(1, 209)
    ]
    evidence = [
        {"name": f"Evidence Person {j}", "profile_url": f"https://linkedin.com/in/ev-person-{j}", "observed_degree": "2nd", "evidence_type": "mutual_connection_ui"}
        for j in range(1, 37)
    ]

    payload = {
        "user_id": user_id,
        "connections": connections,
        "relationship_evidence": evidence,
        "source": "linkedin_dom"
    }

    result = service.sync_network(user_id, payload)
    assert result["success"] is True, "sync_network must return success: True"
    assert result["connections"] == 208, f"Expected 208 connections, got {result['connections']}"
    assert result["relationships"] == 36, f"Expected 36 relationships, got {result['relationships']}"
    assert result["status"] == "completed", "Expected status 'completed'"

    # Verify repository persistence
    net = repo.get_network(user_id)
    assert net is not None, "get_network must return stored network dataset"
    assert len(net["connections"]) == 208, "Repository connections count mismatch"
    assert len(net["relationship_evidence"]) == 36, "Repository relationship evidence count mismatch"

    # Verify sync_sessions.json layout
    sessions_file = backend_dir / "data" / "sync_sessions.json"
    assert sessions_file.exists(), "backend/data/sync_sessions.json must exist"
    sessions_data = json.loads(sessions_file.read_text(encoding="utf-8"))
    assert len(sessions_data) > 0, "sync_sessions.json must contain session records"
    latest_session = sessions_data[0]
    assert latest_session["user_id"] == user_id, "Latest session user_id mismatch"
    assert latest_session["connections"] == 208, "Latest session connections count mismatch"
    assert latest_session["status"] == "completed", "Latest session status mismatch"

    print("[OK] CloudSyncService successfully synced 208 connections & 36 relationships to repository & sync_sessions.json")

def test_sync_status_and_history_api():
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    user_id = "cloud_test_user_208"

    res_status = client.get(f"/sync/status?user_id={user_id}")
    assert res_status.status_code == 200, f"Expected 200 OK, got {res_status.status_code}"
    status_data = res_status.json()
    assert status_data["user_id"] == user_id, "user_id mismatch in /sync/status"
    assert status_data["status"] == "completed", "status mismatch in /sync/status"
    assert status_data["progress"] == 100, "progress mismatch in /sync/status"
    assert status_data["connections"] == 208, "connections mismatch in /sync/status"

    res_history = client.get(f"/sync/history?user_id={user_id}")
    assert res_history.status_code == 200, f"Expected 200 OK, got {res_history.status_code}"
    history_data = res_history.json()
    assert len(history_data) > 0, "history_data should contain at least 1 session"
    assert history_data[0]["connections"] == 208

    print("[OK] FastAPI endpoints /sync/status and /sync/history verified")

def test_admin_dashboard_sync_activity_update():
    from services.admin_service import AdminService
    from repositories.repository_provider import get_graph_repository

    repo = get_graph_repository()
    admin_service = AdminService(repo)
    recent_syncs = admin_service.get_recent_syncs()

    assert len(recent_syncs) > 0, "AdminService get_recent_syncs should return sync activity items"
    latest_activity = recent_syncs[0]
    assert "synced 208 connections" in latest_activity["title"], f"Title mismatch: {latest_activity['title']}"

    print("[OK] Admin Dashboard Recent Sync Activity automatically reflects cloud sync session")

def test_extension_cloud_sync_adapter_files():
    root_dir = Path(__file__).resolve().parent.parent
    adapter_file = root_dir / "extension" / "cloud_sync.js"
    assert adapter_file.exists(), "extension/cloud_sync.js must exist"

    code = adapter_file.read_text(encoding="utf-8")
    assert "CloudSyncAdapter" in code, "cloud_sync.js must define CloudSyncAdapter object"
    assert "startSync" in code, "cloud_sync.js must contain startSync method"
    assert "uploadConnections" in code, "cloud_sync.js must contain uploadConnections method"
    assert "uploadEvidence" in code, "cloud_sync.js must contain uploadEvidence method"
    assert "finishSync" in code, "cloud_sync.js must contain finishSync method"
    assert "getLastSync" in code, "cloud_sync.js must contain getLastSync method"
    assert "warmgraph_pending_sync" in code, "cloud_sync.js must reference warmgraph_pending_sync queue"

    print("[OK] Extension adapter extension/cloud_sync.js methods & warmgraph_pending_sync queue logic verified")

if __name__ == "__main__":
    test_no_graph_cache_in_cloud_sync_service()
    test_cloud_sync_service_208_connections()
    test_sync_status_and_history_api()
    test_admin_dashboard_sync_activity_update()
    test_extension_cloud_sync_adapter_files()
    print("\nALL TASK 13.5 ACCEPTANCE TESTS PASSED SUCCESSFULLY!")
