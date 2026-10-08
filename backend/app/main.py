import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router
from app.core.config import Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.db.session import get_engine

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging(settings.log_level)
        logger.info("application_started")
        yield
        get_engine().dispose()
        get_engine.cache_clear()
        logger.info("application_stopped")

    app = FastAPI(title="SalesMesh API", version="0.1.0", lifespan=lifespan)
    register_error_handlers(app)

    @app.middleware("http")
    async def log_request(request: Request, call_next):
        request.state.request_id = str(uuid4())
        started = perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers["X-Request-ID"] = request.state.request_id
            return response
        finally:
            logger.info(
                "request_completed",
                extra={
                    "request_id": request.state.request_id,
                    "method": request.method,
                    "status_code": status_code,
                    "duration_ms": round((perf_counter() - started) * 1000, 2),
                },
            )

    app.include_router(router)
    return app


api = create_app()
app = CORSMiddleware(
    api,
    allow_origins=[get_settings().frontend_url],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Request-ID"],
)
