from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.cli import create_first_admin, initialize_secret
from app.core.config import get_settings
from app.core.security import hash_password, new_token, token_hash
from app.db.session import get_db
from app.main import create_app
from app.models import AuditLog, PasswordResetToken, RefreshToken, User
from app.services.email import get_email_sender

PASSWORD = "Correct-Passphrase123!"


class RecordingSender:
    def __init__(self):
        self.emails = []

    def send(self, recipient, subject, link):
        self.emails.append((recipient, subject, link))

    def token(self):
        return parse_qs(urlsplit(self.emails[-1][2]).query)["token"][0]


@pytest.fixture
def auth_context(db_session):
    settings = get_settings().model_copy(
        update={"jwt_secret": SecretStr(new_token()), "login_rate_limit": 100}
    )
    application = create_app(settings)
    sender = RecordingSender()
    application.dependency_overrides[get_db] = lambda: db_session
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_email_sender] = lambda: sender
    client = TestClient(
        application,
        base_url="https://testserver",
        headers={"Origin": settings.frontend_url},
    )
    return client, db_session, sender, settings


def add_user(
    session, role="agent", email="agent@example.com", status="approved", verified=True
):
    user = User(
        email=email,
        password_hash=hash_password(PASSWORD),
        role=role,
        status=status,
        email_verified_at=datetime.now(UTC) if verified else None,
    )
    session.add(user)
    session.commit()
    return user


def sign_in(client, email="agent@example.com", password=PASSWORD):
    return client.post("/auth/login", json={"email": email, "password": password})


def bearer_headers(response):
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_login_refresh_reuse_and_logout(auth_context):
    client, session, _, _ = auth_context
    add_user(session)
    login = sign_in(client)
    assert login.status_code == 200
    cookie = login.headers["set-cookie"]
    assert all(
        attribute in cookie
        for attribute in ["HttpOnly", "Secure", "SameSite=strict", "Path=/auth"]
    )
    raw = client.cookies.get("salesmesh_refresh")
    assert session.scalar(select(RefreshToken)).token_hash == token_hash(raw)
    headers = bearer_headers(login)
    assert client.get("/auth/me", headers=headers).status_code == 200
    rotated = client.post("/auth/refresh")
    assert rotated.status_code == 200
    assert client.cookies.get("salesmesh_refresh") != raw
    assert (
        client.post(
            "/auth/refresh", headers={"Cookie": f"salesmesh_refresh={raw}"}
        ).status_code
        == 401
    )
    assert client.get("/auth/me", headers=bearer_headers(rotated)).status_code == 401
    login = sign_in(client)
    assert client.post("/auth/logout").status_code == 200
    assert client.get("/auth/me", headers=bearer_headers(login)).status_code == 401
    assert client.post("/auth/logout").status_code == 200


def test_registration_verification_and_pending(auth_context):
    client, session, sender, _ = auth_context
    response = client.post(
        "/auth/register", json={"email": "Agent@EXAMPLE.com", "password": PASSWORD}
    )
    assert response.status_code == 201
    assert response.json()["role"] == "agent"
    assert response.json()["status"] == "pending"
    assert response.json()["email"] == "agent@example.com"
    assert "password" not in response.text
    raw = sender.token()
    assert session.scalar(select(User)).verification_token_hash == token_hash(raw)
    assert sign_in(client).status_code == 401
    assert client.post("/auth/verify-email", json={"token": raw}).status_code == 200
    assert client.post("/auth/verify-email", json={"token": raw}).status_code == 400
    assert sign_in(client).status_code == 401


