#!/usr/bin/env python3
"""
Python Acceptance Test for TASK 13.5.1 — Backend Auth & Admin Dashboard Identity
"""

import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

def test_backend_auth_dependency_header():
    from auth.dependencies import get_current_user
    
    # Test wg_local_<uuid> header
    user = get_current_user(x_warmgraph_session="wg_local_8f3a91c2d1b84e7")
    assert user.id == "wg_8f3a91c2d1b84e7", f"Expected id 'wg_8f3a91c2d1b84e7', got '{user.id}'"
    assert user.name == "WarmGraph User", f"Expected name 'WarmGraph User', got '{user.name}'"
    assert user.provider == "local", f"Expected provider 'local', got '{user.provider}'"
    assert not hasattr(user, "password") or getattr(user, "password", None) is None
    print("[PASS] Backend auth dependency get_current_user resolves wg_local_<uuid> header")

def test_fastapi_auth_me_endpoint():
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    response = client.get("/auth/me", headers={"X-WarmGraph-Session": "wg_local_8f3a91c2d1b84e7"})
    assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}"

    data = response.json()
    assert data["authenticated"] is True
    assert data["user"]["id"] == "wg_8f3a91c2d1b84e7"
    assert data["user"]["name"] == "WarmGraph User"
    assert data["user"]["provider"] == "local"
    assert "password" not in data["user"]
    print("[PASS] FastAPI /auth/me returns authenticated LocalUser schema with zero credentials")

def test_admin_dashboard_user_table():
    from services.admin_service import AdminService
    from repositories.repository_provider import get_graph_repository

    repo = get_graph_repository()
    # Ensure test user wg_8f3a91c2d1b84e7 is in repository
    repo.save_network("wg_8f3a91c2d1b84e7", {
        "owner_id": "wg_8f3a91c2d1b84e7",
        "connections": [{"name": "Conn 1"}],
        "relationship_evidence": []
    })

    admin_service = AdminService(repo)
    users = admin_service.get_all_users()
    
    found = False
    for u in users:
        if u["id"] == "wg_8f3a91c2d1b84e7":
            found = True
            assert u["name"] == "WarmGraph User", f"Expected 'WarmGraph User', got '{u['name']}'"
            assert u["provider"] == "Local", f"Expected 'Local', got '{u['provider']}'"
            assert u["status"] in {"Active", "Idle"}, f"Unexpected status: {u['status']}"
            assert "password" not in u
            assert "email" not in u
            break
    
    assert found, "Test user wg_8f3a91c2d1b84e7 not found in admin users table"
    print("[PASS] Admin Dashboard get_all_users displays Name, User ID, Provider, Status with zero passwords")

if __name__ == "__main__":
    test_backend_auth_dependency_header()
    test_fastapi_auth_me_endpoint()
    test_admin_dashboard_user_table()
    print("\nALL TASK 13.5.1 PYTHON ACCEPTANCE TESTS PASSED SUCCESSFULLY!")
