from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import require_roles
from app.ml.model_service import ModelService, get_model_service
from app.models import User

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


@router.get("/model", response_model=ModelRead)
def read_model(_: Admin, model_service: Models) -> ModelRead:
    state = model_service.state
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
