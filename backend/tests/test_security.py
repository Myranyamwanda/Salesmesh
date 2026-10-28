from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from pydantic import SecretStr

from app.core.config import get_settings
from app.core.security import (
    access_token,
    decode_access_token,
    new_token,
    token_hash,
    validate_password,
)


@pytest.mark.parametrize(
    "password",
    ["short", "lowercase123!", "UPPERCASE123!", "NoDigitsHere!!", "NoSymbolsHere123"],
)
def test_password_policy(password):
    with pytest.raises(ValueError):
        validate_password(password)


def test_password_policy_accepts_a_strong_password():
    assert validate_password("Correct-Passphrase123!") == "Correct-Passphrase123!"


def test_tokens_are_random_and_stored_as_hashes():
    first, second = new_token(), new_token()
    assert first != second
    assert len(token_hash(first)) == 64
    assert first not in token_hash(first)


def test_jwt_claims_expiry_and_signature():
    settings = get_settings().model_copy(update={"jwt_secret": SecretStr(new_token())})
    user = SimpleNamespace(id=uuid4(), role="agent", token_version=0)
    encoded = access_token(user, uuid4(), settings)
    payload = decode_access_token(encoded, settings)
    assert payload["sub"] == str(user.id)
    assert payload["role"] == "agent"
    payload["exp"] = datetime.now(UTC) - timedelta(seconds=1)
    expired = jwt.encode(payload, settings.signing_key(), algorithm="HS256")
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_access_token(expired, settings)
    with pytest.raises(jwt.InvalidTokenError):
        decode_access_token(
            encoded, settings.model_copy(update={"jwt_secret": SecretStr(new_token())})
        )
