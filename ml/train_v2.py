"""Train and export model v2: model v1's setup without two features.

Approved after the v1.4.0 ablation (ml/results/v1.4.0/ablation.md): v2 drops
name_email_similarity (honest users with emails unrelated to their name were
flagged 2.5 times as often) and keep_alive_session (the "Keep me signed in" box
is removed from /join). Everything else is model v1's method:

- the same pipeline (compare_models.build_pipeline, as notebook 03), the same
  LogisticRegression(C=0.01, class_weight="balanced") and sigmoid calibration
  (cv=3, ensemble=False), and the same BAF preparation (negative = missing);
- the deployed model is fitted on months 0-5, as model v1 was;
- both thresholds are the last ROC point at or below 5% FPR on month 5, so the
  test months play no part. The standard threshold is chosen as in v1.3.0
  (compare_models.py): a model fitted on months 0-4 scores month 5's raw
  inputs. The assisted threshold uses the deployed input rules with the three
  device features withheld, as assisted_threshold.py did, but is scored by
  model v2 itself: the months 0-4 model's value does not transfer (see main());
- the export follows notebook 05: metadata.json, 20 golden examples (10 fraud
  and 10 genuine test rows, random_state=1), coefficients.json, and SHA-256.

Model files go to ml/artifacts/v2 (ignored by Git) and are published as the
GitHub Release model-v2. The tracked contract goes to ml/model_contract/v2.

    ml\\.venv\\Scripts\\python.exe ml\\train_v2.py --data <Base.csv>
"""

import argparse
import csv
import hashlib
import json
import platform
import sys
from datetime import UTC, date, datetime
from importlib.metadata import version
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from ablation_features import calibrated_lr, deployed_inputs, withhold
from compare_models import (
    CATEGORICAL,
    LABEL,
    OLDER_AGE,
    TARGET_FPR,
    git_state,
    load_data,
    sha256_of,
    threshold_at_fpr,
)
from compare_models import METADATA as V1_METADATA
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    roc_auc_score,
)

REPO = Path(__file__).resolve().parent.parent
ARTIFACTS = REPO / "ml" / "artifacts" / "v2"
CONTRACT = REPO / "ml" / "model_contract" / "v2"
V1_DEMO_SAMPLE = REPO / "ml" / "model_contract" / "v1" / "demo_sample.csv"
RESULTS = REPO / "ml" / "results" / "v1.4.0" / "model_v2_training.json"
DROPPED = {
    "name_email_similarity": "many genuine users' emails are unrelated to their "
    "name (ablation v1.4.0: their FPR 8.6% vs 3.4%)",
    "keep_alive_session": 'the "Keep me signed in" box was removed from /join',
}
MODEL_FILES = ("model.joblib", "metadata.json", "golden_examples.json")
CONTRACT_FILES = ("metadata.json", "golden_examples.json", "coefficients.json")


def test_metrics(labels, scores, older, threshold: float) -> dict:
    """The same keys as model v1's metadata "metrics_test"."""
    flags = scores >= threshold
    genuine = labels == 0
    tp = int((flags & ~genuine).sum())
    fp = int((flags & genuine).sum())
    fn = int((~flags & ~genuine).sum())
    tn = int((~flags & genuine).sum())
    fpr_young = float(flags[genuine & ~older].mean())
    fpr_old = float(flags[genuine & older].mean())
    return {
        "n_features": 0.0,  # filled in by the caller
        "recall@5%FPR": round(tp / (tp + fn), 4),
        "threshold": threshold,
        "precision": round(tp / (tp + fp), 4),
        "FPR": round(fp / (fp + tn), 4),
        "accuracy": round(accuracy_score(labels, flags), 4),
        "balanced_acc": round(balanced_accuracy_score(labels, flags), 4),
        "ROC-AUC": round(roc_auc_score(labels, scores), 4),
        "PR-AUC": round(average_precision_score(labels, scores), 4),
        "Brier": round(brier_score_loss(labels, scores), 4),
        "mean_prob": round(float(scores.mean()), 4),
        "FPR <50": round(fpr_young, 4),
        "FPR >=50": round(fpr_old, 4),
        "FPR ratio": round(min(fpr_young, fpr_old) / max(fpr_young, fpr_old), 3),
        "TP": float(tp),
        "FP": float(fp),
        "FN": float(fn),
        "TN": float(tn),
    }


