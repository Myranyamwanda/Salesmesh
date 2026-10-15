import json
import math
import shutil
from pathlib import Path

import joblib
import numpy as np
import pytest
import sklearn

from app.core.config import BACKEND_DIR, Settings
from app.ml import model_source
from app.ml.model_service import (
    ModelService,
    ModelUnavailableError,
    load_folder,
    load_model_state,
)

REAL_MODEL_DIR = BACKEND_DIR / "models" / "v1"
FEATURES = {"size": 2.0, "colour": "red"}


class FakeModel:
    """Stands in for the real classifier and always returns one probability."""

    def __init__(self, probability):
        self.probability = probability
        self.rows = []

    def predict_proba(self, frame):
        self.rows.append(frame)
        return np.array([[1 - self.probability, self.probability]] * len(frame))


def make_settings(**overrides):
    return Settings(
        _env_file=None,
        postgres_db="salesmesh_test",
        postgres_user="test_user",
        postgres_password="test_password",
        **overrides,
    )


def write_model_folder(
    folder: Path, probability=0.25, expected=0.25, version=sklearn.__version__
):
    metadata = {
        "model_name": "fake",
        "model_version": "test",
        "sklearn_version": version,
        "features": ["size", "colour"],
        "numeric_features": ["size"],
        "threshold": 0.5,
        "metrics_test": {"ROC-AUC": 0.5},
    }
    golden = [{"features": FEATURES, "expected_probability": expected}]
    (folder / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    (folder / "golden_examples.json").write_text(json.dumps(golden), encoding="utf-8")
    joblib.dump(FakeModel(probability), folder / "model.joblib")
    return folder


@pytest.mark.skipif(
    not (REAL_MODEL_DIR / "model.joblib").is_file(),
    reason="Model files are not in Git; download them to backend/models/v1",
)
def test_real_model_passes_golden_examples():
    state = load_folder(REAL_MODEL_DIR, "local")
    assert state.status == "ok", state.error
    assert state.golden.checked == 20
    assert state.golden.max_difference <= 1e-6

    service = ModelService(state)
    threshold = state.metadata["threshold"]
    golden = json.loads(
        (REAL_MODEL_DIR / "golden_examples.json").read_text(encoding="utf-8")
    )
    for example in golden:
        probability = service.predict_probability(example["features"])
        assert abs(probability - example["expected_probability"]) <= 1e-6
        assert (probability >= threshold) == example["expected_flag"]


def test_matching_fake_model_is_ready_and_predicts(tmp_path):
    state = load_folder(write_model_folder(tmp_path), "local")
    assert state.status == "ok"
    assert state.golden.passed

    service = ModelService(state)
    assert service.predict_probability({"size": None, "colour": None}) == 0.25
    row = state.model.rows[-1]
    assert list(row.columns) == ["size", "colour"]
    assert math.isnan(row["size"].iloc[0])


def test_version_mismatch_never_unpickles(tmp_path):
    write_model_folder(tmp_path, version="0.0.0")
    (tmp_path / "model.joblib").write_bytes(b"not a pickle")

    state = load_folder(tmp_path, "local")

    assert state.status == "failed"
    assert "requires 0.0.0" in state.error
    assert state.model is None
    assert state.metadata["model_version"] == "test"


def test_failed_golden_check_blocks_predictions(tmp_path):
    state = load_folder(write_model_folder(tmp_path, probability=0.5), "local")

    assert state.status == "failed"
    assert state.golden.failed == 1
    assert "Golden check failed: 1 of 1" in state.error
    with pytest.raises(ModelUnavailableError, match="Golden check failed"):
        ModelService(state).predict_probability(FEATURES)


def test_nan_probability_fails_golden_check(tmp_path):
    state = load_folder(write_model_folder(tmp_path, probability=math.nan), "local")
    assert state.status == "failed"
    assert state.golden.failed == 1


def test_prediction_requires_exact_feature_names(tmp_path):
    service = ModelService(load_folder(write_model_folder(tmp_path), "local"))
    with pytest.raises(ValueError, match="Missing: \\['colour'\\]"):
        service.predict_probability({"size": 1.0})
    with pytest.raises(ValueError, match="Unexpected: \\['age'\\]"):
        service.predict_probability({**FEATURES, "age": 30})


def test_unloaded_service_refuses_predictions():
    with pytest.raises(ModelUnavailableError, match="not loaded"):
        ModelService().predict_probability(FEATURES)


def test_missing_files_are_reported_without_paths(tmp_path):
    state = load_model_state(make_settings(model_dir=tmp_path))
    assert state.status == "failed"
    assert state.error == "Model file not found: metadata.json"
    assert str(tmp_path) not in state.error


def test_relative_model_dir_is_resolved_from_backend():
    assert make_settings(model_dir="models/v1").model_dir == REAL_MODEL_DIR


class FakeS3Client:
    def __init__(self, source: Path, fail=False):
        self.source = source
        self.fail = fail
        self.downloads = []

    def download_file(self, bucket, key, filename):
        if self.fail:
            raise OSError("network down")
        self.downloads.append((bucket, key))
        shutil.copy(self.source / key.rsplit("/", 1)[-1], filename)


def use_fake_s3(monkeypatch, client):
    calls = []

    def fake_client(service, **kwargs):
        calls.append((service, kwargs))
        return client

    monkeypatch.setattr(model_source.boto3, "client", fake_client)
    return calls


def test_s3_source_downloads_and_loads_model(tmp_path, monkeypatch):
    client = FakeS3Client(write_model_folder(tmp_path))
    calls = use_fake_s3(monkeypatch, client)
    settings = make_settings(
        model_source="s3",
        model_s3_bucket="salesmesh-models",
        model_s3_prefix="/models/final/v1/",
        aws_region="eu-west-1",
        aws_access_key_id="read-only-id",
        aws_secret_access_key="read-only-secret",
    )

    state = load_model_state(settings)

    assert state.status == "ok", state.error
    assert state.source == "s3"
    assert client.downloads == [
        ("salesmesh-models", "models/final/v1/model.joblib"),
        ("salesmesh-models", "models/final/v1/metadata.json"),
        ("salesmesh-models", "models/final/v1/golden_examples.json"),
    ]
    assert calls == [
        (
            "s3",
            {
                "region_name": "eu-west-1",
                "aws_access_key_id": "read-only-id",
                "aws_secret_access_key": "read-only-secret",
            },
        )
    ]


def test_s3_source_requires_bucket():
    state = load_model_state(make_settings(model_source="s3"))
    assert state.status == "failed"
    assert state.error == "MODEL_S3_BUCKET is required when MODEL_SOURCE=s3"


def test_s3_download_failure_is_reported(tmp_path, monkeypatch):
    use_fake_s3(monkeypatch, FakeS3Client(tmp_path, fail=True))
    state = load_model_state(
        make_settings(model_source="s3", model_s3_bucket="salesmesh-models")
    )
    assert state.status == "failed"
    assert state.error == "Could not download model.joblib from S3"
