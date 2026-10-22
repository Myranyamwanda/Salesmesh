"""Admin TOTP after Firebase sign-in, recovery codes, and the admin CLI commands."""

from datetime import UTC, datetime, timedelta

import jwt
import pyotp
import pytest
from pydantic import SecretStr
from sqlalchemy import select
from test_auth import add_user, auth_context, bearer_headers  # noqa: F401
from test_firebase_auth import (
    admin_headers,
    app_settings,
    audit_actions,
    enrol_totp,
    error_code,
    firebase_sign_in,
)

from app.cli import create_admin, deactivate_user, reset_admin_mfa
from app.models import MfaRecoveryCode, User
from app.services.auth import revoke_sessions
from app.services.firebase import FirebaseUnavailable
from app.services.mfa import decrypt_secret, mfa_audience


def start_admin_login(client, session, fake_firebase, email="admin@example.com"):
    """Create an admin and pass the Firebase step; return (user, MFA challenge)."""
    user = add_user(session, role="admin", email=email)
    uid = fake_firebase.add_user(email)
    response = firebase_sign_in(client, fake_firebase, uid)
    assert response.status_code == 200
    return user, response.json()


def submit(client, path, challenge, code):
    return client.post(path, json={"mfa_token": challenge["mfa_token"], "code": code})


def test_admin_must_set_up_totp_at_first_sign_in(auth_context, fake_firebase):  # noqa: F811
    client, session, _, settings = auth_context
    user, challenge = start_admin_login(client, session, fake_firebase)
    assert challenge["mfa"] == "setup"
    assert challenge["expires_in"] == 300
    setup = client.post("/auth/mfa/setup", json={"mfa_token": challenge["mfa_token"]})
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    uri = setup.json()["otpauth_uri"]
    assert uri.startswith("otpauth://totp/SalesMesh:admin%40example.com?")
    assert f"secret={secret}" in uri and "issuer=SalesMesh" in uri
    session.refresh(user)
    # Stored encrypted, never as the plain secret.
    assert secret not in user.totp_secret_encrypted
    assert decrypt_secret(user.totp_secret_encrypted, settings) == secret
    assert user.totp_enabled_at is None

    wrong = submit(client, "/auth/mfa/setup/confirm", challenge, "000000")
    assert wrong.status_code == 401
    assert error_code(wrong) == "mfa_invalid_code"
    confirmed = submit(
        client, "/auth/mfa/setup/confirm", challenge, pyotp.TOTP(secret).now()
    )
    assert confirmed.status_code == 200
    body = confirmed.json()
    assert len(body["recovery_codes"]) == 10
    assert (
        client.get("/admin/users", headers=bearer_headers(confirmed)).status_code == 200
    )
    session.refresh(user)
    assert user.totp_enabled_at is not None
    hashes = session.scalars(select(MfaRecoveryCode.code_hash)).all()
    assert len(hashes) == 10
    assert not set(body["recovery_codes"]) & set(hashes)
    assert {"mfa_required", "mfa_setup_started", "mfa_enabled", "login_success"} <= set(
        audit_actions(session, "success")
    )
    assert audit_actions(session, "failure") == ["mfa_failure"]

    # The next sign-in asks for a code, and setup cannot be restarted.
    challenge = firebase_sign_in(client, fake_firebase, user.firebase_uid).json()
    assert challenge["mfa"] == "verify"
    again = client.post("/auth/mfa/setup", json={"mfa_token": challenge["mfa_token"]})
    assert again.status_code == 409
    assert error_code(again) == "mfa_already_enabled"


def test_verify_rejects_wrong_and_reused_codes(auth_context, fake_firebase):  # noqa: F811
    client, session, _, settings = auth_context
    user, _ = start_admin_login(client, session, fake_firebase)
    secret = enrol_totp(session, user, settings)
    challenge = firebase_sign_in(client, fake_firebase, user.firebase_uid).json()
    assert submit(client, "/auth/mfa/verify", challenge, "123456").status_code == 401
    assert submit(client, "/auth/mfa/verify", challenge, "12345x").status_code == 401
    code = pyotp.TOTP(secret).now()
    response = submit(client, "/auth/mfa/verify", challenge, code)
    assert response.status_code == 200
    assert "HttpOnly" in response.headers["set-cookie"]
    # The same code cannot be used again, even within its 30 seconds.
    challenge = firebase_sign_in(client, fake_firebase, user.firebase_uid).json()
    replay = submit(client, "/auth/mfa/verify", challenge, code)
    assert replay.status_code == 401
    session.refresh(user)
    assert user.failed_login_attempts == 1  # Reset by the success, then 1 replay.


