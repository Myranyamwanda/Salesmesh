"""Say how each of the 13 stored features moved one customer's model score.

For administrators only, in the review dialog. A feature can have several model
inputs (a value and a "was missing" indicator, or one input per category), so
its effect is the sum of their contributions from app.ml.explain. Numeric inputs
compare the value with the training average. The categories of source and
device_os are not centred, so for those the sign only follows the coefficient
of the category.

Effects use the model that produced the score. If that model is not the one
loaded now, they are "unavailable" rather than taken from a different model.
"""

from collections.abc import Mapping
from typing import Any, Literal

from app.ml.explain import contributions
from app.ml.features import ASSISTED_UNKNOWN, NOT_SENT_TO_MODEL, model_input
from app.ml.model_service import ModelState

type FeatureEffect = Literal[
    "raised",
    "lowered",
    "no_effect",
    "not_used_bank_scale",
    "not_used_assisted",
    "unavailable",
]

# A total this close to zero (in log-odds) is reported as no effect.
NO_EFFECT_BELOW = 0.01


def source_feature(code: str, metadata: Mapping[str, Any]) -> str:
    """Return the raw feature behind a name from get_feature_names_out()."""
    name = code.split("__", 1)[1].removeprefix("missingindicator_")
    if code.startswith("cat__"):
        return next(
            feature for feature in metadata["categorical_features"]
            if name.startswith(f"{feature}_")
        )  # fmt: skip
    return name


def score_totals(
    state: ModelState, model_version: str, features: Mapping[str, Any]
) -> dict[str, float]:
    """Total contribution per feature, or nothing if it cannot be worked out."""
    metadata = state.metadata
    if (
        state.status != "ok"
        or metadata.get("model_version") != model_version
        or set(features) != set(metadata["features"])
    ):
        return {}
    prepared = model_input(dict(features), metadata["numeric_ranges"])
    totals = dict.fromkeys(metadata["features"], 0.0)
    for code, value in contributions(state.model, metadata, prepared).items():
        totals[source_feature(code, metadata)] += float(value)
    return totals


def direction(total: float) -> FeatureEffect:
    if abs(total) < NO_EFFECT_BELOW:
        return "no_effect"
    return "raised" if total > 0 else "lowered"


def feature_effects(
    state: ModelState,
    model_version: str,
    features: Mapping[str, Any],
    assisted: bool,
) -> dict[str, FeatureEffect]:
    totals = score_totals(state, model_version, features)
    effects: dict[str, FeatureEffect] = {}
    for name in features:
        if name in NOT_SENT_TO_MODEL:
            effects[name] = "not_used_bank_scale"
        elif assisted and name in ASSISTED_UNKNOWN:
            effects[name] = "not_used_assisted"
        elif name in totals:
            effects[name] = direction(totals[name])
        else:
            effects[name] = "unavailable"
    return effects