def test_password_reset_single_use_and_session_revocation(auth_context):
    client, session, sender, _ = auth_context
    add_user(session)
    login = sign_in(client)
    known = client.post("/auth/forgot-password", json={"email": "agent@example.com"})
    raw = sender.token()
    unknown = client.post(
        "/auth/forgot-password", json={"email": "missing@example.com"}
    )
    assert known.json() == unknown.json()
    assert session.scalar(select(PasswordResetToken)).token_hash == token_hash(raw)
    replacement = "Replacement-Passphrase123!"
    payload = {"token": raw, "password": replacement}
    assert client.post("/auth/reset-password", json=payload).status_code == 200
    assert client.post("/auth/reset-password", json=payload).status_code == 400
    assert client.get("/auth/me", headers=bearer_headers(login)).status_code == 401
    assert sign_in(client).status_code == 401
    assert sign_in(client, password=replacement).status_code == 200


def test_lockout_and_login_audit(auth_context):
    client, session, _, settings = auth_context
    user = add_user(session)
    for _ in range(settings.login_failure_limit):
        assert sign_in(client, password="Wrong-Password123!").status_code == 401
    session.refresh(user)
    assert user.locked_until is not None
    assert sign_in(client).status_code == 401
    user.locked_until = datetime.now(UTC) - timedelta(seconds=1)
    session.commit()
    assert sign_in(client).status_code == 200
    assert "login_failure" in session.scalars(select(AuditLog.action)).all()


def test_expired_access_token_is_401(auth_context):
    client, session, _, settings = auth_context
    add_user(session)
    token = sign_in(client).json()["access_token"]
    claims = jwt.decode(
        token,
        settings.signing_key(),
        algorithms=["HS256"],
        audience=settings.jwt_audience,
    )
    claims["exp"] = datetime.now(UTC) - timedelta(seconds=1)
    expired = jwt.encode(claims, settings.signing_key(), algorithm="HS256")
    assert (
        client.get(
            "/auth/me", headers={"Authorization": f"Bearer {expired}"}
        ).status_code
        == 401
    )


def test_admin_approval_rejection_and_user_management(auth_context):
    client, session, sender, _ = auth_context
    admin = add_user(session, role="admin", email="admin@example.com")
    agent = add_user(session, email="pending@example.com", status="pending")
    rejected = add_user(session, email="rejected@example.com", status="pending")
    admin_headers = bearer_headers(sign_in(client, "admin@example.com"))
    assert (
        client.post(
            f"/admin/users/{agent.id}/approve", headers=admin_headers
        ).status_code
        == 200
    )
    assert sign_in(client, "pending@example.com").status_code == 200
    assert (
        client.post(
            f"/admin/users/{rejected.id}/reject", headers=admin_headers
        ).status_code
        == 200
    )
    assert sign_in(client, "rejected@example.com").status_code == 401
    for role in ("client", "admin"):
        email = f"new-{role}@example.com"
        created = client.post(
            "/admin/users",
            json={"email": email, "password": PASSWORD, "role": role},
            headers=admin_headers,
        )
        assert created.status_code == 201
        assert created.json()["role"] == role
        assert sign_in(client, email).status_code == 401
        assert (
            client.post(
                "/auth/verify-email", json={"token": sender.token()}
            ).status_code
            == 200
        )
        assert sign_in(client, email).status_code == 200
    agent_login = sign_in(client, "pending@example.com")
    assert (
        client.patch(
            f"/admin/users/{agent.id}/active",
            json={"is_active": False},
            headers=admin_headers,
        ).status_code
        == 200
    )
    assert (
        client.get("/auth/me", headers=bearer_headers(agent_login)).status_code == 401
    )
    assert sign_in(client, "pending@example.com").status_code == 401
    assert (
        client.patch(
            f"/admin/users/{agent.id}/active",
            json={"is_active": True},
            headers=admin_headers,
        ).status_code
        == 200
    )
    agent_login = sign_in(client, "pending@example.com")
    assert (
        client.patch(
            f"/admin/users/{agent.id}/role",
            json={"role": "client"},
            headers=admin_headers,
        ).status_code
        == 200
    )
    assert (
        client.get("/auth/me", headers=bearer_headers(agent_login)).status_code == 401
    )
    assert client.get("/admin/users", headers=admin_headers).status_code == 200
    assert (
        client.get(f"/admin/users/{agent.id}", headers=admin_headers).status_code == 200
    )
    logs = client.get("/admin/audit-logs?limit=100", headers=admin_headers)
    assert logs.status_code == 200
    actions = {item["action"] for item in logs.json()["items"]}
    assert {
        "agent_approved",
        "agent_rejected",
        "user_created",
        "user_activity_changed",
        "user_role_changed",
    } <= actions
    assert "password" not in logs.text
    assert (
        client.patch(
            f"/admin/users/{admin.id}/active",
            json={"is_active": False},
            headers=admin_headers,
        ).status_code
        == 400
    )


