"""Score a customer with the fraud model plus transparent rules.

Hybrid approach:
- The model scores the clipped features. It flags when probability >= threshold.
- Rules catch extreme values the model never saw in training, because clipping
  hides them from the model. A rule can flag on its own.

Each reason records its "source" ("model" or "rule"), so a reviewer can see
why a customer was flagged: the model flagged if probability >= threshold, and
a rule flagged if a reason has source "rule".
"""

from typing import Any

from sqlalchemy.orm import Session

from app.ml.explain import explain
from app.ml.features import model_input
from app.ml.model_service import ModelService, predict_probability
from app.models import Customer, ModelVersion, RiskAssessment, ScoringConfig
from app.services.model_versions import record_active_model


def device_email_rule(features: dict[str, Any], rule_min: int) -> dict[str, Any] | None:
    """Flag a device used for at least rule_min distinct emails in 8 weeks.

    Uses the raw value, because the model only sees it clipped to the training
    max of 2. Assisted registrations have no device value, so never trigger it.
    """
    emails = features["device_distinct_emails_8w"]
    if emails is None or emails < rule_min:
        return None
    return {
        "source": "rule",
        "code": "rule__device_distinct_emails_8w",
        "text": f"This device was used for {emails} different email addresses "
        "in 8 weeks",
    }


def score_customer(
    session: Session,
    model_service: ModelService,
    customer: Customer,
    features: dict[str, Any],
) -> RiskAssessment:
    """Create a risk assessment and set the customer's status. The caller commits.

    features is the raw snapshot that is stored; model_input() prepares the
    copy the model sees. Raises ModelUnavailableError when the model is not ok.
    """
    # One state for the whole call, so probability and threshold always match.
    state = model_service.ready_state()
    version = state.metadata["model_version"]
    if session.get(ModelVersion, version) is None:
        record_active_model(session, state)
    config = session.get(ScoringConfig, 1)

    prepared = model_input(features, state.metadata["numeric_ranges"])
    probability = predict_probability(state.model, state.metadata, prepared)
    threshold = float(state.metadata["threshold"])
    rule_reason = device_email_rule(features, config.device_email_rule_min)
    rule_reasons = [rule_reason] if rule_reason else []
    flagged = probability >= threshold or bool(rule_reasons)
    assessment = RiskAssessment(
        customer_id=customer.id,
        model_version=version,
        probability=probability,
        threshold=threshold,
        flagged=flagged,
        reasons=rule_reasons + explain(state.model, state.metadata, prepared),
        features=features,
    )
    session.add(assessment)
    customer.status = "pending_review" if flagged else "verified"
    return assessment
