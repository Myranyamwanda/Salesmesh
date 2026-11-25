"""Choose model v1's threshold for assisted registrations, and measure it.

Assisted registrations withhold four device features, which lowers every score
below the standard threshold (see assisted_withholding.py). This script picks a
separate threshold the same way Phase 1 did for the comparison:

1. Fit model v1's setup (calibrated logistic regression) on months 0-4.
2. Score month 5 through the deployed pipeline with the four features withheld,
   and take the threshold at 5% false-positive rate.
3. Measure on test months 6-7, with the features withheld, for both the
   months 0-4 model and the deployed model v1.

Run with the backend environment (see ml/RUN_RECORD.md):

    backend\\.venv\\Scripts\\python.exe ml\\assisted_threshold.py --data <Base.csv>
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from assisted_withholding import (
    LABEL,
    NEGATIVE_IS_MISSING,
    demo_customers,
    prepare,
    withhold,
)
from compare_models import at_threshold, build_pipeline, threshold_at_fpr
from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

from app.ml.model_service import CHECKSUM_DIR, load_folder  # noqa: E402

MODEL_DIR = REPO / "backend" / "models" / "v1"
OUT = REPO / "ml" / "results" / "v1.3.0" / "assisted_threshold.json"


def measure(scores, frame, threshold) -> dict:
    labels = frame[LABEL].to_numpy()
    older = frame["customer_age"].to_numpy() >= 50
    return at_threshold(labels, scores, older, threshold) | {
        "roc_auc": roc_auc_score(labels, scores),
        "flag_rate": float((scores >= threshold).mean()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, required=True, help="Path to Base.csv")
    args = parser.parse_args()
    if args.data.resolve().is_relative_to(REPO):
        parser.error("Base.csv must stay outside the repository")

    state = load_folder(MODEL_DIR, "local", CHECKSUM_DIR)
    deployed, metadata = state.model, state.metadata
    features = metadata["features"]
    frame = pd.read_csv(args.data, usecols=[*features, "customer_age", LABEL, "month"])
    for name in NEGATIVE_IS_MISSING:
        frame.loc[frame[name] < 0, name] = np.nan
    fit = frame[frame["month"] <= 4]
    validation = frame[frame["month"] == 5]
    test = frame[frame["month"] >= 6].reset_index(drop=True)

    # The same setup as model v1 (and compare_models.py), on months 0-4.
    early = CalibratedClassifierCV(
        build_pipeline(
            LogisticRegression(C=0.01, class_weight="balanced", max_iter=2000),
            features,
            scale=True,
        ),
        method="sigmoid",
        cv=3,
        ensemble=False,
    ).fit(fit[features], fit[LABEL])

    def withheld_scores(model, rows):
        return model.predict_proba(withhold(prepare(rows, metadata)))[:, 1]

    month_5 = withheld_scores(early, validation)
    threshold = threshold_at_fpr(validation[LABEL], month_5)
    standard = float(metadata["threshold"])
    deployed_test = withheld_scores(deployed, test)
    entered_test = deployed.predict_proba(prepare(test, metadata))[:, 1]

    demo = demo_customers()
    demo_assisted = demo[demo["assisted"]].reset_index(drop=True)
    demo_scores = withheld_scores(deployed, demo_assisted)
    demo_flags = demo_scores >= threshold

    results = {
        "assisted_threshold": round(threshold, 6),
        "chosen_on": "month 5, features withheld, model fitted on months 0-4",
        "validation_month_5": measure(month_5, validation, threshold),
        "test_months_withheld": {
            "months_0_4_model": measure(withheld_scores(early, test), test, threshold),
            "deployed_model_v1": measure(deployed_test, test, threshold),
        },
        "test_months_as_entered_deployed_pipeline": measure(
            entered_test, test, standard
        ),
        "demo_assisted": {
            "customers": len(demo_assisted),
            "flagged": int(demo_flags.sum()),
            "flagged_fraud": int((demo_flags & (demo_assisted[LABEL] == 1)).sum()),
            "fraud": int((demo_assisted[LABEL] == 1).sum()),
            "not_flagged": int((~demo_flags).sum()),
        },
    }
    OUT.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
