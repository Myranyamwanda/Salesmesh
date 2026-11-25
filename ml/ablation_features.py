"""Ablation study: model v1 without name_email_similarity and keep_alive_session.

Supervisor feedback on v1.3.0-rc1 questioned two features:

- name_email_similarity: many genuine users have emails unrelated to their name;
- keep_alive_session: fed by the "Keep me signed in" box, which /join may drop.

This script retrains model v1's exact setup without them and measures the
effect. It changes nothing in the app, the deployed model, or the notebooks.

Method (identical to compare_models.py and assisted_threshold.py):

- Pipeline: median imputation with missing indicators, scaling, one-hot for
  source and device_os; LogisticRegression(C=0.01, class_weight="balanced"),
  sigmoid calibration (cv=3, ensemble=False).
- Ranking metrics and Brier score: fitted on months 0-5, scored on months 6-7.
- Threshold metrics: fitted on months 0-4, 5% FPR threshold chosen on month 5,
  measured on months 6-7, so the test months play no part.
- Assisted mode: the same months 0-4 model, scored through the deployed input
  rules (clipped to the training range, date-of-birth count missing) with the
  device features withheld; threshold at 5% FPR on month 5.

Run it with ml/.venv (see ml/RUN_RECORD.md), keeping Base.csv outside the repo:

    ml\\.venv\\Scripts\\python.exe ml\\ablation_features.py --data <Base.csv>
"""

import argparse
import json
import platform
import sys
import time
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from compare_models import (
    LABEL,
    METADATA,
    OLDER_AGE,
    SEED,
    TARGET_FPR,
    at_threshold,
    build_pipeline,
    git_state,
    load_data,
    sha256_of,
    threshold_at_fpr,
)
from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "ml" / "results" / "v1.4.0"

# Copies of backend/app/ml/features.py, so this script needs only ml/.venv.
ASSISTED_UNKNOWN = (
    "session_length_in_minutes",
    "device_os",
    "keep_alive_session",
    "device_distinct_emails_8w",
)
NOT_SENT_TO_MODEL = ("date_of_birth_distinct_emails_4w",)

SIMILARITY = "name_email_similarity"
KEEP_ALIVE = "keep_alive_session"
LOW_SIMILARITY = 0.2
DEPLOYED_THRESHOLD = 0.035
BOOTSTRAP_ROUNDS = 200
VARIANTS = {
    "v1 (13 features)": (),
    "without name_email_similarity": (SIMILARITY,),
    "without keep_alive_session": (KEEP_ALIVE,),
    "without both (11 features)": (SIMILARITY, KEEP_ALIVE),
}


def calibrated_lr(features: list[str]) -> CalibratedClassifierCV:
    """Model v1's setup, as in compare_models.candidates()."""
    return CalibratedClassifierCV(
        build_pipeline(
            LogisticRegression(C=0.01, class_weight="balanced", max_iter=2000),
            features,
            scale=True,
        ),
        method="sigmoid",
        cv=3,
        ensemble=False,
    )


def deployed_inputs(frame, features, metadata) -> pd.DataFrame:
    """The backend's model_input(): clip to the training range, drop DOB count."""
    rows = frame[features].copy()
    for name, limits in metadata["numeric_ranges"].items():
        if name in features:
            rows[name] = rows[name].astype(float).clip(limits["min"], limits["max"])
    for name in NOT_SENT_TO_MODEL:
        rows[name] = np.nan
    return rows


def withhold(rows: pd.DataFrame) -> pd.DataFrame:
    """Assisted mode: the device features the variant still uses become missing."""
    rows = rows.copy()
    for name in ASSISTED_UNKNOWN:
        if name in rows:
            rows[name] = None if name == "device_os" else np.nan
    return rows


def ranking(labels, scores) -> dict:
    return {
        "roc_auc": roc_auc_score(labels, scores),
        "pr_auc": average_precision_score(labels, scores),
        "brier": brier_score_loss(labels, scores),
    }


