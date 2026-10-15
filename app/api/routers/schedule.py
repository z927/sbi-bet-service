"""Schedule router."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query

from ...schemas.base import BaseResponse
from ...schemas.schedule import ScheduleRequest
from ...services import schedule_service

router = APIRouter(tags=["schedule"])


@router.post(
    "/schedule",
    operation_id="scheduleEvents",
    response_model=BaseResponse,
    responses={409: {"model": BaseResponse, "description": "Conflict"}},
)
def schedule_events(
    request: ScheduleRequest,
    day: date | None = Query(default=None),
) -> BaseResponse:
    return schedule_service.schedule_events(request, day)


@router.get(
    "/auto-schedule",
    operation_id="autoScheduleEvents",
    response_model=BaseResponse,
    responses={409: {"model": BaseResponse, "description": "Conflict"}},
)
def auto_schedule_events() -> BaseResponse:
    return schedule_service.auto_schedule_events()
