#!/usr/bin/env python3
"""
Acceptance test for TASK 13.3 — Admin Dashboard (Cloud Ready, Local Mode)
Verifies:
1. admin_service.py uses GraphRepository ONLY (zero graph_cache imports).
2. AdminService().get_metrics() returns valid KPI, user table, company insights, network health, and recent activity datasets.
3. GET /admin/metrics endpoint returns HTTP 200 with complete metrics payload.
4. website/admin.html, website/css/admin.css, and website/js/admin.js exist and are valid.
"""

import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

def test_no_graph_cache_import_in_admin_service():
    admin_service_path = backend_dir / "services" / "admin_service.py"
    assert admin_service_path.exists(), "admin_service.py must exist"
    code = admin_service_path.read_text(encoding="utf-8")
    assert "graph_cache" not in code, "admin_service.py must NOT import graph_cache directly!"
    print("[OK] Rule Verified: admin_service.py does not import graph_cache")

def test_admin_service_metrics():
    from services.admin_service import AdminService
    service = AdminService()
    metrics = service.get_metrics()

    assert "kpis" in metrics, "metrics must include 'kpis'"
    kpis = metrics["kpis"]
    for key in ["total_users", "total_people", "total_companies", "total_relationships", "successful_syncs"]:
        assert key in kpis, f"kpis missing '{key}'"
        assert isinstance(kpis[key], (int, float)), f"kpis['{key}'] must be numeric"

    assert "users" in metrics, "metrics must include 'users'"
    assert isinstance(metrics["users"], list), "'users' must be a list"

    assert "company_insights" in metrics, "metrics must include 'company_insights'"
    assert isinstance(metrics["company_insights"], list), "'company_insights' must be a list"

    assert "network_health" in metrics, "metrics must include 'network_health'"
    health = metrics["network_health"]
    for key in ["avg_network_size", "largest_network", "smallest_network", "avg_warm_score", "sync_success_rate"]:
        assert key in health, f"network_health missing '{key}'"

    assert "recent_activity" in metrics, "metrics must include 'recent_activity'"
    assert isinstance(metrics["recent_activity"], list), "'recent_activity' must be a list"

    print("[OK] AdminService.get_metrics() output structure verified successfully")

def test_fastapi_admin_endpoint():
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    response = client.get("/admin/metrics")
    assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}"
    data = response.json()
    assert "kpis" in data, "FastAPI response missing 'kpis'"
    assert "users" in data, "FastAPI response missing 'users'"
    assert "company_insights" in data, "FastAPI response missing 'company_insights'"
    assert "network_health" in data, "FastAPI response missing 'network_health'"
    assert "recent_activity" in data, "FastAPI response missing 'recent_activity'"
    print("[OK] FastAPI Endpoint GET /admin/metrics returned 200 OK with valid metrics payload")

def test_website_admin_files_exist():
    root_dir = Path(__file__).resolve().parent.parent
    admin_html = root_dir / "website" / "admin.html"
    admin_css = root_dir / "website" / "css" / "admin.css"
    admin_js = root_dir / "website" / "js" / "admin.js"

    assert admin_html.exists(), "website/admin.html must exist"
    assert admin_css.exists(), "website/css/admin.css must exist"
    assert admin_js.exists(), "website/js/admin.js must exist"

    html_content = admin_html.read_text(encoding="utf-8")
    assert "kpi-total-users" in html_content, "admin.html must reference kpi elements"
    assert "user-table-body" in html_content, "admin.html must reference user table"
    assert "company-insights-bars" in html_content, "admin.html must reference company insights"

    print("[OK] Website files website/admin.html, css/admin.css, and js/admin.js verified successfully")

if __name__ == "__main__":
    test_no_graph_cache_import_in_admin_service()
    test_admin_service_metrics()
    test_fastapi_admin_endpoint()
    test_website_admin_files_exist()
    print("\nALL TASK 13.3 ACCEPTANCE TESTS PASSED SUCCESSFULLY!")
