"""Explain a model score with the features that pushed it up the most.

The model is a logistic regression on standardised inputs, so each input's
contribution to the score is simply (transformed value) x (coefficient). A
positive contribution means the value is on the fraud side of the training
average. Each code therefore needs only one sentence, written for that
direction.

Reasons are for administrators only and are never shown to agents or
customers.
"""

from collections.abc import Mapping
from typing import Any

import numpy as np

from app.ml.model_service import feature_frame

# Keys are the exact names from prep.get_feature_names_out(). None means the
# code is never shown: its positive direction is not a sign of fraud (for
# example "the current address was provided"), or the feature is not sent to
# the model (date_of_birth_distinct_emails_4w is always imputed).
REASON_TEXTS: dict[str, str | None] = {
    "num__name_email_similarity": "Name and email address are not similar",
    "num__prev_address_months_count": "Long time at the previous address",
    "num__current_address_months_count": "Long time at the current address",
    "num__date_of_birth_distinct_emails_4w": None,
    "num__email_is_free": "Uses a free email provider",
    "num__phone_home_valid": "No valid secondary phone number",
    "num__phone_mobile_valid": "Mobile number is not valid",
    "num__foreign_request": "Request came from a different country than the one given",
    "num__session_length_in_minutes": "Long time spent filling in the form",
    "num__keep_alive_session": "Did not choose to stay signed in",
    "num__device_distinct_emails_8w": (
        "This device was used for several email addresses"
    ),
    "num__missingindicator_prev_address_months_count": "No previous address provided",
    "num__missingindicator_current_address_months_count": None,
    "num__missingindicator_session_length_in_minutes": (
        "Time spent on the form was not measured"
    ),
    "num__missingindicator_device_distinct_emails_8w": None,
    "cat__source_INTERNET": None,
    "cat__source_TELEAPP": "Registered through the phone application",
    "cat__device_os_linux": "Registered from a Linux computer",
    "cat__device_os_macintosh": "Registered from a Mac computer",
    "cat__device_os_other": "Registered from a phone or other device",
    "cat__device_os_windows": "Registered from a Windows computer",
    "cat__device_os_x11": "Registered from an X11 (Unix-like) computer",
}


def contributions(
    model: Any, metadata: Mapping[str, Any], features: Mapping[str, Any]
) -> dict[str, float]:
    """Return each transformed input's contribution to the logistic score."""
    # The calibrated wrapper holds one fitted Pipeline (ensemble=False).
    pipeline = model.calibrated_classifiers_[0].estimator
    prep = pipeline.named_steps["prep"]
    transformed = prep.transform(feature_frame(metadata, features))
    values = np.asarray(
        transformed.toarray() if hasattr(transformed, "toarray") else transformed
    )[0]
    weights = pipeline.named_steps["model"].coef_[0]
    return dict(zip(prep.get_feature_names_out(), values * weights, strict=True))


def explain(
    model: Any, metadata: Mapping[str, Any], features: Mapping[str, Any], top: int = 3
) -> list[dict[str, Any]]:
    """Return up to `top` reasons, largest positive contribution first."""
    ranked = sorted(
        contributions(model, metadata, features).items(),
        key=lambda item: item[1],
        reverse=True,
    )
    reasons = []
    for code, contribution in ranked:
        if contribution <= 0 or len(reasons) == top:
            break
        text = REASON_TEXTS.get(code)
        if text is not None:
            reasons.append(
                {
                    "source": "model",
                    "code": code,
                    "text": text,
                    "contribution": round(float(contribution), 4),
                }
            )
    return reasons