@pytest.mark.parametrize("role", ["agent", "client"])
def test_wrong_role_forbidden(auth_context, role):
    client, session, _, _ = auth_context
    add_user(session, role=role)
    headers = bearer_headers(sign_in(client))
    assert client.get("/admin/users", headers=headers).status_code == 403
    assert client.get("/admin/audit-logs", headers=headers).status_code == 403
    assert (
        client.post(
            "/admin/users",
            headers=headers,
            json={"email": "new@example.com", "password": PASSWORD, "role": "admin"},
        ).status_code
        == 403
    )


def test_admin_failed_user_actions_are_audited(auth_context):
    client, session, _, _ = auth_context
    add_user(session, role="admin", email="admin@example.com")
    headers = bearer_headers(sign_in(client, "admin@example.com"))
    payload = {"email": "admin@example.com", "password": PASSWORD, "role": "client"}
    assert client.post("/admin/users", headers=headers, json=payload).status_code == 409
    assert client.get(f"/admin/users/{uuid4()}", headers=headers).status_code == 404
    failures = session.scalars(
        select(AuditLog).where(AuditLog.outcome == "failure")
    ).all()
    assert {record.action for record in failures} == {"user_created", "user_viewed"}


def test_change_password_and_logout_all(auth_context):
    client, session, _, _ = auth_context
    add_user(session)
    first = sign_in(client)
    second = sign_in(client)
    headers = bearer_headers(first)
    assert (
        client.post(
            "/auth/change-password",
            json={
                "current_password": "Wrong-Password123!",
                "new_password": "New-Passphrase123!",
            },
            headers=headers,
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/auth/change-password",
            json={"current_password": PASSWORD, "new_password": "New-Passphrase123!"},
            headers=headers,
        ).status_code
        == 200
    )
    assert client.get("/auth/me", headers=bearer_headers(second)).status_code == 401
    first = sign_in(client, password="New-Passphrase123!")
    second = sign_in(client, password="New-Passphrase123!")
    assert (
        client.post("/auth/logout-all", headers=bearer_headers(first)).status_code
        == 200
    )
    assert client.get("/auth/me", headers=bearer_headers(second)).status_code == 401
    assert client.post("/auth/refresh").status_code == 401


def test_first_admin_bootstrap_and_secret_generation(auth_context, tmp_path):
    client, session, _, _ = auth_context
    user = create_first_admin(session, "First-Admin@example.com", PASSWORD)
    assert user.email_verified_at is not None
    assert sign_in(client, user.email).status_code == 200
    with pytest.raises(ValueError, match="already exists"):
        create_first_admin(session, "other-admin@example.com", PASSWORD)
    path = tmp_path / ".env"
    path.write_text("POSTGRES_PORT=5433\n", encoding="utf-8")
    assert initialize_secret(path)
    contents = path.read_text(encoding="utf-8")
    assert "JWT_SECRET=" in contents
    assert "POSTGRES_PORT=5433" in contents
    assert not initialize_secret(path)
    assert path.read_text(encoding="utf-8") == contents


def test_login_rate_limit_is_shared_across_accounts(auth_context):
    client, session, _, settings = auth_context
    settings.login_rate_limit = 2
    assert sign_in(client, "unknown-one@example.com").status_code == 401
    assert sign_in(client, "unknown-two@example.com").status_code == 401
    response = sign_in(client, "unknown-three@example.com")
    assert response.status_code == 429
    assert response.headers["Retry-After"] == str(settings.login_rate_window_seconds)
    records = session.scalars(select(AuditLog)).all()
    assert len(records) == 2
    assert all(len(record.client_ip_hash) == 64 for record in records)
    assert "testclient" not in response.text


