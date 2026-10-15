"""Central exception types and handlers."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ..schemas.base import BaseResponse


class ConflictError(Exception):
    """Raised by services when an operation conflicts with current state.

    Maps to the documented 409 responses on /schedule and /auto-schedule.
    """


def conflict_response(exc: ConflictError) -> JSONResponse:
    body = BaseResponse(message=str(exc), status_code=409)
    return JSONResponse(status_code=409, content=body.model_dump(by_alias=True, exclude_none=True))


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ConflictError)
    async def _conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
        return conflict_response(exc)
