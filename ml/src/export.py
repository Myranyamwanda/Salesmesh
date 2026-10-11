"""Save the trained model and its metadata to ml/artifacts/.

Output contract (read by backend/app/ml/scoring.py):

- a saved model file, for example ml/artifacts/model.<format>
- ml/artifacts/metadata.json with exactly these keys:
    feature_names: list of input feature names, in model order
    model_version: version string for the trained model
    threshold:     decision cut-off chosen during evaluation
    metrics:       object mapping metric names to numeric values

ml/artifacts/ is ignored by Git, so generated models are never committed.
"""

from pathlib import Path

ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts"


def export_model(
    model,
    feature_names,
    model_version,
    threshold,
    metrics,
    output_dir: Path = ARTIFACTS_DIR,
):
    """Write the model file and metadata.json described above.

    TODO: Pick the serialisation format once the training library is chosen.
    """
    raise NotImplementedError("Model export is not implemented yet")
