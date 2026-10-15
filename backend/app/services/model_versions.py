"""Keep model_versions in step with the model that is loaded in memory."""

import logging

from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import get_engine
from app.ml.model_service import ModelState
from app.models import ModelVersion

logger = logging.getLogger(__name__)


def record_active_model(session: Session, state: ModelState) -> ModelVersion:
    """Make the loaded version the single active row. The caller commits."""
    version = state.metadata["model_version"]
    # Deactivate the others first so the one-active-row index is never broken.
    session.execute(
        update(ModelVersion)
        .where(ModelVersion.active, ModelVersion.version != version)
        .values(active=False)
    )
    row = session.get(ModelVersion, version)
    if row is None:
        row = ModelVersion(version=version)
        session.add(row)
    row.loaded_at = state.loaded_at
    row.metrics = dict(state.metadata["metrics_test"])
    row.active = True
    return row


def save_active_model(state: ModelState) -> None:
    """Record a successfully loaded model at startup.

    A database problem here is logged but does not stop the API; the health
    check reports the database separately.
    """
    if state.status != "ok":
        return
    try:
        with Session(get_engine()) as session:
            record_active_model(session, state)
            session.commit()
    except SQLAlchemyError:
        logger.warning(
            "model_version_not_recorded",
            extra={"model_version": state.metadata.get("model_version")},
        )
