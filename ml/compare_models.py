"""Compare model v1 with other model families, as evidence for v1.3.0.

Uses the notebooks' method: the 13 features of model v1, the same preprocessing,
and the temporal split (months 0-5 train, 6-7 test). Each model is measured at:

- original: 5% FPR threshold chosen on the test months, as notebook 04 did;
- validation: fit on months 0-4, 5% FPR threshold chosen on month 5, measured
  on months 6-7, so the test months play no part in choosing the threshold;
- deployed: model.joblib at its fixed threshold from metadata.json (only that
  model, because 0.035 is meaningful only on its calibrated probabilities).

This script never changes model v1. It reads the dataset and the model files and
writes summary figures only. Run it with ml/.venv (see ml/RUN_RECORD.md).
"""

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

import joblib
import matplotlib
import numpy as np
import pandas as pd
import sklearn
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score, roc_curve
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

matplotlib.use("Agg")
import matplotlib.pyplot as plt

REPO = Path(__file__).resolve().parent.parent
METADATA = REPO / "ml" / "model_contract" / "metadata.json"
CHECKSUMS = REPO / "ml" / "model_contract" / "model-v1.sha256"
DEPLOYED_MODEL = REPO / "backend" / "models" / "v1" / "model.joblib"

LABEL = "fraud_bool"
CATEGORICAL = ["source", "device_os"]
# Negative means missing in the BAF data (notebook 02).
NEGATIVE_IS_MISSING = [
    "prev_address_months_count",
    "current_address_months_count",
    "session_length_in_minutes",
    "device_distinct_emails_8w",
]
SEED = 42
TARGET_FPR = 0.05
OLDER_AGE = 50  # customer_age measures fairness only; it is never a feature.

# Dataviz reference palette: blue, orange, aqua, and a neutral reference line.
COLOURS = {
    "Calibrated LR (model v1 setup)": "#2a78d6",
    "Random forest": "#eb6834",
    "Gradient boosting": "#1baf7a",
}
LINE_STYLES = {
    "Calibrated LR (model v1 setup)": "-",
    "Random forest": "--",
    "Gradient boosting": "-.",
}
SURFACE = "#fcfcfb"
TEXT = "#52514e"
GRID = "#e4e3df"
REFERENCE = "#7a7974"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_data(path: Path, features: list[str], every_nth: int) -> pd.DataFrame:
    columns = [*features, "customer_age", LABEL, "month"]
    frame = pd.read_csv(path, usecols=columns)
    for column in NEGATIVE_IS_MISSING:
        frame.loc[frame[column] < 0, column] = np.nan
    return frame.iloc[::every_nth].reset_index(drop=True)


def build_pipeline(model, features: list[str], scale: bool) -> Pipeline:
    """Notebook 03's pipeline. Trees skip scaling, as they did there."""
    numeric = [column for column in features if column not in CATEGORICAL]
    steps = [("impute", SimpleImputer(strategy="median", add_indicator=True))]
    if scale:
        steps.append(("scale", StandardScaler()))
    prep = ColumnTransformer(
        [
            ("num", Pipeline(steps), numeric),
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
        ]
    )
    return Pipeline([("prep", prep), ("model", model)])


def candidates(features: list[str], n_jobs: int, smoke: bool) -> dict:
    forest = {
        "n_estimators": 10 if smoke else 150,
        "class_weight": "balanced_subsample",
        "max_samples": 0.3,
        "max_depth": 24,
        "min_samples_leaf": 50,
        "n_jobs": n_jobs,
        "random_state": SEED,
    }
    boosting = {
        "max_iter": 10 if smoke else 200,
        "learning_rate": 0.1,
        "class_weight": "balanced",
        "early_stopping": False,
        "random_state": SEED,
    }
    logistic = {"C": 0.01, "class_weight": "balanced", "max_iter": 2000}
    return {
        "Dummy (prior)": {
            "params": {"strategy": "prior"},
            "build": lambda: build_pipeline(
                DummyClassifier(strategy="prior"), features, scale=False
            ),
        },
        "Calibrated LR (model v1 setup)": {
            "params": {**logistic, "calibration": "sigmoid, cv=3, ensemble=False"},
            "build": lambda: CalibratedClassifierCV(
                build_pipeline(LogisticRegression(**logistic), features, scale=True),
                method="sigmoid",
                cv=3,
                ensemble=False,
            ),
        },
        "Random forest": {
            "params": forest,
            "build": lambda: build_pipeline(
                RandomForestClassifier(**forest), features, scale=False
            ),
        },
        "Gradient boosting": {
            "params": boosting,
            "build": lambda: build_pipeline(
                HistGradientBoostingClassifier(**boosting), features, scale=False
            ),
        },
    }


