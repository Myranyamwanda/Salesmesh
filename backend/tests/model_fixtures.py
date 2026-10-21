"""A tiny model with the same structure as the real one, for tests in CI.

The real model.joblib is not in Git, so tests that need a working model train
this one on synthetic data. It has the same pipeline steps ("prep", "model"),
the same 13 inputs, and missing values in the same four columns, so its
transformed feature names match the real model's.
"""

import json
from datetime import UTC, datetime
from functools import cache

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.core.config import ROOT_DIR
from app.ml.model_service import ModelState

CONTRACT = json.loads(
    (ROOT_DIR / "ml" / "model_contract" / "metadata.json").read_text("utf-8")
)
WITH_MISSING = (
    "prev_address_months_count",
    "current_address_months_count",
    "session_length_in_minutes",
    "device_distinct_emails_8w",
)


@cache
def tiny_model() -> CalibratedClassifierCV:
    rng = np.random.default_rng(7)
    rows = 400
    frame = pd.DataFrame(
        {
            name: rng.uniform(0, 1, rows) if name != "source" else "INTERNET"
            for name in CONTRACT["numeric_features"] + ["source"]
        }
    )
    frame["source"] = rng.choice(["INTERNET", "TELEAPP"], rows)
    frame["device_os"] = rng.choice(CONTRACT["categorical_features"]["device_os"], rows)
    for name in WITH_MISSING:
        frame.loc[rng.random(rows) < 0.2, name] = np.nan
    frame = frame[CONTRACT["features"]]
    labels = (frame["email_is_free"] + rng.normal(0, 0.3, rows) > 0.8).astype(int)
    numeric = Pipeline(
        [
            ("impute", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
        ]
    )
    prep = ColumnTransformer(
        [
            ("num", numeric, CONTRACT["numeric_features"]),
            ("cat", OneHotEncoder(handle_unknown="ignore"), ["source", "device_os"]),
        ]
    )
    pipeline = Pipeline([("prep", prep), ("model", LogisticRegression())])
    model = CalibratedClassifierCV(pipeline, method="sigmoid", cv=2, ensemble=False)
    return model.fit(frame, labels)


def tiny_state(threshold: float = 0.5) -> ModelState:
    """A ready model state; threshold 0 flags everyone, 1 flags no one."""
    return ModelState(
        status="ok",
        source="local",
        loaded_at=datetime.now(UTC),
        metadata=CONTRACT | {"model_version": "test-tiny", "threshold": threshold},
        model=tiny_model(),
    )
