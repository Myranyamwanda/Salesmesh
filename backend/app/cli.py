import argparse

from cryptography.fernet import Fernet
from dotenv import dotenv_values, set_key
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import ROOT_DIR, get_settings
from app.core.security import new_token
from app.db.session import get_engine
from app.demo import (
    ADMIN_EMAIL,
    DemoPlan,
    agent_email,
    client_email,
    reset_demo,
    seed_demo,
)
from app.ml.model_service import ModelService
from app.models import User
from app.services.audit import audit
from app.services.auth import other_usable_admins, revoke_sessions
from app.services.firebase import (
    FirebaseAuth,
    FirebaseUnavailable,
    firebase_from_settings,
)
from app.services.mfa import reset_mfa

SECRET_GENERATORS = {
    "JWT_SECRET": new_token,
    "TOTP_ENCRYPTION_KEY": lambda: Fernet.generate_key().decode(),
}
# Same lock as admin user management, so the "usable admin" check cannot race.
USER_ADMIN_LOCK = 71023


def initialize_secret(path=ROOT_DIR / ".env") -> list[str]:
    """Add any missing generated secrets to the ignored .env without printing them."""
    if not path.exists():
        raise ValueError("Copy .env.example to .env and configure the database first")
    existing = dotenv_values(path)
    created = []
    for name, generate in SECRET_GENERATORS.items():
        if not existing.get(name):
            set_key(str(path), name, generate(), quote_mode="always")
            created.append(name)
    get_settings.cache_clear()
    return created


def normalise_email(email: str) -> str:
    return str(TypeAdapter(EmailStr).validate_python(email)).lower()


def user_by_email(session: Session, email: str) -> User:
    user = session.scalar(
        select(User).where(User.email == normalise_email(email)).with_for_update()
    )
    if user is None:
        raise ValueError("No account uses this email")
    return user


def create_admin(session: Session, email: str, firebase: FirebaseAuth) -> str:
    """Create an administrator in SalesMesh and Firebase; return a set-password link.

    Works when other admins exist: terminal access already means server access.
    The new admin has no password until they open the link, and sets up an
    authenticator app at their first sign-in.
    """
    email = normalise_email(email)
    session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": USER_ADMIN_LOCK}
    )
    if session.scalar(select(User.id).where(User.email == email)):
        raise ValueError("An account already uses this email")
    uid = firebase.ensure_user(email)
    if session.scalar(select(User.id).where(User.firebase_uid == uid)):
        raise ValueError("This Firebase user is already linked to another account")
    user = User(email=email, firebase_uid=uid, role="admin", status="approved")
    session.add(user)
    session.flush()
    audit(session, None, "admin_created_cli", target=user)
    # Before the commit: if Firebase fails here, SalesMesh keeps nothing, and a
    # rerun reuses the Firebase user created above.
    link = firebase.password_reset_link(email)
    session.commit()
    return link


def reset_admin_mfa(session: Session, email: str) -> None:
    """Remove an admin's authenticator app; they set up a new one at next sign-in."""
    user = user_by_email(session, email)
    if user.role != "admin":
        raise ValueError("Only administrators use an authenticator app")
    reset_mfa(session, user)
    revoke_sessions(session, user)
    audit(session, None, "mfa_reset_cli", target=user)
    session.commit()


def deactivate_user(session: Session, email: str, firebase: FirebaseAuth) -> bool:
    """Deactivate a user (kept for audit history); False if already inactive.

    Refuses to leave no administrator who can sign in with Firebase and an
    authenticator app.
    """
    session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": USER_ADMIN_LOCK}
    )
    user = user_by_email(session, email)
    if not user.is_active:
        return False
    if user.role == "admin" and not other_usable_admins(session, user.id):
        raise ValueError(
            "Refused: at least one other administrator who signs in with Firebase "
            "and an authenticator app must remain"
        )
    uid = user.firebase_uid or firebase.find_uid(user.email)
    if uid is not None:
        firebase.set_disabled(uid, True)
    user.is_active = False
    revoke_sessions(session, user)
    audit(session, None, "user_activity_changed", target=user)
    session.commit()
    return True


