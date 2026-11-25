from dataclasses import replace

import pytest
from model_fixtures import CONTRACT, tiny_model, tiny_state
from test_model_service import REAL_MODEL_DIR

from app.ml.explain import contributions
from app.ml.feature_effects import direction, feature_effects, score_totals
from app.ml.features import model_input
from app.ml.model_service import NOT_LOADED, load_folder

FEATURES = {
    "prev_address_months_count": None,
    "current_address_months_count": 300.0,
    "date_of_birth_distinct_emails_4w": 4,
    "email_is_free": 1,
    "phone_home_valid": 0,
    "phone_mobile_valid": 1,
    "foreign_request": None,
    "source": "INTERNET",
    "session_length_in_minutes": 4.0,
    "device_os": "windows",
    "device_distinct_emails_8w": 1,
}
ASSISTED_FEATURES = FEATURES | {
    "session_length_in_minutes": None,
    "device_os": None,
    "device_distinct_emails_8w": None,
}
USED = set(FEATURES) - {"date_of_birth_distinct_emails_4w"}
STATE = tiny_state()
VERSION = STATE.metadata["model_version"]


def test_a_feature_totals_its_value_missing_indicator_and_categories():
    prepared = model_input(FEATURES, CONTRACT["numeric_ranges"])
    each = contributions(tiny_model(), CONTRACT, prepared)

    totals = score_totals(STATE, VERSION, FEATURES)

    assert totals["prev_address_months_count"] == pytest.approx(
        each["num__prev_address_months_count"]
        + each["num__missingindicator_prev_address_months_count"]
    )
    assert totals["device_os"] == pytest.approx(
        sum(value for code, value in each.items() if code.startswith("cat__device_os_"))
    )
    assert sum(totals.values()) == pytest.approx(sum(each.values()))


def test_effects_follow_the_sign_of_the_total():
    assert direction(0.5) == "raised"
    assert direction(-0.5) == "lowered"
    assert direction(0.009) == "no_effect"
    assert direction(-0.009) == "no_effect"

    effects = feature_effects(STATE, VERSION, FEATURES, assisted=False)
    totals = score_totals(STATE, VERSION, FEATURES)

    assert set(effects) == set(FEATURES)
    for name in USED:
        assert effects[name] == direction(totals[name])


def test_date_of_birth_count_is_labelled_not_used():
    effects = feature_effects(STATE, VERSION, FEATURES, assisted=False)

    assert effects["date_of_birth_distinct_emails_4w"] == "not_used_bank_scale"


def test_assisted_registrations_mark_the_device_features_withheld():
    assisted = feature_effects(STATE, VERSION, ASSISTED_FEATURES, assisted=True)
    not_assisted = feature_effects(STATE, VERSION, ASSISTED_FEATURES, assisted=False)
    withheld = ("session_length_in_minutes", "device_os", "device_distinct_emails_8w")

    totals = score_totals(STATE, VERSION, ASSISTED_FEATURES)

    # Withheld features are still scored, so they keep a real direction.
    for name in withheld:
        assert assisted[name] == f"withheld_{direction(totals[name])}"
        assert not_assisted[name] == direction(totals[name])
    assert {assisted[name] for name in USED - set(withheld)} <= {
        "raised",
        "lowered",
        "no_effect",
    }


@pytest.mark.parametrize(
    "state",
    [NOT_LOADED, replace(STATE, metadata=CONTRACT | {"model_version": "other"})],
)
def test_effects_are_unavailable_without_the_model_that_scored(state):
    effects = feature_effects(state, VERSION, FEATURES, assisted=False)

    assert effects["date_of_birth_distinct_emails_4w"] == "not_used_bank_scale"
    assert {effects[name] for name in USED} == {"unavailable"}


def test_a_snapshot_with_different_features_is_unavailable():
    effects = feature_effects(STATE, VERSION, {"source": "INTERNET"}, assisted=False)

    assert effects == {"source": "unavailable"}


@pytest.mark.skipif(
    not (REAL_MODEL_DIR / "model.joblib").is_file(), reason="model files not present"
)
def test_real_model_maps_every_input_to_a_feature():
    state = load_folder(REAL_MODEL_DIR, "local")
    version = state.metadata["model_version"]

    effects = feature_effects(state, version, ASSISTED_FEATURES, assisted=True)

    assert set(effects) == set(FEATURES)
    assert "unavailable" not in effects.values()
    # Measured in ml/assisted_withholding.py: the missing indicator raises the
    # score and the imputed device-email count lowers it.
    assert effects["session_length_in_minutes"] == "withheld_raised"
    assert effects["device_distinct_emails_8w"] == "withheld_lowered"
