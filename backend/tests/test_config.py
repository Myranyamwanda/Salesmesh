import pytest
from pydantic import ValidationError

from app.core.config import Settings


def make_settings(**overrides):
    return Settings(
        _env_file=None,
        postgres_db="salesmesh_test",
        postgres_user="test_user",
        postgres_password="p@ss:/#%word",
        **overrides,
    )


def test_database_url_preserves_password():
    settings = make_settings()
    assert settings.database_url.password == "p@ss:/#%word"
    assert "p@ss" not in str(settings.database_url)
    assert "p@ss" not in repr(settings)


def test_frontend_trailing_slash_is_normalized():
    assert make_settings(frontend_url="http://localhost:5173/").frontend_url == (
        "http://localhost:5173"
    )


@pytest.mark.parametrize(
    "origin", ["*", "http://localhost/path", "https://user:secret@host", "ftp://host"]
)
def test_frontend_requires_single_origin(origin):
    with pytest.raises(ValidationError):
        make_settings(frontend_url=origin)
