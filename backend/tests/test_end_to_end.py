"""End to end through the API: register -> score -> flag -> review -> reputation.

Uses the small test model with threshold 0, so every registration is flagged
and the review step always has something to decide.
"""

from uuid import uuid4

from model_fixtures import tiny_state
from sqlalchemy import select
from test_auth import add_user, auth_context, bearer_headers, sign_in  # noqa: F401

from app.ml.model_service import ModelService
from app.models import AgentProfile
from app.services.agents import create_agent_profile
from app.services.reputation import reputation_score

FORM = {
    "full_name": "Wanjiru Kamau",
    "mobile_phone": "0712345678",
    "date_of_birth": "1995-05-17",
    "country": "KE",
    "current_address_months": 24,
    "keep_signed_in": True,
    "consent": True,
    "session_length_minutes": 4.5,
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}


def test_registration_to_reputation(auth_context):  # noqa: F811
    client, session, _, _ = auth_context
    client.app.state.model_service = ModelService(tiny_state(threshold=0.0))
    agent = add_user(session, role="agent", email="agent@example.com")
    client_user = add_user(session, role="client", email="client@example.com")
    add_user(session, role="admin", email="admin@example.com")
    profile = create_agent_profile(session, agent, "Amina Otieno")
    session.commit()
    admin = bearer_headers(sign_in(client, "admin@example.com"))
    agent_headers = bearer_headers(sign_in(client, "agent@example.com"))
    client_headers = bearer_headers(sign_in(client, "client@example.com"))
    code = profile.referral_code

    # 1. The admin assigns the agent to a client.
    response = client.patch(
        f"/admin/agents/{agent.id}",
        headers=admin,
        json={"client_id": str(client_user.id)},
    )
    assert response.status_code == 200

    # 2. Two customers register through the agent's link.
    assert client.get(f"/join/{code}").json() == {"display_name": "Amina Otieno"}
    for email in ("fake.person@gmail.com", "real.person@gmail.com"):
        response = client.post(
            f"/join/{code}/register",
            json=FORM | {"email": email, "device_id": str(uuid4())},
        )
        assert response.json() == {"message": "Registration received"}

    # 3. Both are scored and flagged, so both wait in the review queue.
    queue = client.get("/admin/review-queue", headers=admin).json()
    assert queue["total"] == 2
    assert all(
        item["agent"]["display_name"] == "Amina Otieno" for item in queue["items"]
    )
    by_email = {}
    for item in queue["items"]:
        detail = client.get(
            f"/admin/assessments/{item['assessment_id']}", headers=admin
        ).json()
        by_email[detail["customer"]["email"]] = item["assessment_id"]
    before = client.get(f"/admin/agents/{agent.id}", headers=admin).json()
    assert (before["n_users"], before["flags"]) == (2, 2)
    assert before["reputation"] == reputation_score(2, 2, 10, 0.0539)

    # The agent sees the customers, but nothing about the flags.
    mine = client.get("/me/customers", headers=agent_headers)
    assert mine.json()["total"] == 2
    for word in ("flag", "status", "pending", "probability", "reputation"):
        assert word not in mine.text.lower()

    # 4. The admin confirms one as fake and the other as real.
    fake_id = by_email["fake.person@gmail.com"]
    real_id = by_email["real.person@gmail.com"]
    for assessment_id, decision in (
        (fake_id, "confirmed_fake"),
        (real_id, "confirmed_real"),
    ):
        response = client.post(
            f"/admin/assessments/{assessment_id}/review",
            headers=admin,
            json={"decision": decision, "notes": "Checked by phone"},
        )
        assert response.status_code == 201

    # 5. The queue is empty, and the statuses follow the decisions.
    assert client.get("/admin/review-queue", headers=admin).json()["total"] == 0
    fake = client.get(f"/admin/assessments/{fake_id}", headers=admin).json()
    real = client.get(f"/admin/assessments/{real_id}", headers=admin).json()
    assert fake["customer"]["status"] == "rejected"
    assert real["customer"]["status"] == "verified"

    # 6. The reputation now counts only the confirmed fake.
    after = client.get(f"/admin/agents/{agent.id}", headers=admin).json()
    assert (after["flags"], after["confirmed_fake"], after["pending_review"]) == (
        1,
        1,
        0,
    )
    assert after["reputation"] == reputation_score(2, 1, 10, 0.0539)
    assert after["reputation"] > before["reputation"]

    # 7. The client sees the quality of their agent's registrations.
    quality = client.get("/client/quality", headers=client_headers).json()
    assert (
        quality["registrations"],
        quality["flagged"],
        quality["confirmed_fake"],
    ) == (
        2,
        2,
        1,
    )
    assert quality["pending_review"] == 0
    assert session.scalar(select(AgentProfile.client_id)) == client_user.id
