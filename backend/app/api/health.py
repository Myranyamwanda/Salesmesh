import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import error_response
from app.db.session import get_db
from app.ml.model_service import ModelService, get_model_service
from app.schemas.errors import ErrorResponse

logger = logging.getLogger(__name__)
router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    database: Literal["ok"]
    model: Literal["ok", "failed"]
    model_error: str | None = None


@router.get(
    "/health", response_model=HealthResponse, responses={503: {"model": ErrorResponse}}
)
def health(
    request: Request,
    session: Annotated[Session, Depends(get_db)],
    model_service: Annotated[ModelService, Depends(get_model_service)],
) -> HealthResponse | JSONResponse:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        logger.warning(
            "database_unavailable", extra={"request_id": request.state.request_id}
        )
        return error_response(
            request, 503, "database_unavailable", "Database is unavailable"
        )
    # A failed model returns 200 "degraded", not 503: the API stays up so an
    # admin can sign in, see the reason, and reload the model.
    model = model_service.state
    return HealthResponse(
        status="ok" if model.status == "ok" else "degraded",
        database="ok",
        model=model.status,
        model_error=model.error,
    )
