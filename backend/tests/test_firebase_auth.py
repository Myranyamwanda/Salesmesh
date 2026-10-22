"""POST /auth/firebase, agent self-registration, and Firebase user management.

Firebase is replaced by FakeFirebase (conftest.py): no network, no real accounts.
"""

from datetime import UTC, datetime

import pyotp
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from test_auth import add_user, auth_context, bearer_headers  # noqa: F401

from app.core.config import get_settings
from app.core.security import new_token
from app.db.session import get_db
from app.main import create_app
from app.models import AgentProfile, AuditLog, RefreshToken, User
from app.services.mfa import encrypt_secret


def firebase_sign_in(client, fake_firebase, uid):
    return client.post("/auth/firebase", json={"id_token": fake_firebase.token(uid)})


def error_code(response):
    return response.json()["error"]["code"]


def audit_actions(session, outcome):
    return [
        record.action
        for record in session.scalars(
            select(AuditLog)
            .where(AuditLog.outcome == outcome)
            .order_by(AuditLog.created_at)
        )
    ]


def test_valid_token_issues_the_existing_salesmesh_tokens(
    auth_context,  # noqa: F811
    fake_firebase,
):
    client, session, _, _ = auth_context
    user = add_user(session, role="client", email="client@example.com")
    uid = fake_firebase.add_user("client@example.com")
    response = firebase_sign_in(client, fake_firebase, uid)
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert "HttpOnly" in response.headers["set-cookie"]
    me = client.get("/auth/me", headers=bearer_headers(response))
    assert me.json()["email"] == "client@example.com"
    # The usual refresh rotation keeps working for a Firebase login.
    assert client.post("/auth/refresh").status_code == 200
    session.refresh(user)
    assert user.firebase_uid == uid
    assert session.scalar(select(RefreshToken.id)) is not None
    assert audit_actions(session, "success")[-2:] == [
        "login_success",
        "session_refreshed",
    ]


