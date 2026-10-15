from datetime import UTC, datetime
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from test_auth import add_user, auth_context, bearer_headers, sign_in  # noqa: F401
from test_model_service import REAL_MODEL_DIR

from app.db.session import get_db
from app.main import create_app
from app.ml.model_service import GoldenCheck, ModelService, ModelState

READY = ModelState(
    status="ok",
    source="local",
    loaded_at=datetime(2026, 10, 15, tzinfo=UTC),
    metadata={
        "model_name": "salesmesh-fake-user-detector",
        "model_version": "v1",
        "model_type": "LogisticRegression",
        "sklearn_version": "1.7.2",
        "threshold": 0.035,
        "metrics_test": {"ROC-AUC": 0.8165},
    },
    golden=GoldenCheck(checked=20, failed=0, max_difference=4.9e-7),
)


def test_admin_reads_model_status(auth_context):  # noqa: F811
    client, session, _, _ = auth_context
    client.app.state.model_service = ModelService(READY)
    add_user(session, role="admin", email="admin@example.com")

    response = client.get(
        "/admin/model", headers=bearer_headers(sign_in(client, "admin@example.com"))
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["model_version"] == "v1"
    assert body["threshold"] == 0.035
    assert body["metrics"] == {"ROC-AUC": 0.8165}
    assert body["golden_check"] == {
        "passed": True,
        "checked": 20,
        "failed": 0,
        "max_difference": 4.9e-7,
        "tolerance": 1e-6,
    }


def test_admin_sees_why_model_failed(auth_context):  # noqa: F811
    client, session, _, _ = auth_context
    add_user(session, role="admin", email="admin@example.com")

    response = client.get(
        "/admin/model", headers=bearer_headers(sign_in(client, "admin@example.com"))
    )

    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["error"] == "Model is not loaded"
    assert response.json()["golden_check"] is None


@pytest.mark.parametrize("role", ["agent", "client"])
def test_model_status_is_admin_only(auth_context, role):  # noqa: F811
    client, session, _, _ = auth_context
    add_user(session, role=role)
    response = client.get("/admin/model", headers=bearer_headers(sign_in(client)))
    assert response.status_code == 403


def test_model_status_requires_token(auth_context):  # noqa: F811
    client, _, _, _ = auth_context
    assert client.get("/admin/model").status_code == 401


@pytest.mark.skipif(
    not (REAL_MODEL_DIR / "model.joblib").is_file(),
    reason="Model files are not in Git; download them to backend/models/v1",
)
def test_startup_loads_real_model_and_health_reports_it():
    application = create_app()
    application.dependency_overrides[get_db] = lambda: Mock()
    with TestClient(application) as client:
        assert client.get("/health").json() == {
            "status": "ok",
            "database": "ok",
            "model": "ok",
            "model_error": None,
        }
