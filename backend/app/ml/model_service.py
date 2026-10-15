"""Load the fraud-detection model once and check it before it may be used.

Loading runs these steps in order:

1. Read metadata.json and compare its "sklearn_version" with the installed
   scikit-learn. On a mismatch, model.joblib is never unpickled, because a
   pickle from another version can fail or silently change its predictions.
2. Unpickle model.joblib. It is a CalibratedClassifierCV that already
   contains all preprocessing, so it takes the 13 raw feature values.
3. Score the golden examples one row at a time, through the same function
   used for real requests, and compare with the expected probabilities.

Only when every step passes is the model "ok". Otherwise it is "failed", the
reason is kept for the health check and the admin model page, and every
prediction is refused.
"""

import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Literal

import joblib
import pandas as pd
import sklearn
from fastapi import Request

from app.core.config import Settings
from app.ml.model_source import ModelSourceError, download_from_s3

logger = logging.getLogger(__name__)

GOLDEN_TOLERANCE = 1e-6
REQUIRED_METADATA = (
    "model_version",
    "sklearn_version",
    "features",
    "numeric_features",
    "threshold",
    "metrics_test",
)


class ModelLoadError(RuntimeError):
    """Raised when the model files are missing, invalid, or incompatible."""


class ModelUnavailableError(RuntimeError):
    """Raised when a prediction is requested but the model is not ok."""


@dataclass(frozen=True)
class GoldenCheck:
    checked: int
    failed: int
    max_difference: float
    tolerance: float = GOLDEN_TOLERANCE

    @property
    def passed(self) -> bool:
        return self.checked > 0 and self.failed == 0


@dataclass(frozen=True)
class ModelState:
    status: Literal["ok", "failed"]
    source: str
    error: str | None = None
    loaded_at: datetime | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)
    golden: GoldenCheck | None = None
    model: Any = field(default=None, repr=False)


NOT_LOADED = ModelState(status="failed", source="none", error="Model is not loaded")


def predict_probability(
    model: Any, metadata: Mapping[str, Any], features: Mapping[str, Any]
) -> float:
    """Return the probability that one customer is fake.

    features must contain exactly the model's feature names; None means missing.
    """
    names = list(metadata["features"])
    if set(features) != set(names):
        missing = sorted(set(names) - set(features))
        unexpected = sorted(set(features) - set(names))
        raise ValueError(f"Wrong features. Missing: {missing}. Unexpected: {unexpected}")
    row = pd.DataFrame([{name: features[name] for name in names}], columns=names)
    numeric = list(metadata["numeric_features"])
    # A one-row frame holding None has an object column; cast so None becomes NaN.
    row[numeric] = row[numeric].astype(float)
    return float(model.predict_proba(row)[0, 1])


def run_golden_check(
    model: Any, metadata: Mapping[str, Any], examples: list[dict[str, Any]]
) -> GoldenCheck:
    differences = [
        abs(
            predict_probability(model, metadata, example["features"])
            - float(example["expected_probability"])
        )
        for example in examples
    ]
    return GoldenCheck(
        checked=len(differences),
        # "not <=" also counts NaN as a failure, which "d > tolerance" would miss.
        failed=sum(not difference <= GOLDEN_TOLERANCE for difference in differences),
        max_difference=max(differences, default=0.0),
    )


def read_json(path: Path) -> Any:
    if not path.is_file():
        raise ModelLoadError(f"Model file not found: {path.name}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ModelLoadError(f"Model file is not valid JSON: {path.name}") from exc


def load_folder(folder: Path, source: str) -> ModelState:
    loaded_at = datetime.now(UTC)
    metadata = read_json(folder / "metadata.json")
    missing = [key for key in REQUIRED_METADATA if key not in metadata]
    if missing:
        raise ModelLoadError(f"metadata.json is missing: {', '.join(missing)}")

    def failed(error: str, golden: GoldenCheck | None = None) -> ModelState:
        return ModelState(
            status="failed",
            source=source,
            error=error,
            loaded_at=loaded_at,
            metadata=metadata,
            golden=golden,
        )

    if metadata["sklearn_version"] != sklearn.__version__:
        return failed(
            f"scikit-learn {sklearn.__version__} is installed, but the model "
            f"requires {metadata['sklearn_version']}"
        )
    model_path = folder / "model.joblib"
    if not model_path.is_file():
        raise ModelLoadError("Model file not found: model.joblib")
    model = joblib.load(model_path)
    golden = run_golden_check(model, metadata, read_json(folder / "golden_examples.json"))
    if not golden.passed:
        return failed(
            f"Golden check failed: {golden.failed} of {golden.checked} examples "
            f"differ by more than {GOLDEN_TOLERANCE}",
            golden,
        )
    return ModelState(
        status="ok",
        source=source,
        loaded_at=loaded_at,
        metadata=metadata,
        golden=golden,
        model=model,
    )


def load_model_state(settings: Settings) -> ModelState:
    """Load and verify the model. Never raises: a failure becomes a failed state."""
    source = settings.model_source
    try:
        if source == "s3":
            # The files are only needed while loading; the model stays in memory.
            with TemporaryDirectory() as folder:
                download_from_s3(settings, Path(folder))
                state = load_folder(Path(folder), source)
        else:
            state = load_folder(settings.model_dir, source)
    except (ModelLoadError, ModelSourceError) as exc:
        state = ModelState(
            status="failed", source=source, error=str(exc), loaded_at=datetime.now(UTC)
        )
    except Exception:
        logger.exception("model_load_error")
        state = ModelState(
            status="failed",
            source=source,
            error="Model could not be loaded; see the server log",
            loaded_at=datetime.now(UTC),
        )
    logger.info(
        "model_loaded" if state.status == "ok" else "model_load_failed",
        extra={
            "model_version": state.metadata.get("model_version"),
            "reason": state.error,
        },
    )
    return state


class ModelService:
    """Holds the current model state for the whole application.

    load() replaces the state in a single assignment, so a request never sees a
    half-loaded model.
    """

    def __init__(self, state: ModelState = NOT_LOADED) -> None:
        self.state = state

    def load(self, settings: Settings) -> ModelState:
        self.state = load_model_state(settings)
        return self.state

    def predict_probability(self, features: Mapping[str, Any]) -> float:
        state = self.state
        if state.status != "ok":
            raise ModelUnavailableError(state.error or "Model is not available")
        return predict_probability(state.model, state.metadata, features)


def get_model_service(request: Request) -> ModelService:
    return request.app.state.model_service