def print_demo_logins(plan: DemoPlan) -> None:
    honest = next(
        n
        for n in range(1, plan.agents + 1)
        if n not in plan.fraudulent_agents and n not in plan.small_agents
    )
    print()
    print("Demo logins (password: DEMO_PASSWORD from your .env):")
    print(f"  Admin              {ADMIN_EMAIL}")
    print(f"  Agent (honest)     {agent_email(honest)}")
    print(f"  Agent (fraudulent) {agent_email(plan.fraudulent_agents[0])}")
    for number in range(1, plan.clients + 1):
        print(f"  Client {number}           {client_email(number)}")
    print("Open http://localhost:5173 to sign in.")


def run_seed_demo() -> None:
    settings = get_settings()
    if settings.demo_password is None:
        raise ValueError("Set DEMO_PASSWORD in .env first (see .env.example)")
    model_service = ModelService()
    state = model_service.load(settings)
    if state.status != "ok":
        raise RuntimeError(f"The model is not ready: {state.error}")
    plan = DemoPlan()
    with Session(get_engine()) as session:
        summary = seed_demo(
            session, model_service, settings.demo_password.get_secret_value(), plan=plan
        )
    if not summary.created:
        print("Demo data already exists; nothing was added.")
    else:
        print(
            f"Created {plan.agents} agents, {plan.clients} clients, and "
            f"{summary.customers} scored customers."
        )
        print(
            f"Flagged: {summary.flagged} | reviewed automatically: "
            f"{summary.reviewed['confirmed_fake']} confirmed fake, "
            f"{summary.reviewed['confirmed_real']} confirmed real | "
            f"pending review: {summary.pending}"
        )
        bands = sorted(summary.bands.items())
        print("Agent bands: " + ", ".join(f"{band} {count}" for band, count in bands))
    print_demo_logins(plan)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="SalesMesh authentication administration"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "init-secret",
        help="Generate JWT_SECRET and TOTP_ENCRYPTION_KEY in the ignored root .env "
        "without printing them",
    )
    for name, description in (
        ("create-admin", "Create an administrator in SalesMesh and Firebase"),
        ("reset-mfa", "Remove an administrator's authenticator app"),
        ("deactivate-user", "Deactivate a user (kept for audit history)"),
    ):
        command = commands.add_parser(name, help=description)
        command.add_argument("--email", required=True)
    commands.add_parser(
        "seed-demo", help="Create demo users and scored customers (safe to rerun)"
    )
    commands.add_parser("reset-demo", help="Delete only the demo data")
    args = parser.parse_args()
    try:
        if args.command == "init-secret":
            created = initialize_secret()
            print(
                f"Created in local .env: {', '.join(created)}"
                if created
                else "JWT_SECRET and TOTP_ENCRYPTION_KEY already exist; unchanged"
            )
            return
        if args.command == "seed-demo":
            run_seed_demo()
            return
        if args.command == "reset-demo":
            with Session(get_engine()) as session:
                removed = reset_demo(session)
            print(
                f"Removed {removed['users']} demo users and "
                f"{removed['customers']} demo customers."
            )
            return
        settings = get_settings()
        if args.command == "reset-mfa":
            with Session(get_engine()) as session:
                reset_admin_mfa(session, args.email)
            print("Authenticator removed; a new one is set up at the next sign-in.")
            return
        firebase = firebase_from_settings(settings)
        if args.command == "deactivate-user":
            with Session(get_engine()) as session:
                changed = deactivate_user(session, args.email, firebase)
            print("User deactivated" if changed else "User was already inactive")
            return
        with Session(get_engine()) as session:
            link = create_admin(session, args.email, firebase)
        print("Administrator created.")
        print("Open this one-time link to set the password (do not share it):")
        print(link)
        print(
            f"Then sign in at {settings.frontend_url} with that email and password; "
            "you will be asked to set up an authenticator app."
        )
    except FirebaseUnavailable:
        parser.exit(1, "Firebase could not be reached; nothing was changed\n")
    except (ValueError, ValidationError, RuntimeError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
