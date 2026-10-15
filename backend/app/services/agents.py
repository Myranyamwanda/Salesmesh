"""Agent profiles and their referral codes."""

import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentProfile, User
from app.models.agent import REFERRAL_ALPHABET, REFERRAL_LENGTH, REFERRAL_PREFIX

# Used when a user becomes an agent without choosing a name (role change).
PLACEHOLDER_DISPLAY_NAME = "SalesMesh agent"


def new_referral_code() -> str:
    """Return a random code such as AGT-7K3Q9XMD.

    secrets (not random) makes codes unpredictable. 31 symbols and 8 positions
    give about 8.5 * 10^11 codes, too many to find valid ones by guessing.
    """
    symbols = (secrets.choice(REFERRAL_ALPHABET) for _ in range(REFERRAL_LENGTH))
    return REFERRAL_PREFIX + "".join(symbols)


def create_agent_profile(
    session: Session, user: User, display_name: str = PLACEHOLDER_DISPLAY_NAME
) -> AgentProfile:
    """Add a profile for a flushed agent user. The caller commits."""
    # A collision is very unlikely; the unique constraint is the final guard.
    for _ in range(5):
        code = new_referral_code()
        taken = session.scalar(
            select(AgentProfile.user_id).where(AgentProfile.referral_code == code)
        )
        if taken is None:
            break
    else:
        raise RuntimeError("Could not generate a unique referral code")
    profile = AgentProfile(
        user_id=user.id, referral_code=code, display_name=display_name.strip()
    )
    session.add(profile)
    return profile