def threshold_at_fpr(y_true, scores, max_fpr: float = TARGET_FPR) -> float:
    """Notebook 03's rule: the last ROC point with FPR at or below max_fpr."""
    fpr, _, thresholds = roc_curve(y_true, scores)
    return float(thresholds[np.searchsorted(fpr, max_fpr, side="right") - 1])


def at_threshold(y_true, scores, older, threshold: float) -> dict:
    flagged = scores >= threshold
    genuine = y_true == 0
    tp = int((flagged & ~genuine).sum())
    fp = int((flagged & genuine).sum())
    fn = int((~flagged & ~genuine).sum())
    fpr_under_50 = float(flagged[~older & genuine].mean())
    fpr_50_plus = float(flagged[older & genuine].mean())
    highest = max(fpr_under_50, fpr_50_plus)
    return {
        "threshold": threshold if np.isfinite(threshold) else None,
        "recall": tp / (tp + fn),
        "precision": tp / (tp + fp) if tp + fp else None,
        "fpr": fp / int(genuine.sum()),
        "fpr_under_50": fpr_under_50,
        "fpr_50_plus": fpr_50_plus,
        "fpr_ratio": min(fpr_under_50, fpr_50_plus) / highest if highest else None,
        "tp": tp,
        "fp": fp,
        "fn": fn,
    }


def model_size_bytes(model) -> int:
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / "model.joblib"
        joblib.dump(model, target)
        return target.stat().st_size


def fit_and_score(build, train, test, features: list[str]):
    model = build()
    started = time.perf_counter()
    model.fit(train[features], train[LABEL])
    seconds = time.perf_counter() - started
    return model, model.predict_proba(test[features])[:, 1], seconds


def run_comparison(frame, features, models) -> tuple[list[dict], dict]:
    train = frame[frame["month"] <= 5]
    fit = frame[frame["month"] <= 4]
    validation = frame[frame["month"] == 5]
    test = frame[frame["month"] >= 6]
    y_test = test[LABEL].to_numpy()
    older = test["customer_age"].to_numpy() >= OLDER_AGE

    rows, scores = [], {}
    for name, spec in models.items():
        print(f"{name}: fitting on months 0-5", flush=True)
        model, test_scores, seconds = fit_and_score(
            spec["build"], train, test, features
        )
        size = model_size_bytes(model)
        scores[name] = test_scores
        del model

        print(f"{name}: fitting on months 0-4", flush=True)
        early, early_scores, early_seconds = fit_and_score(
            spec["build"], fit, test, features
        )
        month_5_scores = early.predict_proba(validation[features])[:, 1]
        validation_threshold = threshold_at_fpr(validation[LABEL], month_5_scores)
        del early

        rows.append(
            {
                "model": name,
                "model_size_bytes": size,
                "original": at_threshold(
                    y_test, test_scores, older, threshold_at_fpr(y_test, test_scores)
                )
                | {
                    "roc_auc": roc_auc_score(y_test, test_scores),
                    "pr_auc": average_precision_score(y_test, test_scores),
                    "train_seconds": seconds,
                },
                "validation": at_threshold(
                    y_test, early_scores, older, validation_threshold
                )
                | {
                    "roc_auc": roc_auc_score(y_test, early_scores),
                    "pr_auc": average_precision_score(y_test, early_scores),
                    "train_seconds": early_seconds,
                },
            }
        )
        print(f"{name}: done in {seconds + early_seconds:.0f}s", flush=True)
    return rows, scores


