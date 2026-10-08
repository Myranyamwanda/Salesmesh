from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    postgres_host: str = "127.0.0.1"
    postgres_port: int = Field(default=5432, ge=1, le=65535)
    postgres_db: str
    postgres_user: str
    postgres_password: SecretStr
    frontend_url: str = "http://localhost:5173"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    db_connect_timeout: int = Field(default=5, ge=1, le=60)
    test_postgres_db: str = "salesmesh_test"
    jwt_secret: SecretStr | None = None
    jwt_issuer: str = "salesmesh"
    jwt_audience: str = "salesmesh-api"
    access_token_minutes: int = Field(default=15, ge=1, le=60)
    refresh_token_days: int = Field(default=30, ge=1, le=90)
    verification_token_hours: int = Field(default=24, ge=1, le=48)
    reset_token_minutes: int = Field(default=30, ge=1, le=60)
    login_rate_limit: int = Field(default=20, ge=1)
    login_rate_window_seconds: int = Field(default=60, ge=1)
    login_failure_limit: int = Field(default=5, ge=1)
    account_lockout_minutes: int = Field(default=15, ge=1)

    @field_validator("jwt_secret")
    @classmethod
    def validate_jwt_secret(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and (
            len(value.get_secret_value()) < 32
            or value.get_secret_value().startswith("replace_")
        ):
            raise ValueError(
                "JWT_SECRET must be a generated secret of at least 32 characters"
            )
        return value

    def signing_key(self) -> str:
        if self.jwt_secret is None:
            raise RuntimeError("Configure JWT_SECRET using the init-secret command")
        return self.jwt_secret.get_secret_value()

    @field_validator("frontend_url")
    @classmethod
    def validate_frontend_origin(cls, value: str) -> str:
        from urllib.parse import urlsplit

        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("FRONTEND_URL must be one HTTP(S) origin")
        return value.rstrip("/")

    @property
    def database_url(self) -> URL:
        return URL.create(
            "postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_password.get_secret_value(),
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