def low_similarity(test, scores, threshold) -> dict:
    """Flags among test rows whose email looks unrelated to the name."""
    low = test[SIMILARITY].to_numpy() < LOW_SIMILARITY
    genuine = test[LABEL].to_numpy() == 0
    flagged = scores >= threshold

    def group(mask) -> dict:
        honest, fraud = mask & genuine, mask & ~genuine
        return {
            "rows": int(mask.sum()),
            "honest": int(honest.sum()),
            "fraud": int(fraud.sum()),
            "flagged": int((flagged & mask).sum()),
            "honest_flagged": int((flagged & honest).sum()),
            "fpr": float(flagged[honest].mean()),
            "recall": float(flagged[fraud].mean()),
        }

    return {
        "threshold": threshold,
        f"similarity_below_{LOW_SIMILARITY}": group(low),
        f"similarity_{LOW_SIMILARITY}_or_more": group(~low),
        "share_of_all_honest_flags": float(
            (flagged & genuine & low).sum() / (flagged & genuine).sum()
        ),
    }


def similarity_distribution(frame) -> dict:
    """name_email_similarity for fraud vs legitimate rows."""
    edges = np.linspace(0, 1, 11)
    result = {}
    for label, name in ((0, "legitimate"), (1, "fraud")):
        values = frame.loc[frame[LABEL] == label, SIMILARITY].to_numpy()
        counts, _ = np.histogram(values, bins=edges)
        result[name] = {
            "rows": len(values),
            "mean": float(values.mean()),
            "quantiles": {
                f"p{q}": float(np.quantile(values, q / 100))
                for q in (10, 25, 50, 75, 90)
            },
            f"share_below_{LOW_SIMILARITY}": float((values < LOW_SIMILARITY).mean()),
            "histogram_share": {
                f"{low:.1f}-{high:.1f}": float(count / len(values))
                for low, high, count in zip(edges[:-1], edges[1:], counts, strict=True)
            },
        }
    return result


def coefficients(model) -> dict:
    """Standardised LR weights of the two features (first calibration fold)."""
    pipeline = model.calibrated_classifiers_[0].estimator
    names = pipeline.named_steps["prep"].get_feature_names_out()
    weights = pipeline.named_steps["model"].coef_[0]
    return {
        name: round(float(weight), 4)
        for name, weight in zip(names, weights, strict=True)
        if SIMILARITY in name or KEEP_ALIVE in name
    }


def run_variant(name, dropped, frame, all_features, metadata) -> tuple[dict, dict]:
    features = [f for f in all_features if f not in dropped]
    train = frame[frame["month"] <= 5]
    fit = frame[frame["month"] <= 4]
    validation = frame[frame["month"] == 5]
    test = frame[frame["month"] >= 6]
    y_test = test[LABEL].to_numpy()
    older = test["customer_age"].to_numpy() >= OLDER_AGE

    started = time.perf_counter()
    print(f"{name}: fitting on months 0-5", flush=True)
    full = calibrated_lr(features).fit(train[features], train[LABEL])
    full_scores = full.predict_proba(test[features])[:, 1]

    print(f"{name}: fitting on months 0-4", flush=True)
    early = calibrated_lr(features).fit(fit[features], fit[LABEL])
    early_scores = early.predict_proba(test[features])[:, 1]
    threshold = threshold_at_fpr(
        validation[LABEL], early.predict_proba(validation[features])[:, 1]
    )

    def assisted(rows):
        return early.predict_proba(withhold(deployed_inputs(rows, features, metadata)))[
            :, 1
        ]

    assisted_threshold = threshold_at_fpr(validation[LABEL], assisted(validation))
    assisted_scores = assisted(test)

    result = {
        "features": features,
        "dropped": list(dropped),
        "months_0_5_model": ranking(y_test, full_scores)
        | {"coefficients": coefficients(full)},
        "validation_threshold": at_threshold(y_test, early_scores, older, threshold)
        | ranking(y_test, early_scores),
        "assisted": {
            "withheld": [f for f in ASSISTED_UNKNOWN if f in features],
            **at_threshold(y_test, assisted_scores, older, assisted_threshold),
            "roc_auc": roc_auc_score(y_test, assisted_scores),
        },
        "low_similarity_at_validation_threshold": low_similarity(
            test, early_scores, threshold
        ),
        "seconds": round(time.perf_counter() - started, 1),
    }
    if not dropped:
        # The months 0-5 refit reproduces the deployed model to ~1e-12
        # (RUN_RECORD.md), so this is model v1 as deployed at 0.035.
        result["low_similarity_at_deployed_threshold"] = low_similarity(
            test, full_scores, DEPLOYED_THRESHOLD
        )
    scores = {
        "full": full_scores,
        "early": early_scores,
        "threshold": threshold,
        "assisted": assisted_scores,
        "assisted_threshold": assisted_threshold,
    }
    return result, scores