def deployed_check(frame, features, metadata, refit_scores) -> dict:
    """Prove the data and method match the SageMaker run, using model.joblib."""
    expected = {
        line.split()[1]: line.split()[0]
        for line in CHECKSUMS.read_text(encoding="utf-8").splitlines()
    }
    actual = sha256_of(DEPLOYED_MODEL)
    test = frame[frame["month"] >= 6]
    y_test = test[LABEL].to_numpy()
    older = test["customer_age"].to_numpy() >= OLDER_AGE
    scores = joblib.load(DEPLOYED_MODEL).predict_proba(test[features])[:, 1]
    published = metadata["metrics_test"]
    fixed = at_threshold(y_test, scores, older, float(metadata["threshold"]))
    return {
        "model_sha256": actual,
        "model_sha256_matches_contract": actual == expected["model.joblib"],
        "train_rows": int((frame["month"] <= 5).sum()),
        "test_rows": len(test),
        "roc_auc": roc_auc_score(y_test, scores),
        "published_roc_auc": published["ROC-AUC"],
        "published_recall": published["recall@5%FPR"],
        "published_precision": published["precision"],
        "published_fpr_ratio": published["FPR ratio"],
        "at_deployed_threshold": fixed,
        "at_unrounded_test_threshold": at_threshold(
            y_test, scores, older, threshold_at_fpr(y_test, scores)
        ),
        "max_abs_difference_refit_vs_deployed": float(
            np.abs(scores - refit_scores).max()
        ),
    }