def test_unverified_email_is_rejected(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    add_user(session, email="agent@example.com")
    uid = fake_firebase.add_user("agent@example.com", verified=False)
    response = firebase_sign_in(client, fake_firebase, uid)
    assert response.status_code == 403
    assert error_code(response) == "email_not_verified"
    assert audit_actions(session, "failure") == ["login_failure"]
    # An unverified email never links the account.
    assert session.scalar(select(User.firebase_uid)) is None


@pytest.mark.parametrize("token", ["token-unknown", "not-a-token", "revoked"])
def test_invalid_and_revoked_tokens_are_401(
    auth_context,  # noqa: F811
    fake_firebase,
    token,
):
    client, session, _, _ = auth_context
    add_user(session, email="agent@example.com")
    uid = fake_firebase.add_user("agent@example.com")
    if token == "revoked":
        token = fake_firebase.token(uid)
        fake_firebase.revoked_tokens.add(token)
    response = client.post("/auth/firebase", json={"id_token": token})
    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert audit_actions(session, "failure") == ["login_failure"]


def test_unknown_user_gets_account_not_found(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    uid = fake_firebase.add_user("stranger@example.com")
    response = firebase_sign_in(client, fake_firebase, uid)
    assert response.status_code == 404
    assert error_code(response) == "account_not_found"
    assert session.scalar(select(User.id)) is None


def test_links_by_email_then_by_uid(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    user = add_user(session, email="agent@example.com", verified=False)
    uid = fake_firebase.add_user("agent@example.com")
    assert firebase_sign_in(client, fake_firebase, uid).status_code == 200
    session.refresh(user)
    assert user.firebase_uid == uid
    assert user.email_verified_at is not None
    # Once linked, the uid finds the account even if the Firebase email changes.
    fake_firebase.users[uid]["email"] = "renamed@example.com"
    assert firebase_sign_in(client, fake_firebase, uid).status_code == 200


def test_account_linked_to_another_firebase_user_is_refused(
    auth_context,  # noqa: F811
    fake_firebase,
):
    client, session, _, _ = auth_context
    user = add_user(session, email="agent@example.com")
    user.firebase_uid = "original-uid"
    session.commit()
    uid = fake_firebase.add_user("agent@example.com")
    response = firebase_sign_in(client, fake_firebase, uid)
    assert response.status_code == 409
    assert error_code(response) == "account_link_conflict"


def test_pending_agent_gets_awaiting_approval(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    add_user(session, email="agent@example.com", status="pending")
    uid = fake_firebase.add_user("agent@example.com")
    response = firebase_sign_in(client, fake_firebase, uid)
    assert response.status_code == 403
    assert error_code(response) == "account_pending"
    assert "awaiting administrator approval" in response.json()["error"]["message"]
    assert session.scalar(select(RefreshToken.id)) is None


@pytest.mark.parametrize("state", ["inactive", "rejected", "firebase_disabled"])
def test_suspended_users_cannot_sign_in(
    auth_context,  # noqa: F811
    fake_firebase,
    state,
):
    client, session, _, _ = auth_context
    user = add_user(
        session,
        email="agent@example.com",
        status="rejected" if state == "rejected" else "approved",
    )
    user.is_active = state != "inactive"
    session.commit()
    uid = fake_firebase.add_user(
        "agent@example.com", disabled=state == "firebase_disabled"
    )
    response = firebase_sign_in(client, fake_firebase, uid)
    assert response.status_code == 403
    assert error_code(response) == "account_inactive"
    assert session.scalar(select(RefreshToken.id)) is None


@pytest.mark.parametrize("role", ["agent", "client"])
def test_rbac_is_unchanged_for_firebase_logins(
    auth_context,  # noqa: F811
    fake_firebase,
    role,
):
    client, session, _, _ = auth_context
    add_user(session, role=role, email="user@example.com")
    uid = fake_firebase.add_user("user@example.com")
    headers = bearer_headers(firebase_sign_in(client, fake_firebase, uid))
    assert client.get("/auth/me", headers=headers).json()["role"] == role
    assert client.get("/admin/users", headers=headers).status_code == 403
    assert client.get("/admin/audit-logs", headers=headers).status_code == 403


def test_admin_firebase_login_needs_mfa_then_reaches_admin_endpoints(
    auth_context,  # noqa: F811
    fake_firebase,
):
    client, session, _, _ = auth_context
    add_user(session, role="admin", email="admin@example.com")
    uid = fake_firebase.add_user("admin@example.com")
    response = firebase_sign_in(client, fake_firebase, uid)
    # No SalesMesh tokens and no refresh cookie before the second factor.
    assert response.json()["mfa"] == "setup"
    assert "access_token" not in response.json()
    assert "set-cookie" not in response.headers
    assert (
        client.get(
            "/admin/users",
            headers=admin_headers(client, session, fake_firebase, create=False),
        ).status_code
        == 200
    )


def test_firebase_login_is_rate_limited_per_ip(auth_context, fake_firebase):  # noqa: F811
    client, session, _, settings = auth_context
    settings.login_rate_limit = 2
    for _ in range(2):
        response = client.post("/auth/firebase", json={"id_token": "token-nobody"})
        assert response.status_code == 401
    response = client.post("/auth/firebase", json={"id_token": "token-nobody"})
    assert response.status_code == 429
    records = session.scalars(select(AuditLog)).all()
    assert len(records) == 2
    assert all(len(record.client_ip_hash) == 64 for record in records)


def test_firebase_outage_is_503_and_not_audited(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    uid = fake_firebase.add_user("agent@example.com")
    fake_firebase.available = False
    response = firebase_sign_in(client, fake_firebase, uid)
    assert response.status_code == 503
    assert session.scalar(select(AuditLog.id)) is None


def test_not_configured_firebase_is_503(db_session):
    settings = get_settings().model_copy(
        update={
            "jwt_secret": SecretStr(new_token()),
            "firebase_project_id": None,
            "firebase_credentials_path": None,
        }
    )
    application = create_app(settings)
    application.dependency_overrides[get_db] = lambda: db_session
    application.dependency_overrides[get_settings] = lambda: settings
    client = TestClient(application, base_url="https://testserver")
    response = client.post("/auth/firebase", json={"id_token": "token-x"})
    assert response.status_code == 503
    assert response.json()["error"]["message"] == "Sign-in is not configured"


def test_agent_self_registration(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    uid = fake_firebase.add_user("New.Agent@Example.com".lower())
    response = client.post(
        "/auth/firebase/register",
        # A role in the request is ignored: only agents self-register.
        json={
            "id_token": fake_firebase.token(uid),
            "display_name": "  Amina  ",
            "role": "admin",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert (body["role"], body["status"]) == ("agent", "pending")
    user = session.scalar(select(User))
    assert user.firebase_uid == uid
    assert session.get(AgentProfile, user.id).display_name == "Amina"
    assert audit_actions(session, "success") == ["agent_registered"]
    # Signing in now gives the awaiting-approval response.
    signed_in = firebase_sign_in(client, fake_firebase, uid)
    assert error_code(signed_in) == "account_pending"
    again = client.post(
        "/auth/firebase/register",
        json={"id_token": fake_firebase.token(uid), "display_name": "Amina"},
    )
    assert again.status_code == 409
    assert error_code(again) == "account_exists"


def test_registration_requires_verified_email_and_display_name(
    auth_context,  # noqa: F811
    fake_firebase,
):
    client, session, _, _ = auth_context
    unverified = fake_firebase.add_user("agent@example.com", verified=False)
    response = client.post(
        "/auth/firebase/register",
        json={"id_token": fake_firebase.token(unverified), "display_name": "Amina"},
    )
    assert error_code(response) == "email_not_verified"
    verified = fake_firebase.add_user("other@example.com")
    response = client.post(
        "/auth/firebase/register",
        json={"id_token": fake_firebase.token(verified), "display_name": " "},
    )
    assert response.status_code == 422
    assert session.scalar(select(User.id)) is None


def test_registration_refuses_an_existing_email(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    add_user(session, role="client", email="client@example.com")
    uid = fake_firebase.add_user("client@example.com")
    response = client.post(
        "/auth/firebase/register",
        json={"id_token": fake_firebase.token(uid), "display_name": "Amina"},
    )
    assert response.status_code == 409
    assert session.scalar(select(User.role)) == "client"


def app_settings(client):
    return client.app.dependency_overrides[get_settings]()


def enrol_totp(session, user, settings) -> str:
    """Give an admin a working authenticator directly; return its secret."""
    secret = pyotp.random_base32()
    user.totp_secret_encrypted = encrypt_secret(secret, settings)
    user.totp_enabled_at = datetime.now(UTC)
    session.commit()
    return secret


def admin_headers(
    client, session, fake_firebase, email="admin@example.com", create=True
):
    """Sign an admin in through Firebase and TOTP; return bearer headers."""
    if create:
        add_user(session, role="admin", email=email)
    user = session.scalar(select(User).where(User.email == email))
    uid = (
        user.firebase_uid
        or fake_firebase.find_uid(email)
        or fake_firebase.add_user(email)
    )
    secret = enrol_totp(session, user, app_settings(client))
    challenge = firebase_sign_in(client, fake_firebase, uid).json()
    response = client.post(
        "/auth/mfa/verify",
        json={"mfa_token": challenge["mfa_token"], "code": pyotp.TOTP(secret).now()},
    )
    assert response.status_code == 200, response.text
    return bearer_headers(response)


def test_admin_creates_users_in_firebase(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    headers = admin_headers(client, session, fake_firebase)
    # An existing Firebase user with the same email is reused, not duplicated.
    existing = fake_firebase.add_user("client@example.com")
    response = client.post(
        "/admin/users",
        json={"email": "Client@Example.com", "role": "client"},
        headers=headers,
    )
    assert response.status_code == 201
    user = session.scalar(select(User).where(User.email == "client@example.com"))
    assert user.firebase_uid == existing
    assert len(fake_firebase.users) == 2


def test_firebase_outage_creates_nothing(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    headers = admin_headers(client, session, fake_firebase)
    fake_firebase.available = False
    response = client.post(
        "/admin/users",
        json={"email": "new@example.com", "role": "client"},
        headers=headers,
    )
    assert response.status_code == 503
    assert session.scalar(select(User).where(User.email == "new@example.com")) is None
    assert audit_actions(session, "failure") == ["user_created"]


def test_deactivation_disables_firebase_user(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    headers = admin_headers(client, session, fake_firebase)
    agent = add_user(session, email="agent@example.com")
    uid = fake_firebase.add_user("agent@example.com")
    agent_headers = bearer_headers(firebase_sign_in(client, fake_firebase, uid))
    response = client.patch(
        f"/admin/users/{agent.id}/active", json={"is_active": False}, headers=headers
    )
    assert response.status_code == 200
    assert fake_firebase.users[uid]["disabled"] is True
    assert fake_firebase.revoked_uids == [uid]
    # SalesMesh sessions end as before.
    assert client.get("/auth/me", headers=agent_headers).status_code == 401
    response = client.patch(
        f"/admin/users/{agent.id}/active", json={"is_active": True}, headers=headers
    )
    assert response.status_code == 200
    assert fake_firebase.users[uid]["disabled"] is False
    assert firebase_sign_in(client, fake_firebase, uid).status_code == 200


def test_deactivation_finds_unlinked_firebase_user_by_email(
    auth_context,  # noqa: F811
    fake_firebase,
):
    client, session, _, _ = auth_context
    headers = admin_headers(client, session, fake_firebase)
    agent = add_user(session, email="agent@example.com")
    uid = fake_firebase.add_user("agent@example.com")
    client.patch(
        f"/admin/users/{agent.id}/active", json={"is_active": False}, headers=headers
    )
    assert fake_firebase.users[uid]["disabled"] is True
    # A user with no Firebase account at all is simply deactivated in SalesMesh.
    other = add_user(session, email="no-firebase@example.com")
    response = client.patch(
        f"/admin/users/{other.id}/active", json={"is_active": False}, headers=headers
    )
    assert response.status_code == 200


def test_firebase_outage_leaves_activity_unchanged(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    headers = admin_headers(client, session, fake_firebase)
    agent = add_user(session, email="agent@example.com")
    fake_firebase.add_user("agent@example.com")
    fake_firebase.available = False
    response = client.patch(
        f"/admin/users/{agent.id}/active", json={"is_active": False}, headers=headers
    )
    assert response.status_code == 503
    session.refresh(agent)
    assert agent.is_active is True
    assert audit_actions(session, "failure") == ["user_activity_changed"]
