"""Scoring interface for the future fraud-detection model.

No dataset has been selected, so this module deliberately defines no features.
It fixes only the shape of a score and of the model metadata file so the API
and frontend can be wired up once a trained model exists.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

SCORE_MIN = 0.0
SCORE_MAX = 100.0
METADATA_KEYS = ("feature_names", "model_version", "threshold", "metrics")


class ModelNotConnectedError(RuntimeError):
    """Raised when scoring is requested before a trained model is available."""


@dataclass(frozen=True)
class ScoreResult:
    risk_score: float
    reputation_score: float
    model_version: str

    def __post_init__(self) -> None:
        for name in ("risk_score", "reputation_score"):
            value = getattr(self, name)
            if not SCORE_MIN <= value <= SCORE_MAX:
                raise ValueError(f"{name} must be between 0 and 100")


@dataclass(frozen=True)
class ModelMetadata:
    """Contents of the metadata JSON saved next to an exported model."""

    feature_names: tuple[str, ...]
    model_version: str
    threshold: float
    metrics: dict[str, float]

    @classmethod
    def from_file(cls, path: Path) -> ModelMetadata:
        data = json.loads(path.read_text(encoding="utf-8"))
        missing = [key for key in METADATA_KEYS if key not in data]
        if missing:
            raise ValueError(f"Model metadata is missing: {', '.join(missing)}")
        return cls(
            feature_names=tuple(data["feature_names"]),
            model_version=str(data["model_version"]),
            threshold=float(data["threshold"]),
            metrics={name: float(value) for name, value in data["metrics"].items()},
        )


class ScoringModel(Protocol):
    def score(self, features: Mapping[str, Any]) -> ScoreResult: ...


class PlaceholderScoringModel:
    """Stands in for the trained model and never produces a score.

    Returning invented numbers would misrepresent the system, so every call
    raises until a real model is connected.
    """

    def score(self, features: Mapping[str, Any]) -> ScoreResult:
        # TODO: Replace with a model loaded from ml/artifacts once the dataset,
        # features, and evaluation metrics have been approved.
        raise ModelNotConnectedError("The scoring model is not connected yet")


def get_scoring_model() -> ScoringModel:
    return PlaceholderScoringModel()