def git_state() -> dict:
    def git(*arguments: str) -> str:
        return subprocess.run(
            ["git", *arguments], cwd=REPO, capture_output=True, text=True, check=True
        ).stdout.strip()

    return {"commit": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--short"))}


def write_csv(rows: list[dict], target: Path) -> None:
    flat = []
    for row in rows:
        for view in ("original", "validation"):
            flat.append(
                {
                    "model": row["model"],
                    "threshold_chosen_on": (
                        "test months 6-7"
                        if view == "original"
                        else "validation month 5 (fit on months 0-4)"
                    ),
                    "model_size_bytes": row["model_size_bytes"],
                    **row[view],
                }
            )
    pd.DataFrame(flat).to_csv(target, index=False, lineterminator="\n")


def style(axis) -> None:
    axis.set_facecolor(SURFACE)
    axis.grid(color=GRID, linewidth=0.8)
    axis.set_axisbelow(True)
    axis.tick_params(colors=TEXT, length=0)
    axis.xaxis.label.set_color(TEXT)
    axis.yaxis.label.set_color(TEXT)
    for side in ("top", "right", "left", "bottom"):
        axis.spines[side].set_visible(False)


def plot_roc(rows, scores, y_test, target: Path) -> None:
    figure, axis = plt.subplots(figsize=(7, 5.4), facecolor=SURFACE)
    style(axis)
    axis.plot([0, 1], [0, 1], color=REFERENCE, linestyle=":", label="Dummy (AUC 0.500)")
    axis.axvline(TARGET_FPR, color=REFERENCE, linestyle="--", linewidth=1)
    axis.annotate("5% FPR", (TARGET_FPR, 0.03), xytext=(5, 0), color=TEXT,
                  textcoords="offset points")  # fmt: skip
    for row in rows:
        name = row["model"]
        if name not in COLOURS:
            continue
        fpr, tpr, _ = roc_curve(y_test, scores[name])
        axis.plot(
            fpr,
            tpr,
            color=COLOURS[name],
            linewidth=2,
            linestyle=LINE_STYLES[name],
            label=f"{name} (AUC {row['original']['roc_auc']:.3f})",
        )
    axis.set(xlabel="False positive rate", ylabel="Recall", xlim=(0, 1), ylim=(0, 1))
    axis.legend(frameon=False, labelcolor=TEXT, loc="lower right")
    axis.set_title("ROC curves on test months 6-7", color=TEXT, loc="left")
    figure.tight_layout()
    figure.savefig(target, dpi=150)
    plt.close(figure)


def plot_recall(rows, target: Path) -> None:
    shown = [row for row in rows if row["model"] in COLOURS]
    positions = np.arange(len(shown))
    height = 0.34
    views = [
        ("original", "Threshold chosen on test months", "#2a78d6", -height / 2 - 0.01),
        ("validation", "Threshold chosen on month 5", "#eb6834", height / 2 + 0.01),
    ]
    figure, axis = plt.subplots(figsize=(7.4, 3.8), facecolor=SURFACE)
    style(axis)
    axis.grid(axis="y", visible=False)
    for view, label, colour, offset in views:
        values = [row[view]["recall"] for row in shown]
        bars = axis.barh(positions + offset, values, height, color=colour, label=label)
        axis.bar_label(bars, fmt="%.3f", padding=4, color=TEXT)
    axis.set_yticks(positions, [row["model"] for row in shown])
    axis.invert_yaxis()
    axis.set_xlabel("Recall on test months 6-7")
    axis.set_xlim(0, max(row["original"]["recall"] for row in shown) * 1.2)
    axis.legend(frameon=False, labelcolor=TEXT, loc="lower right")
    axis.set_title("Recall by where the 5% FPR threshold was chosen", color=TEXT,
                   loc="left")  # fmt: skip
    figure.tight_layout()
    figure.savefig(target, dpi=150)
    plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, required=True, help="Path to Base.csv")
    parser.add_argument("--out", type=Path, required=True, help="Results folder")
    parser.add_argument("--n-jobs", type=int, default=-1)
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Use every 20th row and tiny models, to test the script only",
    )
    args = parser.parse_args()

    data = args.data.resolve()
    if data.is_relative_to(REPO):
        parser.error("Base.csv must stay outside the repository")

    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    features = metadata["features"]
    every_nth = 20 if args.smoke else 1
    frame = load_data(data, features, every_nth)
    models = candidates(features, args.n_jobs, args.smoke)

    started = time.perf_counter()
    rows, scores = run_comparison(frame, features, models)
    print("Checking the deployed model", flush=True)
    deployed = deployed_check(
        frame, features, metadata, scores["Calibrated LR (model v1 setup)"]
    )

    args.out.mkdir(parents=True, exist_ok=True)
    y_test = frame.loc[frame["month"] >= 6, LABEL].to_numpy()
    plot_roc(rows, scores, y_test, args.out / "roc_curves.png")
    plot_recall(rows, args.out / "recall_by_threshold_source.png")
    write_csv(rows, args.out / "comparison.csv")

    results = {
        "smoke_test": args.smoke,
        "selected_model": "Calibrated LR (model v1 setup); model v1 is not replaced",
        "models": rows,
        "deployed_model": deployed,
    }
    (args.out / "comparison.json").write_text(
        json.dumps(results, indent=2) + "\n", encoding="utf-8"
    )
    packages = ["scikit-learn", "numpy", "pandas", "joblib", "scipy", "matplotlib"]
    record = {
        "date_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "git": git_state(),
        "dataset_file": data.name,
        "dataset_sha256": sha256_of(data),
        "rows_used": len(frame),
        "row_sampling": f"every {every_nth}th row" if args.smoke else "all rows",
        "split": {
            "train": "months 0-5",
            "threshold_fit": "months 0-4",
            "threshold_validation": "month 5",
            "test": "months 6-7",
        },
        "features": features,
        "target_fpr": TARGET_FPR,
        "seed": SEED,
        "n_jobs": args.n_jobs,
        "parameters": {name: spec["params"] for name, spec in models.items()},
        "packages": {name: version(name) for name in packages},
        "sklearn_loaded": sklearn.__version__,
        "python": sys.version.split()[0],
        "machine": {
            "system": platform.platform(),
            "processor": platform.processor(),
            "logical_cpus": os.cpu_count(),
        },
        "total_seconds": round(time.perf_counter() - started, 1),
    }
    (args.out / "run_record.json").write_text(
        json.dumps(record, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote results to {args.out}")


if __name__ == "__main__":
    main()