@pytest.mark.parametrize("route", ["refresh", "logout"])
@pytest.mark.parametrize("origin", [None, "https://untrusted.example"])
def test_cookie_endpoints_require_trusted_origin(auth_context, route, origin):
    client, session, _, _ = auth_context
    add_user(session)
    login = sign_in(client)
    if origin is None:
        del client.headers["Origin"]
    else:
        client.headers["Origin"] = origin
    assert client.post(f"/auth/{route}").status_code == 403
    assert client.get("/auth/me", headers=bearer_headers(login)).status_code == 200


def test_expired_refresh_and_verification_tokens(auth_context):
    client, session, sender, _ = auth_context
    user = add_user(session)
    login = sign_in(client)
    token = session.scalar(select(RefreshToken))
    token.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    session.commit()
    assert client.post("/auth/refresh").status_code == 401
    assert client.get("/auth/me", headers=bearer_headers(login)).status_code == 401
    user.email_verified_at = None
    session.commit()
    assert (
        client.post("/auth/resend-verification", json={"email": user.email}).status_code
        == 200
    )
    raw = sender.token()
    session.refresh(user)
    user.verification_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    session.commit()
    assert client.post("/auth/verify-email", json={"token": raw}).status_code == 400


def test_new_recovery_tokens_replace_old_tokens(auth_context):
    client, session, sender, _ = auth_context
    user = add_user(session, verified=False)
    known = client.post("/auth/resend-verification", json={"email": user.email})
    first = sender.token()
    unknown = client.post(
        "/auth/resend-verification", json={"email": "unknown@example.com"}
    )
    assert known.json() == unknown.json()
    client.post("/auth/resend-verification", json={"email": user.email})
    second = sender.token()
    assert client.post("/auth/verify-email", json={"token": first}).status_code == 400
    assert client.post("/auth/verify-email", json={"token": second}).status_code == 200
    client.post("/auth/forgot-password", json={"email": user.email})
    first = sender.token()
    client.post("/auth/forgot-password", json={"email": user.email})
    second = sender.token()
    assert (
        client.post(
            "/auth/reset-password", json={"token": first, "password": PASSWORD}
        ).status_code
        == 400
    )
    token = session.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash(second)
        )
    )
    token.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    session.commit()
    assert (
        client.post(
            "/auth/reset-password", json={"token": second, "password": PASSWORD}
        ).status_code
        == 400
    )


def test_reuse_only_revokes_affected_session(auth_context):
    client, session, _, _ = auth_context
    add_user(session)
    first = sign_in(client)
    old = client.cookies.get("salesmesh_refresh")
    assert client.post("/auth/refresh").status_code == 200
    second = sign_in(client)
    assert (
        client.post(
            "/auth/refresh", headers={"Cookie": f"salesmesh_refresh={old}"}
        ).status_code
        == 401
    )
    assert client.get("/auth/me", headers=bearer_headers(first)).status_code == 401
    assert client.get("/auth/me", headers=bearer_headers(second)).status_code == 200


def test_registration_policy_duplicates_and_role_injection(auth_context):
    client, _, _, _ = auth_context
    assert (
        client.post(
            "/auth/register", json={"email": "agent@example.com", "password": "weak"}
        ).status_code
        == 422
    )
    payload = {
        "email": "agent@example.com",
        "password": PASSWORD,
        "role": "admin",
        "status": "approved",
    }
    response = client.post("/auth/register", json=payload)
    assert response.status_code == 201
    assert response.json()["role"] == "agent"
    assert response.json()["status"] == "pending"
    assert client.post("/auth/register", json=payload).status_code == 409


