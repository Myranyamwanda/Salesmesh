import json

import pytest

from app.ml.scoring import (
    ModelMetadata,
    ModelNotConnectedError,
    PlaceholderScoringModel,
    ScoreResult,
    get_scoring_model,
)


def test_placeholder_model_refuses_to_score():
    with pytest.raises(ModelNotConnectedError):
        get_scoring_model().score({})


def test_default_model_is_placeholder():
    assert isinstance(get_scoring_model(), PlaceholderScoringModel)


@pytest.mark.parametrize("value", [-0.1, 100.1])
def test_score_result_rejects_out_of_range_scores(value):
    with pytest.raises(ValueError):
        ScoreResult(risk_score=value, reputation_score=50, model_version="test")
    with pytest.raises(ValueError):
        ScoreResult(risk_score=50, reputation_score=value, model_version="test")


def test_score_result_accepts_range_bounds():
    result = ScoreResult(risk_score=0, reputation_score=100, model_version="test")
    assert (result.risk_score, result.reputation_score) == (0, 100)


def test_metadata_loads_output_contract(tmp_path):
    path = tmp_path / "metadata.json"
    path.write_text(
        json.dumps(
            {
                "feature_names": ["feature_a", "feature_b"],
                "model_version": "0.0.1",
                "threshold": 0.5,
                "metrics": {"example_metric": 0.75},
            }
        ),
        encoding="utf-8",
    )

    metadata = ModelMetadata.from_file(path)

    assert metadata.feature_names == ("feature_a", "feature_b")
    assert metadata.model_version == "0.0.1"
    assert metadata.threshold == 0.5
    assert metadata.metrics == {"example_metric": 0.75}


def test_metadata_reports_missing_keys(tmp_path):
    path = tmp_path / "metadata.json"
    path.write_text(json.dumps({"model_version": "0.0.1"}), encoding="utf-8")

    with pytest.raises(ValueError, match="feature_names, threshold, metrics"):
        ModelMetadata.from_file(path)