def plain(value):
    """A JSON value for one cell: None for missing, Python numbers otherwise."""
    if pd.isna(value):
        return None
    return value.item() if hasattr(value, "item") else value


def golden_examples(model, test, features, threshold) -> list[dict]:
    """Notebook 05's sample: 10 fraud and 10 genuine test rows, random_state=1."""
    sample = pd.concat(
        [
            test[test[LABEL] == 1].sample(10, random_state=1),
            test[test[LABEL] == 0].sample(10, random_state=1),
        ]
    )
    probabilities = model.predict_proba(sample[features])[:, 1]
    return [
        {
            "features": {name: plain(row[name]) for name in features},
            "expected_probability": round(float(p), 6),
            "expected_flag": bool(p >= threshold),
            "true_label": int(row[LABEL]),
        }
        for (_, row), p in zip(sample.iterrows(), probabilities, strict=True)
    ]


def coefficients(model) -> dict:
    pipeline = model.calibrated_classifiers_[0].estimator
    names = pipeline.named_steps["prep"].get_feature_names_out().tolist()
    weights = pipeline.named_steps["model"].coef_[0].tolist()
    return {name: round(weight, 6) for name, weight in zip(names, weights, strict=True)}


def write_demo_sample(features: list[str]) -> int:
    """The same 5,000 demo rows as v1, with only v2's columns."""
    with V1_DEMO_SAMPLE.open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))
    columns = [*features, "customer_age", LABEL]
    with (CONTRACT / "demo_sample.csv").open("w", encoding="utf-8", newline="") as out:
        writer = csv.DictWriter(
            out, columns, extrasaction="ignore", lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, required=True, help="Path to Base.csv")
    args = parser.parse_args()
    git = git_state()
    data = args.data.resolve()
    if data.is_relative_to(REPO):
        parser.error("Base.csv must stay outside the repository")

    v1 = json.loads(V1_METADATA.read_text(encoding="utf-8"))
    features = [name for name in v1["features"] if name not in DROPPED]
    numeric = [name for name in features if name not in CATEGORICAL]
    frame = load_data(data, v1["features"], every_nth=1)
    train = frame[frame["month"] <= 5]
    fit = frame[frame["month"] <= 4]
    validation = frame[frame["month"] == 5]
    test = frame[frame["month"] >= 6].reset_index(drop=True)
    y_test = test[LABEL].to_numpy()
    older = test["customer_age"].to_numpy() >= OLDER_AGE

    print("Fitting on months 0-4 to choose the thresholds", flush=True)
    early = calibrated_lr(features).fit(fit[features], fit[LABEL])
    threshold = round(
        threshold_at_fpr(
            validation[LABEL], early.predict_proba(validation[features])[:, 1]
        ),
        6,
    )
    # numeric_ranges must exist before the deployed input rules can be applied.
    ranges = {
        name: {
            "min": float(train[name].min()),
            "max": float(train[name].max()),
            "median": float(train[name].median()),
        }
        for name in numeric
    }
    rules = {"numeric_ranges": ranges}

    def assisted(scorer, rows):
        return scorer.predict_proba(withhold(deployed_inputs(rows, features, rules)))[
            :, 1
        ]

    # The v1.3.0 method, kept for the record only: it does not transfer (below).
    early_assisted_threshold = round(
        threshold_at_fpr(validation[LABEL], assisted(early, validation)), 6
    )

    print("Fitting model v2 on months 0-5", flush=True)
    model = calibrated_lr(features).fit(train[features], train[LABEL])
    scores = model.predict_proba(test[features])[:, 1]
    metrics = test_metrics(y_test, scores, older, threshold)
    metrics["n_features"] = float(len(features))
    deployed_scores = model.predict_proba(deployed_inputs(test, features, rules))[:, 1]
    assisted_scores = assisted(model, test)
    # Withheld inputs put every assisted score in a narrow band, so a small
    # calibration difference between the months 0-4 and 0-5 models moves the
    # whole band across a threshold (12.5% test FPR at the months 0-4 value).
    # The assisted threshold is therefore taken from model v2 itself on month 5.
    assisted_threshold = round(
        threshold_at_fpr(validation[LABEL], assisted(model, validation)), 6
    )

    metadata = {
        "model_name": v1["model_name"],
        "model_version": "v2",
        "model_type": v1["model_type"],
        "created_at": date.today().isoformat(),
        "training_data": f"BAF Base (NeurIPS 2022), months 0-5, {len(train):,} rows",
        "test_data": f"BAF Base, months 6-7, {len(test):,} rows",
        "sklearn_version": sklearn.__version__,
        "features": features,
        "numeric_features": numeric,
        "categorical_features": {
            name: sorted(train[name].dropna().unique().tolist()) for name in CATEGORICAL
        },
        "missing_value_rule": v1["missing_value_rule"],
        "numeric_ranges": ranges,
        "threshold": threshold,
        "threshold_rule": "flag if probability >= threshold (5% FPR on validation "
        "month 5, model fitted on months 0-4)",
        "assisted_threshold": assisted_threshold,
        "assisted_threshold_rule": "5% FPR on month 5 with the device features "
        "withheld and the deployed input rules, scored by this model (months 0-5)",
        "metrics_test": metrics,
        "excluded_features": v1["excluded_features"] | DROPPED,
        "previous_version": "v1",
    }
    golden = golden_examples(model, test, features, threshold)

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    CONTRACT.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, ARTIFACTS / "model.joblib")
    for name, value in (
        ("metadata.json", metadata),
        ("golden_examples.json", golden),
        ("coefficients.json", coefficients(model)),
    ):
        write_json(ARTIFACTS / name, value)
        (CONTRACT / name).write_bytes((ARTIFACTS / name).read_bytes())
    checksums = "".join(
        f"{hashlib.sha256((ARTIFACTS / name).read_bytes()).hexdigest()}  {name}\n"
        for name in (*MODEL_FILES, "coefficients.json")
    )
    (CONTRACT / "model-v2.sha256").write_text(checksums, encoding="utf-8")
    demo_rows = write_demo_sample(features)

    # Check the export the way the backend will: reload and replay the golden rows.
    loaded = joblib.load(ARTIFACTS / "model.joblib")
    replay = loaded.predict_proba(
        pd.DataFrame([g["features"] for g in golden], columns=features).astype(
            {name: float for name in numeric}
        )
    )[:, 1]
    golden_max_difference = float(
        np.abs(replay - [g["expected_probability"] for g in golden]).max()
    )

    packages = ["scikit-learn", "numpy", "pandas", "joblib", "scipy"]
    write_json(
        RESULTS,
        {
            "model_version": "v2",
            "features": features,
            "dropped": DROPPED,
            "threshold": threshold,
            "assisted_threshold": assisted_threshold,
            "test_months_raw_inputs": metrics,
            "test_months_deployed_inputs": test_metrics(
                y_test, deployed_scores, older, threshold
            ),
            "test_months_assisted_withheld": test_metrics(
                y_test, assisted_scores, older, assisted_threshold
            ),
            "rejected_assisted_threshold_months_0_4_model": {
                "threshold": early_assisted_threshold,
                "model_v2_on_test_months": test_metrics(
                    y_test, assisted_scores, older, early_assisted_threshold
                ),
                "months_0_4_model_on_test_months": test_metrics(
                    y_test, assisted(early, test), older, early_assisted_threshold
                ),
            },
            "validation_month_5_flag_rate": float(
                (early.predict_proba(validation[features])[:, 1] >= threshold).mean()
            ),
            "golden_flagged": sum(g["expected_flag"] for g in golden),
            "golden_max_difference_after_reload": golden_max_difference,
            "demo_sample_rows": demo_rows,
            "checksums": checksums.splitlines(),
            "run_record": {
                "date_utc": datetime.now(UTC).isoformat(timespec="seconds"),
                "git": git,
                "dataset_file": data.name,
                "dataset_sha256": sha256_of(data),
                "rows_used": len(frame),
                "split": {
                    "model": "months 0-5",
                    "threshold_fit": "months 0-4",
                    "threshold_validation": "month 5",
                    "test": "months 6-7",
                },
                "target_fpr": TARGET_FPR,
                "packages": {name: version(name) for name in packages},
                "python": sys.version.split()[0],
                "machine": platform.platform(),
            },
        },
    )
    print(json.dumps({"threshold": threshold, "assisted": assisted_threshold}))
    print(json.dumps(metrics, indent=2))
    print(f"Golden max difference after reload: {golden_max_difference:.2e}")


if __name__ == "__main__":
    main()
