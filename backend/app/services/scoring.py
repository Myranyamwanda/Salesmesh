"""Score a customer with the fraud model and store the assessment."""

from typing import Any

from sqlalchemy.orm import Session

from app.ml.explain import explain
from app.ml.features import model_input
from app.ml.model_service import ModelService, predict_probability
from app.models import Customer, ModelVersion, RiskAssessment
from app.services.model_versions import record_active_model


def score_customer(
    session: Session,
    model_service: ModelService,
    customer: Customer,
    features: dict[str, Any],
) -> RiskAssessment:
    """Create a risk assessment and set the customer's status. The caller commits.

    features is the raw snapshot; model_input() prepares it for the model.
    Raises ModelUnavailableError when the model is not ok.
    """
    # One state for the whole call, so probability and threshold always match.
    state = model_service.ready_state()
    version = state.metadata["model_version"]
    if session.get(ModelVersion, version) is None:
        record_active_model(session, state)

    prepared = model_input(features)
    probability = predict_probability(state.model, state.metadata, prepared)
    threshold = float(state.metadata["threshold"])
    flagged = probability >= threshold
    assessment = RiskAssessment(
        customer_id=customer.id,
        model_version=version,
        probability=probability,
        threshold=threshold,
        flagged=flagged,
        reasons=explain(state.model, state.metadata, prepared),
        features=features,
    )
    session.add(assessment)
    customer.status = "pending_review" if flagged else "verified"
    return assessment