def bootstrap_differences(y_test, scores: dict) -> dict:
    """Paired bootstrap (test rows) of each variant minus v1: 95% intervals."""
    rng = np.random.default_rng(SEED)
    genuine = y_test == 0
    base = scores["v1 (13 features)"]

    def stats(s, rows):
        y, honest = y_test[rows], genuine[rows]
        flags = s["early"][rows] >= s["threshold"]
        assisted = s["assisted"][rows] >= s["assisted_threshold"]
        return np.array(
            [
                roc_auc_score(y, s["full"][rows]),
                flags[~honest].mean(),
                flags[honest].mean(),
                assisted[~honest].mean(),
            ]
        )

    names = ["roc_auc", "recall", "fpr", "assisted_recall"]
    size = len(y_test)
    samples = [rng.integers(0, size, size) for _ in range(BOOTSTRAP_ROUNDS)]
    base_stats = [stats(base, rows) for rows in samples]
    everything = np.arange(len(y_test))
    result = {}
    for name, s in scores.items():
        if s is base:
            continue
        diffs = np.array(
            [stats(s, rows) - b for rows, b in zip(samples, base_stats, strict=True)]
        )
        point = stats(s, everything) - stats(base, everything)
        result[name] = {
            metric: {
                "difference": float(point[i]),
                "ci95": [
                    float(np.quantile(diffs[:, i], 0.025)),
                    float(np.quantile(diffs[:, i], 0.975)),
                ],
            }
            for i, metric in enumerate(names)
        }
    return result


def pct(value) -> str:
    return "none" if value is None else f"{100 * value:.1f}%"


