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
from app.schemas.errors import ErrorResponse

logger = logging.getLogger(__name__)
router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]


@router.get(
    "/health", response_model=HealthResponse, responses={503: {"model": ErrorResponse}}
)
def health(
    request: Request, session: Annotated[Session, Depends(get_db)]
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
    return HealthResponse(status="ok", database="ok")