def test_invalid_access_tokens_are_401(auth_context):
    client, session, _, settings = auth_context
    add_user(session)
    login = sign_in(client)
    token = login.json()["access_token"]
    claims = jwt.decode(
        token,
        settings.signing_key(),
        algorithms=["HS256"],
        audience=settings.jwt_audience,
    )
    for altered in (
        {**claims, "aud": "wrong-audience"},
        {**claims, "iss": "wrong-issuer"},
        {**claims, "sub": "not-a-uuid"},
    ):
        forged = jwt.encode(altered, settings.signing_key(), algorithm="HS256")
        assert (
            client.get(
                "/auth/me", headers={"Authorization": f"Bearer {forged}"}
            ).status_code
            == 401
        )
    assert (
        client.get("/auth/me", headers={"Authorization": "Bearer garbage"}).status_code
        == 401
    )
    assert client.get("/auth/me").status_code == 401


def test_audits_never_contain_raw_credentials(auth_context):
    client, session, sender, _ = auth_context
    add_user(session)
    login = sign_in(client)
    raw_refresh = client.cookies.get("salesmesh_refresh")
    client.post("/auth/forgot-password", json={"email": "agent@example.com"})
    raw_reset = sender.token()
    client.post("/auth/logout")
    records = session.scalars(select(AuditLog)).all()
    actions = {record.action for record in records}
    assert {"login_success", "logout", "password_reset_requested"} <= actions
    for record in records:
        stored = repr(
            {
                column.name: getattr(record, column.name)
                for column in AuditLog.__table__.columns
            }
        )
        for secret in (PASSWORD, raw_refresh, raw_reset, login.json()["access_token"]):
            assert secret not in stored


@pytest.mark.parametrize("route", ["refresh", "reset-password", "verify-email"])
def test_concurrent_token_consumption(test_engine, route):
    settings = get_settings().model_copy(update={"jwt_secret": SecretStr(new_token())})
    application = create_app(settings)
    sender = RecordingSender()

    def database_session():
        with Session(test_engine) as session:
            yield session

    application.dependency_overrides[get_db] = database_session
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_email_sender] = lambda: sender
    email = f"{uuid4()}@example.com"
    user_id = None
    try:
        with Session(test_engine) as session:
            user_id = add_user(
                session, email=email, verified=route != "verify-email"
            ).id
        initial = TestClient(
            application,
            base_url="https://testserver",
            headers={"Origin": settings.frontend_url},
        )
        if route == "refresh":
            assert sign_in(initial, email).status_code == 200
            raw = initial.cookies.get("salesmesh_refresh")
            headers = {
                "Origin": settings.frontend_url,
                "Cookie": f"salesmesh_refresh={raw}",
            }
            payload = None
        else:
            endpoint = (
                "forgot-password"
                if route == "reset-password"
                else "resend-verification"
            )
            assert (
                initial.post(f"/auth/{endpoint}", json={"email": email}).status_code
                == 200
            )
            headers = {"Origin": settings.frontend_url}
            payload = {"token": sender.token()}
            if route == "reset-password":
                payload["password"] = "Replacement-Passphrase123!"
        barrier = Barrier(2)

        def consume():
            client = TestClient(application, base_url="https://testserver")
            barrier.wait(timeout=10)
            return client.post(
                f"/auth/{route}", headers=headers, json=payload
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: consume(), range(2)))
        assert sorted(results) == ([200, 401] if route == "refresh" else [200, 400])
        if route == "refresh":
            with Session(test_engine) as session:
                assert not session.scalars(
                    select(RefreshToken).where(
                        RefreshToken.user_id == user_id,
                        RefreshToken.revoked_at.is_(None),
                    )
                ).all()
    finally:
        if user_id is not None:
            with test_engine.begin() as connection:
                connection.execute(
                    delete(AuditLog).where(
                        (AuditLog.actor_user_id == user_id)
                        | (AuditLog.target_user_id == user_id)
                    )
                )
                connection.execute(delete(User).where(User.id == user_id))
