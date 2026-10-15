"""Download the exported model files from S3.

Local mode needs no code here: the files are read straight from MODEL_DIR.
"""

from pathlib import Path

import boto3

from app.core.config import Settings

MODEL_FILES = ("model.joblib", "metadata.json", "golden_examples.json")


class ModelSourceError(RuntimeError):
    """Raised when the model files cannot be fetched."""


def download_from_s3(settings: Settings, destination: Path) -> None:
    """Copy the model files from MODEL_S3_BUCKET/MODEL_S3_PREFIX into destination.

    Credentials left empty fall back to boto3's default chain (environment
    variables, AWS profile, or an instance role). They should be read-only.
    """
    if not settings.model_s3_bucket:
        raise ModelSourceError("MODEL_S3_BUCKET is required when MODEL_SOURCE=s3")
    secret = settings.aws_secret_access_key
    client = boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=secret.get_secret_value() if secret else None,
    )
    prefix = settings.model_s3_prefix.strip("/")
    for name in MODEL_FILES:
        key = f"{prefix}/{name}" if prefix else name
        try:
            client.download_file(settings.model_s3_bucket, key, str(destination / name))
        except Exception as exc:
            raise ModelSourceError(f"Could not download {name} from S3") from exc
