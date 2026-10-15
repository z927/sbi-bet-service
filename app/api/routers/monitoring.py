"""Monitoring router."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Body, Query

from ...schemas.base import BaseResponse
from ...schemas.monitoring import FixtureDto
from ...services import monitoring_service

router = APIRouter(tags=["monitoring"])


@router.post(
    "/monitor",
    operation_id="monitorFixtures",
    response_model=BaseResponse,
)
def monitor_fixtures(
    fixtures: list[FixtureDto] = Body(...),
) -> BaseResponse:
    return monitoring_service.monitor_fixtures(fixtures)


@router.get(
    "/restore",
    operation_id="restoreFixtures",
    response_model=BaseResponse,
    deprecated=True,
)
def restore_fixtures(
    day: date | None = Query(default=None),
) -> BaseResponse:
    return monitoring_service.restore_fixtures(day.isoformat() if day else None)
