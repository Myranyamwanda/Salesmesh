"""Explain a model score with the features that pushed it up the most.

The model is a logistic regression on standardised inputs, so each input's
contribution to the score is simply (transformed value) x (coefficient). A
positive contribution means the value is on the fraud side of the training
average. Each code therefore needs only one sentence, written for that
direction.

Reasons are for administrators only and are never shown to agents or
customers. Device and session reasons describe a pattern in the training
data ("... was more common in past fraud cases"), not an accusation: a value
like "Windows computer" is common among genuine customers too.
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
    "num__prev_address_months_count": "Long time at the previous address",
    "num__current_address_months_count": "Long time at the current address",
    "num__date_of_birth_distinct_emails_4w": None,
    "num__email_is_free": "Uses a free email provider",
    "num__phone_home_valid": "No valid secondary phone number",
    "num__phone_mobile_valid": "Mobile number is not valid",
    "num__foreign_request": "Request came from a different country than the one given",
    "num__session_length_in_minutes": (
        "A long time on the form was more common in past fraud cases"
    ),
    "num__device_distinct_emails_8w": (
        "Devices used for several email addresses were more common in past fraud cases"
    ),
    "num__missingindicator_prev_address_months_count": "No previous address provided",
    "num__missingindicator_current_address_months_count": None,
    "num__missingindicator_session_length_in_minutes": (
        "Time spent on the form was not measured"
    ),
    "num__missingindicator_device_distinct_emails_8w": None,
    "cat__source_INTERNET": None,
    "cat__source_TELEAPP": "Registered through the phone application",
    "cat__device_os_linux": (
        "Device type (Linux computer) was more common in past fraud cases"
    ),
    "cat__device_os_macintosh": (
        "Device type (Mac computer) was more common in past fraud cases"
    ),
    "cat__device_os_other": (
        "Device type (phone or other device) was more common in past fraud cases"
    ),
    "cat__device_os_windows": (
        "Device type (Windows computer) was more common in past fraud cases"
    ),
    "cat__device_os_x11": (
        "Device type (X11 Unix-like computer) was more common in past fraud cases"
    ),
}


def with_current_texts(reasons: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Show stored model reasons with today's wording.

    Each assessment keeps the reasons it was scored with; only the sentence
    shown for a model reason code follows REASON_TEXTS, so earlier assessments
    get reworded texts too. Rule and audit reasons are returned unchanged.
    """
    shown = []
    for reason in reasons:
        text = (
            REASON_TEXTS.get(reason.get("code", ""))
            if reason.get("source") == "model"
            else None
        )
        shown.append({**reason, "text": text} if text else reason)
    return shown


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
