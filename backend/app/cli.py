import argparse
from datetime import UTC, datetime
from getpass import getpass
from uuid import uuid4

from dotenv import dotenv_values, set_key
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import ROOT_DIR, get_settings
from app.core.security import hash_password, new_token, validate_password
from app.db.session import get_engine
from app.models import AuditLog, User


def initialize_secret(path=ROOT_DIR / ".env") -> bool:
    if not path.exists():
        raise ValueError("Copy .env.example to .env and configure the database first")
    if dotenv_values(path).get("JWT_SECRET"):
        return False
    set_key(str(path), "JWT_SECRET", new_token(), quote_mode="always")
    get_settings.cache_clear()
    return True


def create_first_admin(session: Session, email: str, password: str) -> User:
    email = str(TypeAdapter(EmailStr).validate_python(email)).lower()
    hashed = hash_password(password)
    session.execute(text("SELECT pg_advisory_xact_lock(71023)"))
    if session.scalar(select(User.id).where(User.role == "admin").limit(1)):
        raise ValueError(
            "An administrator already exists; use authenticated user management"
        )
    if session.scalar(select(User.id).where(User.email == email)):
        raise ValueError("An account already uses this email")
    user = User(
        email=email,
        password_hash=hashed,
        role="admin",
        status="approved",
        email_verified_at=datetime.now(UTC),
    )
    session.add(user)
    session.flush()
    session.add(
        AuditLog(
            actor_user_id=user.id,
            target_user_id=user.id,
            action="first_admin_created",
            outcome="success",
            request_id=str(uuid4()),
        )
    )
    session.commit()
    return user


def main() -> None:
    parser = argparse.ArgumentParser(
        description="SalesMesh authentication administration"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "init-secret",
        help="Generate JWT_SECRET in the ignored root .env without printing it",
    )
    create = commands.add_parser(
        "create-admin", help="Create the first verified administrator"
    )
    create.add_argument("--email", required=True)
    args = parser.parse_args()
    try:
        if args.command == "init-secret":
            changed = initialize_secret()
            print(
                "JWT_SECRET created in local .env"
                if changed
                else "JWT_SECRET already exists; unchanged"
            )
            return
        get_settings().signing_key()
        password = getpass("Password (hidden): ")
        validate_password(password)
        if getpass("Confirm password (hidden): ") != password:
            raise ValueError("Passwords do not match")
        with Session(get_engine()) as session:
            create_first_admin(session, args.email, password)
        print("First administrator created")
    except (ValueError, ValidationError, RuntimeError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    main()
