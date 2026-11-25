"""Measure what withholding the four device features does to model v1's scores.

Assisted registrations (an agent registers the customer on the agent's device)
send session_length_in_minutes, device_os, keep_alive_session, and
device_distinct_emails_8w as missing. The model then imputes the training
median and, for two of them, sets a "was missing" indicator. This script
measures the effect, read-only:

- demo: replays demo seeding (same seed, same rows, same assisted choice) and
  scores each customer exactly as the backend does;
- baf: scores the BAF test months (6-7) twice, as entered and withheld.

Run with the backend environment, because it reuses the backend's own scoring
code (see ml/RUN_RECORD.md):

    backend\\.venv\\Scripts\\python.exe ml\\assisted_withholding.py --data <Base.csv>
"""

import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))

from app.demo import DemoPlan, assign_rows, read_sample  # noqa: E402
from app.ml.explain import REASON_TEXTS, contributions, explain  # noqa: E402
from app.ml.feature_effects import source_feature  # noqa: E402
from app.ml.features import ASSISTED_UNKNOWN, NOT_SENT_TO_MODEL  # noqa: E402
from app.ml.model_service import CHECKSUM_DIR, load_folder  # noqa: E402

MODEL_DIR = REPO / "backend" / "models" / "v1"
OUT = REPO / "ml" / "results" / "v1.3.0" / "assisted_withholding.json"
NEGATIVE_IS_MISSING = [
    "prev_address_months_count",
    "current_address_months_count",
    "session_length_in_minutes",
    "device_distinct_emails_8w",
]
INDICATOR = "num__missingindicator_session_length_in_minutes"
LABEL = "fraud_bool"


def prepare(frame: pd.DataFrame, metadata) -> pd.DataFrame:
    """The backend's model_input(), for many rows: clip, then drop the DOB count."""
    frame = frame[metadata["features"]].copy()
    for name, limits in metadata["numeric_ranges"].items():
        frame[name] = frame[name].astype(float).clip(limits["min"], limits["max"])
    for name in NOT_SENT_TO_MODEL:
        frame[name] = np.nan
    return frame


