import pytest
from model_fixtures import tiny_state
from sqlalchemy.exc import IntegrityError
from test_domain_tables import make_customer, make_user

from app.ml.features import FEATURE_NAMES, model_input
from app.ml.model_service import ModelService, predict_probability
from app.models import ScoringConfig
from app.services.scoring import device_email_rule, score_customer

NEVER_FLAG = 1.0


def raw_features(**overrides):
    values = {
        "name_email_similarity": 0.9,
        "prev_address_months_count": 2,
        "current_address_months_count": 24.0,
        "date_of_birth_distinct_emails_4w": 0,
        "email_is_free": 1,
        "phone_home_valid": 0,
        "phone_mobile_valid": 1,
        "foreign_request": None,
        "source": "INTERNET",
        "session_length_in_minutes": 4.5,
        "device_os": "windows",
        "keep_alive_session": 1,
        "device_distinct_emails_8w": 1,
    }
    assert set(values) == set(FEATURE_NAMES)
    return values | overrides


@pytest.mark.parametrize(
    ("emails", "rule_min", "fires"),
    [
        (None, 3, False),
        (1, 3, False),
        (2, 3, False),
        (3, 3, True),
        (4, 3, True),
        (4, 5, False),
    ],
)
def test_device_email_rule(emails, rule_min, fires):
    reason = device_email_rule(raw_features(device_distinct_emails_8w=emails), rule_min)
    assert (reason is not None) is fires


def test_device_email_rule_reason_text():
    assert device_email_rule(raw_features(device_distinct_emails_8w=4), 3) == {
        "source": "rule",
        "code": "rule__device_distinct_emails_8w",
        "text": "This device was used for 4 different email addresses in 8 weeks",
    }


def score(db_session, features, threshold=NEVER_FLAG):
    customer = make_customer(db_session, make_user(db_session))
    service = ModelService(tiny_state(threshold))
    assessment = score_customer(db_session, service, customer, features)
    db_session.flush()
    return customer, assessment


def test_rule_flags_even_when_the_model_does_not(db_session):
    customer, assessment = score(db_session, raw_features(device_distinct_emails_8w=3))

    assert assessment.probability < NEVER_FLAG
    assert assessment.flagged is True
    assert customer.status == "pending_review"
    assert assessment.reasons[0]["source"] == "rule"
    assert all(reason["source"] == "model" for reason in assessment.reasons[1:])


def test_model_sees_clipped_values_and_snapshot_keeps_raw_values(db_session):
    features = raw_features(device_distinct_emails_8w=3)
    _, assessment = score(db_session, features)

    state = tiny_state()
    clipped = model_input(
        raw_features(device_distinct_emails_8w=2, prev_address_months_count=5),
        state.metadata["numeric_ranges"],
    )
    assert assessment.probability == pytest.approx(
        predict_probability(state.model, state.metadata, clipped)
    )
    assert assessment.features["device_distinct_emails_8w"] == 3
    assert assessment.features["prev_address_months_count"] == 2


def test_below_rule_minimum_is_left_to_the_model(db_session):
    customer, assessment = score(db_session, raw_features(device_distinct_emails_8w=2))
    assert assessment.flagged is False
    assert customer.status == "verified"
    assert all(reason["source"] == "model" for reason in assessment.reasons)


def test_rule_minimum_comes_from_scoring_config(db_session):
    db_session.get(ScoringConfig, 1).device_email_rule_min = 5
    db_session.flush()
    _, assessment = score(db_session, raw_features(device_distinct_emails_8w=4))
    assert assessment.flagged is False


def test_model_flag_without_rule(db_session):
    _, assessment = score(db_session, raw_features(), threshold=0.0)
    assert assessment.flagged is True
    assert all(reason["source"] == "model" for reason in assessment.reasons)


def test_rule_minimum_defaults_to_3_and_cannot_go_below(db_session):
    config = db_session.get(ScoringConfig, 1)
    assert config.device_email_rule_min == 3
    config.device_email_rule_min = 2
    with pytest.raises(IntegrityError):
        db_session.flush()
