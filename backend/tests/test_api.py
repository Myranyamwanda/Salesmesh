import json
import logging
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.config import get_settings
from app.core.logging import JsonFormatter
from app.db.session import get_db
from app.main import create_app


@pytest.fixture
def api():
    application = create_app()
    session = Mock()
    application.dependency_overrides[get_db] = lambda: session
    return application, session


def client_for(application):
    return TestClient(
        CORSMiddleware(
            application,
            allow_origins=[get_settings().frontend_url],
            allow_credentials=True,
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type"],
        ),
        raise_server_exceptions=False,
    )


def test_health_checks_database(api):
    application, session = api
    response = client_for(application).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}
    assert str(session.execute.call_args.args[0]) == "SELECT 1"
    assert response.headers["X-Request-ID"]


def test_health_database_failure_is_safe(api):
    application, session = api
    session.execute.side_effect = OperationalError("secret query", {}, Exception())
    response = client_for(application).get("/health")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"
    assert "secret" not in response.text
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]


def test_not_found_uses_error_envelope(api):
    response = client_for(api[0]).get("/missing")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_404"


def test_validation_does_not_echo_input(api):
    application, _ = api

    @application.get("/validation-test")
    def validation_test(count: int):
        return count

    response = client_for(application).get("/validation-test?count=private-value")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert "private-value" not in response.text


def test_http_errors_preserve_headers(api):
    application, _ = api

    @application.get("/unauthorized-test")
    def unauthorized_test():
        raise HTTPException(
            401, "Authentication required", headers={"WWW-Authenticate": "Bearer"}
        )

    response = client_for(application).get("/unauthorized-test")
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_unexpected_errors_and_cors(api):
    application, _ = api

    @application.get("/failure-test")
    def failure_test():
        raise RuntimeError("private-value")

    response = client_for(application).get(
        "/failure-test", headers={"Origin": get_settings().frontend_url}
    )
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
    assert "private-value" not in response.text
    assert (
        response.headers["Access-Control-Allow-Origin"] == get_settings().frontend_url
    )


def test_cors_only_allows_configured_origin(api):
    client = client_for(api[0])
    origin = get_settings().frontend_url
    allowed = client.options(
        "/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
    )
    assert allowed.headers["Access-Control-Allow-Origin"] == origin
    assert allowed.headers["Access-Control-Allow-Credentials"] == "true"
    denied = client.options(
        "/health",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert denied.status_code == 400
    assert "Access-Control-Allow-Origin" not in denied.headers


def test_json_formatter_only_logs_allowed_metadata():
    record = logging.LogRecord("salesmesh", logging.INFO, "", 1, "event", (), None)
    record.request_id = "request-id"
    record.password = "private-value"
    rendered = JsonFormatter().format(record)
    assert json.loads(rendered)["request_id"] == "request-id"
    assert "private-value" not in rendered