def test_recovery_code_works_only_once(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    _, challenge = start_admin_login(client, session, fake_firebase)
    secret = client.post(
        "/auth/mfa/setup", json={"mfa_token": challenge["mfa_token"]}
    ).json()["secret"]
    codes = submit(
        client, "/auth/mfa/setup/confirm", challenge, pyotp.TOTP(secret).now()
    ).json()["recovery_codes"]
    uid = fake_firebase.find_uid("admin@example.com")
    challenge = firebase_sign_in(client, fake_firebase, uid).json()
    # Case and dashes do not matter when typing a recovery code.
    typed = codes[0].lower().replace("-", " ")
    assert submit(client, "/auth/mfa/verify", challenge, typed).status_code == 200
    assert "mfa_recovery_code_used" in audit_actions(session, "success")
    challenge = firebase_sign_in(client, fake_firebase, uid).json()
    reused = submit(client, "/auth/mfa/verify", challenge, codes[0])
    assert reused.status_code == 401
    assert submit(client, "/auth/mfa/verify", challenge, codes[1]).status_code == 200
    used = session.scalars(
        select(MfaRecoveryCode).where(MfaRecoveryCode.used_at.is_not(None))
    ).all()
    assert len(used) == 2


def test_wrong_codes_lock_the_account(auth_context, fake_firebase):  # noqa: F811
    client, session, _, settings = auth_context
    user, _ = start_admin_login(client, session, fake_firebase)
    secret = enrol_totp(session, user, settings)
    challenge = firebase_sign_in(client, fake_firebase, user.firebase_uid).json()
    for _ in range(settings.login_failure_limit):
        assert (
            submit(client, "/auth/mfa/verify", challenge, "000000").status_code == 401
        )
    locked = submit(client, "/auth/mfa/verify", challenge, pyotp.TOTP(secret).now())
    assert locked.status_code == 429
    assert error_code(locked) == "mfa_locked"
    assert int(locked.headers["Retry-After"]) > 0
    # After the lockout period a correct code works again.
    user.locked_until = datetime.now(UTC) - timedelta(seconds=1)
    session.commit()
    response = submit(client, "/auth/mfa/verify", challenge, pyotp.TOTP(secret).now())
    assert response.status_code == 200


def test_mfa_token_is_not_an_access_token(auth_context, fake_firebase):  # noqa: F811
    client, session, _, settings = auth_context
    user, challenge = start_admin_login(client, session, fake_firebase)
    secret = enrol_totp(session, user, settings)
    as_access = {"Authorization": f"Bearer {challenge['mfa_token']}"}
    assert client.get("/auth/me", headers=as_access).status_code == 401
    headers = admin_headers(client, session, fake_firebase, create=False)
    access = headers["Authorization"].removeprefix("Bearer ")
    challenge_with_access = {"mfa_token": access}
    response = submit(client, "/auth/mfa/verify", challenge_with_access, "000000")
    assert error_code(response) == "mfa_session_expired"
    expired = jwt.encode(
        {
            "sub": str(user.id),
            "ver": user.token_version,
            "iat": datetime.now(UTC) - timedelta(minutes=10),
            "exp": datetime.now(UTC) - timedelta(minutes=5),
            "iss": settings.jwt_issuer,
            "aud": mfa_audience(settings),
        },
        settings.signing_key(),
        algorithm="HS256",
    )
    response = submit(
        client, "/auth/mfa/verify", {"mfa_token": expired}, pyotp.TOTP(secret).now()
    )
    assert error_code(response) == "mfa_session_expired"


def test_deactivation_between_steps_cancels_the_mfa_token(
    auth_context,  # noqa: F811
    fake_firebase,
):
    client, session, _, settings = auth_context
    user, _ = start_admin_login(client, session, fake_firebase)
    secret = enrol_totp(session, user, settings)
    challenge = firebase_sign_in(client, fake_firebase, user.firebase_uid).json()
    revoke_sessions(session, user)  # What deactivation and role changes do.
    session.commit()
    response = submit(client, "/auth/mfa/verify", challenge, pyotp.TOTP(secret).now())
    assert response.status_code == 401


def test_agents_and_clients_need_no_totp(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    for role in ("agent", "client"):
        email = f"{role}@example.com"
        add_user(session, role=role, email=email)
        uid = fake_firebase.add_user(email)
        response = firebase_sign_in(client, fake_firebase, uid)
        assert "access_token" in response.json()
        assert "mfa" not in response.json()


def test_missing_encryption_key_is_a_clear_503(auth_context, fake_firebase):  # noqa: F811
    client, session, _, settings = auth_context
    settings.totp_encryption_key = None
    add_user(session, role="admin", email="admin@example.com")
    uid = fake_firebase.add_user("admin@example.com")
    response = firebase_sign_in(client, fake_firebase, uid)
    assert response.status_code == 503
    assert error_code(response) == "mfa_not_configured"


def test_invalid_encryption_key_is_refused(auth_context):  # noqa: F811
    _, _, _, settings = auth_context
    with pytest.raises(ValueError, match="init-secret"):
        type(settings)(totp_encryption_key=SecretStr("not-a-fernet-key"))


def test_cannot_deactivate_the_last_usable_admin(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    headers = admin_headers(client, session, fake_firebase)
    # The old admin: an undeliverable email, so it can never sign in through
    # Firebase, and it does not count as an admin who keeps the system usable.
    old = add_user(session, role="admin", email="old-admin@example.com")
    # A second admin signs in, then loses the authenticator mid-session (as if
    # reset in the database): no longer usable, so it may not remove the
    # last usable admin, by deactivation or by demotion.
    acting_headers = admin_headers(
        client, session, fake_firebase, email="acting@example.com"
    )
    acting = session.scalar(select(User).where(User.email == "acting@example.com"))
    acting.totp_enabled_at = None
    session.commit()
    new = session.scalar(select(User).where(User.email == "admin@example.com"))
    for change in ("active", "role"):
        payload = {"is_active": False} if change == "active" else {"role": "client"}
        response = client.patch(
            f"/admin/users/{new.id}/{change}", json=payload, headers=acting_headers
        )
        assert response.status_code == 409
        assert "must remain" in response.json()["error"]["message"]
    session.refresh(new)
    assert (new.is_active, new.role) == (True, "admin")
    # The usable admin may deactivate the old one: a usable admin remains.
    response = client.patch(
        f"/admin/users/{old.id}/active", json={"is_active": False}, headers=headers
    )
    assert response.status_code == 200
    # With a second usable admin, either may be demoted.
    admin_headers(client, session, fake_firebase, email="second@example.com")
    second = session.scalar(select(User).where(User.email == "second@example.com"))
    response = client.patch(
        f"/admin/users/{second.id}/role", json={"role": "client"}, headers=headers
    )
    assert response.status_code == 200


def test_cli_create_admin_alongside_existing_admins(db_session, fake_firebase):
    add_user(db_session, role="admin", email="old-admin@example.com")
    link = create_admin(db_session, "Name+Admin@Gmail.com", fake_firebase)
    user = db_session.scalar(select(User).where(User.email == "name+admin@gmail.com"))
    assert (user.role, user.status, user.is_active) == ("admin", "approved", True)
    assert user.email_verified_at is None
    assert fake_firebase.users[user.firebase_uid]["email"] == "name+admin@gmail.com"
    assert link == "https://firebase.test/reset?email=name+admin@gmail.com"
    assert audit_actions(db_session, "success") == ["admin_created_cli"]
    with pytest.raises(ValueError, match="already uses"):
        create_admin(db_session, "name+admin@gmail.com", fake_firebase)


def test_cli_create_admin_keeps_nothing_when_firebase_fails(db_session, fake_firebase):
    fake_firebase.available = False
    with pytest.raises(FirebaseUnavailable):
        create_admin(db_session, "admin@example.com", fake_firebase)
    db_session.rollback()
    assert db_session.scalar(select(User.id)) is None


def test_cli_deactivate_user_protects_the_last_usable_admin(
    auth_context,  # noqa: F811
    fake_firebase,
):
    client, session, _, _ = auth_context
    admin_headers(client, session, fake_firebase)
    old = add_user(session, role="admin", email="old-admin@example.com")
    old_uid = fake_firebase.add_user("old-admin@example.com", verified=False)
    with pytest.raises(ValueError, match="must remain"):
        deactivate_user(session, "admin@example.com", fake_firebase)
    assert deactivate_user(session, "OLD-ADMIN@example.com", fake_firebase) is True
    session.refresh(old)
    assert old.is_active is False
    # Found by email even though it was never linked, and disabled in Firebase.
    assert fake_firebase.users[old_uid]["disabled"] is True
    assert deactivate_user(session, "old-admin@example.com", fake_firebase) is False
    with pytest.raises(ValueError, match="No account"):
        deactivate_user(session, "nobody@example.com", fake_firebase)


def test_cli_reset_mfa(auth_context, fake_firebase):  # noqa: F811
    client, session, _, _ = auth_context
    headers = admin_headers(client, session, fake_firebase)
    reset_admin_mfa(session, "admin@example.com")
    user = session.scalar(select(User).where(User.email == "admin@example.com"))
    assert user.totp_secret_encrypted is None and user.totp_enabled_at is None
    assert session.scalar(select(MfaRecoveryCode.id)) is None
    # Existing sessions end, and the next sign-in asks for a new authenticator.
    assert client.get("/auth/me", headers=headers).status_code == 401
    challenge = firebase_sign_in(client, fake_firebase, user.firebase_uid).json()
    assert challenge["mfa"] == "setup"
    add_user(session, role="agent", email="agent@example.com")
    with pytest.raises(ValueError, match="Only administrators"):
        reset_admin_mfa(session, "agent@example.com")
    assert app_settings(client).totp_encryption_key is not None
