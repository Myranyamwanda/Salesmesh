"""Assisted mode with model v2: flags plus random audits, against model v1.

An assisted registration withholds the device features (v1: four, v2: three,
because keep_alive_session is gone). It is flagged at the assisted threshold,
and a share of the unflagged ones is picked at random for review (an audit,
scoring_config.audit_share). This script measures both models on BAF test
months 6-7 with the device features withheld, through the deployed input rules
(clipped to the training range, date-of-birth count missing):

- at the assisted threshold alone (flags);
- with audits at 10%, 15% and 20%: the expected share of fraud and of honest
  customers that reach a reviewer, the precision of the review queue, and the
  number of reviews per 1,000 assisted registrations. Expected values are used
  instead of one random draw, so the figures do not depend on luck.

It reads the deployed model files (backend/models/v1 and v2) and changes
nothing. Run with ml/.venv:

    ml\\.venv\\Scripts\\python.exe ml\\assisted_v2.py --data <Base.csv>
"""

import argparse
import json
import platform
import sys
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

import joblib
import numpy as np
from ablation_features import ASSISTED_UNKNOWN, deployed_inputs, withhold
from compare_models import LABEL, OLDER_AGE, git_state, load_data, sha256_of

REPO = Path(__file__).resolve().parent.parent
MODELS = REPO / "backend" / "models"
OUT = REPO / "ml" / "results" / "v1.4.0" / "assisted_v2.json"
# v1's assisted threshold lives in scoring_config (migration 0010); v2's is in
# its metadata.json and is copied to scoring_config by migration 0011.
V1_ASSISTED_THRESHOLD = 0.008039
AUDIT_SHARES = (0.10, 0.15, 0.20)


def at_audit_share(flags, labels, older, share: float) -> dict:
    """Expected outcome when `share` of the unflagged rows are also reviewed."""
    genuine = labels == 0
    reviewed = np.where(flags, 1.0, share)  # chance that each row is reviewed
    fraud_found = reviewed[~genuine].sum()
    honest_reviewed = reviewed[genuine].sum()
    return {
        "audit_share": share,
        "recall": float(fraud_found / (~genuine).sum()),
        "precision": float(fraud_found / reviewed.sum()),
        "fpr": float(honest_reviewed / genuine.sum()),
        "fpr_under_50": float(reviewed[genuine & ~older].mean()),
        "fpr_50_plus": float(reviewed[genuine & older].mean()),
        "reviews_per_1000": float(1000 * reviewed.mean()),
        "flags_per_1000": float(1000 * flags.mean()),
        "audits_per_1000": float(1000 * (reviewed - flags).mean()),
    }


def measure(name, frame, older) -> dict:
    folder = MODELS / name
    metadata = json.loads((folder / "metadata.json").read_text(encoding="utf-8"))
    model = joblib.load(folder / "model.joblib")
    features = metadata["features"]
    threshold = float(metadata.get("assisted_threshold", V1_ASSISTED_THRESHOLD))
    rows = withhold(deployed_inputs(frame, features, metadata))
    scores = model.predict_proba(rows)[:, 1]
    flags = scores >= threshold
    labels = frame[LABEL].to_numpy()
    return {
        "assisted_threshold": threshold,
        "withheld": [name for name in ASSISTED_UNKNOWN if name in features],
        "flags_only": at_audit_share(flags, labels, older, 0.0),
        "with_audits": [
            at_audit_share(flags, labels, older, share) for share in AUDIT_SHARES
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, required=True, help="Path to Base.csv")
    args = parser.parse_args()
    git = git_state()
    data = args.data.resolve()
    if data.is_relative_to(REPO):
        parser.error("Base.csv must stay outside the repository")

    v1 = json.loads((MODELS / "v1" / "metadata.json").read_text(encoding="utf-8"))
    frame = load_data(data, v1["features"], every_nth=1)
    test = frame[frame["month"] >= 6].reset_index(drop=True)
    older = test["customer_age"].to_numpy() >= OLDER_AGE
    results = {
        "data": "BAF test months 6-7, device features withheld, deployed inputs",
        "rows": len(test),
        "fraud": int(test[LABEL].sum()),
        "v1": measure("v1", test, older),
        "v2": measure("v2", test, older),
        "run_record": {
            "date_utc": datetime.now(UTC).isoformat(timespec="seconds"),
            "git": git,
            "dataset_file": data.name,
            "dataset_sha256": sha256_of(data),
            "packages": {
                name: version(name)
                for name in ("scikit-learn", "numpy", "pandas", "joblib")
            },
            "python": sys.version.split()[0],
            "machine": platform.platform(),
        },
    }
    OUT.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8", newline="\n")
    for name in ("v1", "v2"):
        for row in [results[name]["flags_only"], *results[name]["with_audits"]]:
            print(
                f"{name} audit {row['audit_share']:.0%}: recall {row['recall']:.1%}, "
                f"precision {row['precision']:.1%}, FPR {row['fpr']:.1%}, "
                f"reviews/1000 {row['reviews_per_1000']:.0f}"
            )


if __name__ == "__main__":
    main()
