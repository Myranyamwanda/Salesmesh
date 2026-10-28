"""SalesMesh sessions after a Firebase sign-in: tokens, refresh, logout, RBAC.

Firebase is the FakeFirebase from conftest.py. The helpers here (auth_context,
add_user, sign_in, bearer_headers) are shared by the other test modules.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import jwt
import pyotp
import pytest
from conftest import FakeFirebase
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.cli import initialize_secret
from app.core.config import get_settings
from app.core.security import new_token, token_hash
from app.db.session import get_db
from app.main import create_app
from app.models import AuditLog, RefreshToken, User
from app.services.firebase import get_firebase
from app.services.mfa import encrypt_secret


@pytest.fixture
def auth_context(db_session, fake_firebase):
    settings = get_settings().model_copy(
        update={
            "jwt_secret": SecretStr(new_token()),
            "totp_encryption_key": SecretStr(Fernet.generate_key().decode()),
            "login_rate_limit": 100,
        }
    )
    application = create_app(settings)
    application.dependency_overrides[get_db] = lambda: db_session
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_firebase] = lambda: fake_firebase
    client = TestClient(
        application,
        base_url="https://testserver",
        headers={"Origin": settings.frontend_url},
    )
    return client, db_session, fake_firebase, settings


def add_user(
    session, role="agent", email="agent@example.com", status="approved", verified=True
):
    """A SalesMesh user with no local password; Firebase links it at sign-in."""
    user = User(
        email=email,
        role=role,
        status=status,
        email_verified_at=datetime.now(UTC) if verified else None,
    )
    session.add(user)
    session.commit()
    return user


def enrol_totp(session, user, settings) -> str:
    """Give an admin a fresh authenticator directly; return its secret."""
    secret = pyotp.random_base32()
    user.totp_secret_encrypted = encrypt_secret(secret, settings)
    user.totp_enabled_at = datetime.now(UTC)
    user.totp_last_step = None
    session.commit()
    return secret


def sign_in(client, email="agent@example.com"):
    """Sign in through the fake Firebase; an admin also enters a TOTP code.

    Returns the last response: tokens on success, otherwise the error.
    """
    overrides = client.app.dependency_overrides
    firebase = overrides[get_firebase]()
    uid = firebase.find_uid(email) or firebase.add_user(email)
    response = client.post("/auth/firebase", json={"id_token": firebase.token(uid)})
    if response.status_code != 200 or "mfa" not in response.json():
        return response
    session = overrides[get_db]()
    user = session.scalar(select(User).where(User.email == email))
    secret = enrol_totp(session, user, overrides[get_settings]())
    return client.post(
        "/auth/mfa/verify",
        json={
            "mfa_token": response.json()["mfa_token"],
            "code": pyotp.TOTP(secret).now(),
        },
    )


def bearer_headers(response):
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def error_code(response):
    return response.json()["error"]["code"]


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


def test_local_password_endpoints_are_gone(auth_context):
    client, _, _, _ = auth_context
    for route in (
        "login",
        "register",
        "verify-email",
        "resend-verification",
        "forgot-password",
        "reset-password",
        "change-password",
    ):
        response = client.post(f"/auth/{route}", json={})
        assert response.status_code in (404, 405), route


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
    client, session, fake_firebase, _ = auth_context
    admin = add_user(session, role="admin", email="admin@example.com")
    agent = add_user(session, email="pending@example.com", status="pending")
    rejected = add_user(session, email="rejected@example.com", status="pending")
    admin_headers = bearer_headers(sign_in(client, "admin@example.com"))
    assert error_code(sign_in(client, "pending@example.com")) == "account_pending"
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
    assert error_code(sign_in(client, "rejected@example.com")) == "account_inactive"
    for role in ("client", "admin"):
        email = f"new-{role}@example.com"
        created = client.post(
            "/admin/users",
            json={"email": email, "role": role}
            | ({"organisation_name": "Acme Bank"} if role == "client" else {}),
            headers=admin_headers,
        )
        assert created.status_code == 201
        assert created.json()["role"] == role
        assert created.json()["email_verified_at"] is None
        user = session.scalar(select(User).where(User.email == email))
        # Created in Firebase without a password; it cannot sign in until the
        # person sets one from the email link, which also verifies the address.
        assert fake_firebase.users[user.firebase_uid]["email"] == email
        assert error_code(sign_in(client, email)) == "email_not_verified"
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
    assert error_code(sign_in(client, "pending@example.com")) == "account_inactive"
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
            json={"email": "new@example.com", "role": "admin"},
        ).status_code
        == 403
    )


def test_admin_failed_user_actions_are_audited(auth_context):
    client, session, _, _ = auth_context
    add_user(session, role="admin", email="admin@example.com")
    headers = bearer_headers(sign_in(client, "admin@example.com"))
    payload = {
        "email": "admin@example.com",
        "role": "client",
        "organisation_name": "Acme Bank",
    }
    assert client.post("/admin/users", headers=headers, json=payload).status_code == 409
    assert client.get(f"/admin/users/{uuid4()}", headers=headers).status_code == 404
    failures = session.scalars(
        select(AuditLog).where(AuditLog.outcome == "failure")
    ).all()
    assert {record.action for record in failures} == {"user_created", "user_viewed"}


def test_logout_all_ends_every_session(auth_context):
    client, session, _, _ = auth_context
    add_user(session)
    first = sign_in(client)
    second = sign_in(client)
    assert (
        client.post("/auth/logout-all", headers=bearer_headers(first)).status_code
        == 200
    )
    assert client.get("/auth/me", headers=bearer_headers(second)).status_code == 401
    assert client.post("/auth/refresh").status_code == 401


def test_secret_generation(tmp_path):
    path = tmp_path / ".env"
    path.write_text('POSTGRES_PORT=5433\nJWT_SECRET="kept"\n', encoding="utf-8")
    # An existing secret is kept; only the missing one is added.
    assert initialize_secret(path) == ["TOTP_ENCRYPTION_KEY"]
    contents = path.read_text(encoding="utf-8")
    assert 'JWT_SECRET="kept"' in contents
    assert "TOTP_ENCRYPTION_KEY=" in contents
    assert "POSTGRES_PORT=5433" in contents
    assert initialize_secret(path) == []
    assert path.read_text(encoding="utf-8") == contents
    fresh = tmp_path / "fresh.env"
    fresh.write_text("", encoding="utf-8")
    assert initialize_secret(fresh) == ["JWT_SECRET", "TOTP_ENCRYPTION_KEY"]


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


def test_expired_refresh_token(auth_context):
    client, session, _, _ = auth_context
    add_user(session)
    login = sign_in(client)
    token = session.scalar(select(RefreshToken))
    token.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    session.commit()
    assert client.post("/auth/refresh").status_code == 401
    assert client.get("/auth/me", headers=bearer_headers(login)).status_code == 401


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
    client, session, fake_firebase, _ = auth_context
    add_user(session, role="admin", email="admin@example.com")
    uid = fake_firebase.add_user("admin@example.com")
    challenge = client.post(
        "/auth/firebase", json={"id_token": fake_firebase.token(uid)}
    ).json()
    login = sign_in(client, "admin@example.com")
    raw_refresh = client.cookies.get("salesmesh_refresh")
    client.post("/auth/logout")
    records = session.scalars(select(AuditLog)).all()
    actions = {record.action for record in records}
    assert {"mfa_required", "login_success", "logout"} <= actions
    for record in records:
        stored = repr(
            {
                column.name: getattr(record, column.name)
                for column in AuditLog.__table__.columns
            }
        )
        for secret in (
            fake_firebase.token(uid),
            challenge["mfa_token"],
            raw_refresh,
            login.json()["access_token"],
        ):
            assert secret not in stored


def test_concurrent_refresh_consumes_the_token_once(test_engine):
    settings = get_settings().model_copy(update={"jwt_secret": SecretStr(new_token())})
    application = create_app(settings)
    firebase = FakeFirebase()

    def database_session():
        with Session(test_engine) as session:
            yield session

    application.dependency_overrides[get_db] = database_session
    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_firebase] = lambda: firebase
    email = f"{uuid4()}@example.com"
    user_id = None
    try:
        with Session(test_engine) as session:
            user_id = add_user(session, email=email).id
        initial = TestClient(
            application,
            base_url="https://testserver",
            headers={"Origin": settings.frontend_url},
        )
        assert sign_in(initial, email).status_code == 200
        raw = initial.cookies.get("salesmesh_refresh")
        headers = {
            "Origin": settings.frontend_url,
            "Cookie": f"salesmesh_refresh={raw}",
        }
        barrier = Barrier(2)

        def consume():
            client = TestClient(application, base_url="https://testserver")
            barrier.wait(timeout=10)
            return client.post("/auth/refresh", headers=headers).status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: consume(), range(2)))
        assert sorted(results) == [200, 401]
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