def write_markdown(results: dict, target: Path) -> None:
    rows = results["variants"]
    lines = [
        "# Feature ablation (v1.4.0 evidence)",
        "",
        "Generated by `ml/ablation_features.py`; model v1 is unchanged. "
        "Test months 6-7; thresholds chosen at 5% FPR on month 5 "
        "(model fitted on months 0-4). ROC-AUC, PR-AUC and Brier from the "
        "months 0-5 fit. FPR ratio = lower age group's FPR / higher one's "
        f"(under {OLDER_AGE} vs {OLDER_AGE}+); 1.0 is equal.",
        "",
        "| Variant | ROC-AUC | PR-AUC | Brier | Recall | Precision | FPR "
        "| FPR ratio | Assisted recall | Assisted FPR |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for name, row in rows.items():
        full, val, asst = (
            row["months_0_5_model"],
            row["validation_threshold"],
            row["assisted"],
        )
        lines.append(
            f"| {name} | {full['roc_auc']:.4f} | {full['pr_auc']:.4f} "
            f"| {full['brier']:.4f} | {pct(val['recall'])} | {pct(val['precision'])} "
            f"| {pct(val['fpr'])} | {val['fpr_ratio']:.3f} | {pct(asst['recall'])} "
            f"| {pct(asst['fpr'])} |"
        )
    lines += [
        "",
        "## Difference from v1 (paired bootstrap, 95% interval, "
        f"{BOOTSTRAP_ROUNDS} rounds)",
        "",
        "| Variant | ROC-AUC | Recall | FPR | Assisted recall |",
        "| --- | --- | --- | --- | --- |",
    ]
    for name, diff in results["bootstrap_vs_v1"].items():
        cells = []
        for metric, scale, digits in (
            ("roc_auc", 1, 4),
            ("recall", 100, 1),
            ("fpr", 100, 2),
            ("assisted_recall", 100, 1),
        ):
            d = diff[metric]
            low, high = (scale * v for v in d["ci95"])
            unit = "" if scale == 1 else " pt"
            cells.append(
                f"{scale * d['difference']:+.{digits}f}{unit} "
                f"[{low:+.{digits}f}, {high:+.{digits}f}]"
            )
        lines.append(f"| {name} | " + " | ".join(cells) + " |")

    dist = results["v1_similarity_distribution_test_months"]
    lines += [
        "",
        "## name_email_similarity in the test months (BAF)",
        "",
        "| Group | Rows | Mean | p10 | p25 | Median | p75 | p90 "
        f"| Below {LOW_SIMILARITY} |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for group, d in dist.items():
        q = d["quantiles"]
        lines.append(
            f"| {group} | {d['rows']:,} | {d['mean']:.3f} | {q['p10']:.3f} "
            f"| {q['p25']:.3f} | {q['p50']:.3f} | {q['p75']:.3f} | {q['p90']:.3f} "
            f"| {pct(d[f'share_below_{LOW_SIMILARITY}'])} |"
        )
    low_key = f"similarity_below_{LOW_SIMILARITY}"
    high_key = f"similarity_{LOW_SIMILARITY}_or_more"
    lines += [
        "",
        f"## Honest users with similarity below {LOW_SIMILARITY}",
        "",
        "| Model, threshold | Low-sim rows | Low-sim honest | Honest flagged "
        "| FPR low-sim | FPR other | Recall low-sim | Share of all honest flags |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    v1 = rows["v1 (13 features)"]
    entries = [("v1, deployed 0.035", v1["low_similarity_at_deployed_threshold"])]
    entries += [
        (f"{name}, validation", row["low_similarity_at_validation_threshold"])
        for name, row in rows.items()
    ]
    for label, entry in entries:
        low, high = entry[low_key], entry[high_key]
        lines.append(
            f"| {label} | {low['rows']:,} | {low['honest']:,} "
            f"| {low['honest_flagged']:,} | {pct(low['fpr'])} | {pct(high['fpr'])} "
            f"| {pct(low['recall'])} | {pct(entry['share_of_all_honest_flags'])} |"
        )
    record = results["run_record"]
    lines += [
        "",
        "## Run",
        "",
        f"- Date (UTC): {record['date_utc']}; commit `{record['git']['commit'][:7]}`"
        f"{' (dirty)' if record['git']['dirty'] else ''}",
        f"- Dataset: `{record['dataset_file']}`, SHA-256 `{record['dataset_sha256']}`, "
        f"{record['rows_used']:,} rows",
        f"- Python {record['python']}; "
        + ", ".join(f"{k} {v}" for k, v in record["packages"].items()),
        "",
    ]
    target.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, required=True, help="Path to Base.csv")
    parser.add_argument("--out", type=Path, default=OUT, help="Results folder")
    args = parser.parse_args()

    git = git_state()  # Before any results exist, so they cannot mark it dirty.
    data = args.data.resolve()
    if data.is_relative_to(REPO):
        parser.error("Base.csv must stay outside the repository")

    started = time.perf_counter()
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    all_features = metadata["features"]
    frame = load_data(data, all_features, every_nth=1)
    test = frame[frame["month"] >= 6]

    variants, scores = {}, {}
    for name, dropped in VARIANTS.items():
        variants[name], scores[name] = run_variant(
            name, dropped, frame, all_features, metadata
        )
    print("Bootstrapping differences", flush=True)
    bootstrap = bootstrap_differences(test[LABEL].to_numpy(), scores)

    packages = ["scikit-learn", "numpy", "pandas", "joblib", "scipy"]
    results = {
        "variants": variants,
        "bootstrap_vs_v1": bootstrap,
        "v1_similarity_distribution_test_months": similarity_distribution(test),
        "v1_similarity_distribution_all_months": similarity_distribution(frame),
        "run_record": {
            "date_utc": datetime.now(UTC).isoformat(timespec="seconds"),
            "git": git,
            "dataset_file": data.name,
            "dataset_sha256": sha256_of(data),
            "rows_used": len(frame),
            "split": {
                "ranking_metrics_train": "months 0-5",
                "threshold_fit": "months 0-4",
                "threshold_validation": "month 5",
                "test": "months 6-7",
            },
            "target_fpr": TARGET_FPR,
            "low_similarity_cutoff": LOW_SIMILARITY,
            "model": "LogisticRegression(C=0.01, class_weight=balanced, "
            "max_iter=2000) + sigmoid calibration (cv=3, ensemble=False)",
            "bootstrap_rounds": BOOTSTRAP_ROUNDS,
            "seed": SEED,
            "packages": {name: version(name) for name in packages},
            "sklearn_loaded": sklearn.__version__,
            "python": sys.version.split()[0],
            "machine": platform.platform(),
            "total_seconds": round(time.perf_counter() - started, 1),
        },
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "ablation.json").write_text(
        json.dumps(results, indent=2) + "\n", encoding="utf-8"
    )
    write_markdown(results, args.out / "ablation.md")
    print(f"Wrote results to {args.out}")


if __name__ == "__main__":
    main()
