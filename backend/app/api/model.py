from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.auth import Configuration, Database, require_roles
from app.ml.model_service import ModelService, ModelState, get_model_service
from app.models import User
from app.services.audit import audit
from app.services.model_versions import record_active_model

router = APIRouter(prefix="/admin", tags=["Model"])
type Admin = Annotated[User, Depends(require_roles("admin"))]
type Models = Annotated[ModelService, Depends(get_model_service)]


class GoldenCheckRead(BaseModel):
    passed: bool
    checked: int
    failed: int
    max_difference: float
    tolerance: float


class ModelRead(BaseModel):
    status: Literal["ok", "failed"]
    error: str | None
    source: str
    loaded_at: datetime | None
    model_name: str | None
    model_version: str | None
    model_type: str | None
    sklearn_version: str | None
    threshold: float | None
    metrics: dict[str, float]
    golden_check: GoldenCheckRead | None


def model_read(state: ModelState) -> ModelRead:
    metadata = state.metadata
    golden = state.golden
    return ModelRead(
        status=state.status,
        error=state.error,
        source=state.source,
        loaded_at=state.loaded_at,
        model_name=metadata.get("model_name"),
        model_version=metadata.get("model_version"),
        model_type=metadata.get("model_type"),
        sklearn_version=metadata.get("sklearn_version"),
        threshold=metadata.get("threshold"),
        metrics=metadata.get("metrics_test", {}),
        golden_check=None
        if golden is None
        else GoldenCheckRead(
            passed=golden.passed,
            checked=golden.checked,
            failed=golden.failed,
            max_difference=golden.max_difference,
            tolerance=golden.tolerance,
        ),
    )


@router.get("/model", response_model=ModelRead)
def read_model(_: Admin, model_service: Models) -> ModelRead:
    return model_read(model_service.state)


@router.post("/model/reload", response_model=ModelRead)
def reload_model(
    request: Request,
    session: Database,
    settings: Configuration,
    actor: Admin,
    model_service: Models,
) -> ModelRead:
    """Reload the model files and run the checks again.

    On failure the current model stays in use, so registrations keep working.
    """
    candidate = model_service.reload(settings)
    version = candidate.metadata.get("model_version", "unknown")
    if candidate.status == "ok":
        record_active_model(session, candidate)
    audit(
        session,
        request,
        "model_reloaded",
        "success" if candidate.status == "ok" else "failure",
        actor,
        subject=f"model_version:{version}",
    )
    session.commit()
    if candidate.status != "ok":
        raise HTTPException(
            409, f"Reload failed; the current model is still in use. {candidate.error}"
        )
    return model_read(candidate)
