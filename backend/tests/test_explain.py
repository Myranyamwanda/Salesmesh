import json

import pytest
from model_fixtures import CONTRACT, tiny_model
from test_model_service import REAL_MODEL_DIR

from app.ml.explain import REASON_TEXTS, contributions, explain
from app.ml.model_service import feature_frame, load_folder

FEATURES = {
    "name_email_similarity": 0.05,
    "prev_address_months_count": None,
    "current_address_months_count": 300.0,
    "date_of_birth_distinct_emails_4w": None,
    "email_is_free": 1,
    "phone_home_valid": 0,
    "phone_mobile_valid": 1,
    "foreign_request": None,
    "source": "INTERNET",
    "session_length_in_minutes": 4.0,
    "device_os": "windows",
    "keep_alive_session": 0,
    "device_distinct_emails_8w": 1,
}


def test_contributions_are_value_times_coefficient():
    model = tiny_model()
    pipeline = model.calibrated_classifiers_[0].estimator
    row = feature_frame(CONTRACT, FEATURES)
    values = pipeline.named_steps["prep"].transform(row)[0]
    weights = pipeline.named_steps["model"].coef_[0]

    result = contributions(model, CONTRACT, FEATURES)

    assert list(result) == list(pipeline.named_steps["prep"].get_feature_names_out())
    assert list(result.values()) == pytest.approx(list(values * weights))


def test_explain_returns_top_positive_reasons_with_text():
    model = tiny_model()
    all_contributions = contributions(model, CONTRACT, FEATURES)

    reasons = explain(model, CONTRACT, FEATURES)

    assert 1 <= len(reasons) <= 3
    assert [r["contribution"] for r in reasons] == sorted(
        (r["contribution"] for r in reasons), reverse=True
    )
    for reason in reasons:
        assert reason["source"] == "model"
        assert reason["contribution"] > 0
        assert reason["text"] == REASON_TEXTS[reason["code"]]
        assert reason["contribution"] == round(all_contributions[reason["code"]], 4)
    shown = {
        code: value
        for code, value in all_contributions.items()
        if value > 0 and REASON_TEXTS[code] is not None
    }
    assert {r["code"] for r in reasons} == set(
        sorted(shown, key=shown.get, reverse=True)[:3]
    )


def test_explain_never_shows_hidden_codes():
    model = tiny_model()
    hidden = {code for code, text in REASON_TEXTS.items() if text is None}
    for keep_alive in (0, 1):
        for os_name in CONTRACT["categorical_features"]["device_os"]:
            features = FEATURES | {
                "device_os": os_name,
                "keep_alive_session": keep_alive,
            }
            codes = {r["code"] for r in explain(model, CONTRACT, features, top=22)}
            assert not codes & hidden


def test_tiny_model_names_match_reason_dictionary():
    names = (
        tiny_model()
        .calibrated_classifiers_[0]
        .estimator.named_steps["prep"]
        .get_feature_names_out()
    )
    assert set(names) == set(REASON_TEXTS)


@pytest.mark.skipif(
    not (REAL_MODEL_DIR / "model.joblib").is_file(),
    reason="Model files are not in Git; download them to backend/models/v1",
)
def test_real_model_reasons():
    state = load_folder(REAL_MODEL_DIR, "local")
    prep = state.model.calibrated_classifiers_[0].estimator.named_steps["prep"]
    assert set(prep.get_feature_names_out()) == set(REASON_TEXTS)

    golden = json.loads(
        (REAL_MODEL_DIR / "golden_examples.json").read_text(encoding="utf-8")
    )
    flagged = next(example for example in golden if example["expected_flag"])
    reasons = explain(state.model, state.metadata, flagged["features"])
    assert reasons
    assert all(reason["text"] for reason in reasons)
