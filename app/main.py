"""FastAPI application exposing the scoped SBI Backend APIs contract."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api.routers import matches, monitoring, schedule
from .core.config import get_settings
from .core.errors import register_exception_handlers
from .core.logging import setup_logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Schedule, Monitoring and Matches endpoints from SBI Backend APIs "
            f"v{settings.app_version}."
        ),
        lifespan=lifespan,
    )
    register_exception_handlers(app)
    app.include_router(schedule.router)
    app.include_router(monitoring.router)
    app.include_router(matches.router)
    return app


app = create_app()