def withhold(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    for name in ASSISTED_UNKNOWN:
        frame[name] = None if name == "device_os" else np.nan
    return frame


def flag_summary(probabilities, flags, labels=None) -> dict:
    summary = {
        "rows": int(len(flags)),
        "flag_rate": float(flags.mean()),
        "mean_probability": float(probabilities.mean()),
        "max_probability": float(probabilities.max()),
    }
    if labels is not None:
        genuine = labels == 0
        summary["false_positive_rate"] = float(flags[genuine].mean())
        summary["recall"] = float(flags[~genuine].mean())
    return summary


def logit_change_by_feature(model, metadata, before, after) -> dict:
    """Mean change in each feature's contribution to the logistic score."""
    pipeline = model.calibrated_classifiers_[0].estimator
    prep = pipeline.named_steps["prep"]
    weights = pipeline.named_steps["model"].coef_[0]
    names = prep.get_feature_names_out()
    change = (prep.transform(after) - prep.transform(before)).mean(axis=0) * weights
    totals: dict[str, float] = {}
    for name, value in zip(names, change, strict=True):
        feature = source_feature(name, metadata)
        totals[feature] = totals.get(feature, 0.0) + float(value)
    return {name: round(totals[name], 4) for name in ASSISTED_UNKNOWN}


def compare(model, metadata, raw: pd.DataFrame, labels=None) -> dict:
    threshold = float(metadata["threshold"])
    before = prepare(raw, metadata)
    after = withhold(before)
    p_before = model.predict_proba(before)[:, 1]
    p_after = model.predict_proba(after)[:, 1]
    change = p_after - p_before
    return {
        "as_entered": flag_summary(p_before, p_before >= threshold, labels),
        "withheld": flag_summary(p_after, p_after >= threshold, labels),
        "probability_change": {
            "mean": float(change.mean()),
            "median": float(np.median(change)),
            "mean_relative": float((p_after / p_before).mean()),
            "share_raised": float((change > 0).mean()),
        },
        "newly_flagged_share": float(
            ((p_after >= threshold) & (p_before < threshold)).mean()
        ),
        "no_longer_flagged_share": float(
            ((p_after < threshold) & (p_before >= threshold)).mean()
        ),
        "mean_logit_change_by_feature": logit_change_by_feature(
            model, metadata, before, after
        ),
    }


def demo_customers() -> pd.DataFrame:
    """Replay seed_demo()'s generator calls to get each customer and its mode."""
    plan = DemoPlan()
    rng = random.Random(plan.seed)
    records = []
    for agent_rows in assign_rows(read_sample(), plan, rng).values():
        for row in agent_rows:
            rng.uniform(0, plan.history_days * 86400)  # created_at
            assisted = rng.random() < plan.assisted_share
            records.append(row.features | {"assisted": assisted, LABEL: row.fraud_bool})
    return pd.DataFrame(records)


def demo_report(model, metadata) -> dict:
    customers = demo_customers()
    threshold = float(metadata["threshold"])
    frame = prepare(customers, metadata)
    frame.loc[customers["assisted"], list(ASSISTED_UNKNOWN)] = np.nan
    frame["device_os"] = frame["device_os"].astype(object)
    frame.loc[customers["assisted"], "device_os"] = None
    probabilities = model.predict_proba(frame)[:, 1]
    flags = probabilities >= threshold
    assisted = customers["assisted"].to_numpy()
    labels = customers[LABEL].to_numpy()

    # Where the "not measured" reason comes from among flagged customers.
    session_reason = {"assisted": 0, "not_assisted": 0}
    for index in np.flatnonzero(flags):
        features = {
            name: (None if pd.isna(value) else value)
            for name, value in frame.iloc[index].items()
        }
        codes = [reason["code"] for reason in explain(model, metadata, features)]
        if INDICATOR in codes:
            session_reason["assisted" if assisted[index] else "not_assisted"] += 1
    # Reasons are stored for every customer, flagged or not.
    assisted_rows = np.flatnonzero(assisted)
    assisted_with_reason = sum(
        INDICATOR
        in [
            reason["code"]
            for reason in explain(
                model,
                metadata,
                {
                    name: (None if pd.isna(value) else value)
                    for name, value in frame.iloc[index].items()
                },
            )
        ]
        for index in assisted_rows
    )
    session_missing_in_sample = int(
        (customers["session_length_in_minutes"].isna() & ~customers["assisted"]).sum()
    )
    return {
        "customers": len(customers),
        "assisted": flag_summary(
            probabilities[assisted], flags[assisted], labels[assisted]
        ),
        "not_assisted": flag_summary(
            probabilities[~assisted], flags[~assisted], labels[~assisted]
        ),
        "flagged_with_session_reason": session_reason,
        "flagged_not_assisted": int((flags & ~assisted).sum()),
        "assisted_with_session_reason_in_top_3": int(assisted_with_reason),
        "not_assisted_with_session_missing_in_dataset": session_missing_in_sample,
        "same_rows_both_ways": compare(model, metadata, customers, labels),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, required=True, help="Path to Base.csv")
    args = parser.parse_args()
    if args.data.resolve().is_relative_to(REPO):
        parser.error("Base.csv must stay outside the repository")

    state = load_folder(MODEL_DIR, "local", CHECKSUM_DIR)
    if state.status != "ok":
        sys.exit(f"Model not ok: {state.error}")
    model, metadata = state.model, state.metadata

    baf = pd.read_csv(args.data, usecols=[*metadata["features"], LABEL, "month"])
    for name in NEGATIVE_IS_MISSING:
        baf.loc[baf[name] < 0, name] = np.nan
    test = baf[baf["month"] >= 6].reset_index(drop=True)

    missing = dict.fromkeys(metadata["features"]) | {"source": "INTERNET"}
    weights = contributions(model, metadata, missing)
    results = {
        "model_version": metadata["model_version"],
        "threshold": float(metadata["threshold"]),
        "withheld_features": list(ASSISTED_UNKNOWN),
        "session_reason_text": REASON_TEXTS[INDICATOR],
        "session_indicator_contribution_when_missing": round(
            float(weights[INDICATOR]), 4
        ),
        "demo": demo_report(model, metadata),
        "baf_test_months": compare(model, metadata, test, test[LABEL].to_numpy()),
    }
    OUT.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
