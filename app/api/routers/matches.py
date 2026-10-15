"""Matches router."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query

from ...schemas.base import BaseResponse
from ...schemas.matches import MatchModel
from ...schemas.monitoring import FixtureDto
from ...services import matches_service, monitoring_service

router = APIRouter(tags=["matches"])


@router.get(
    "/v3/scheduled-fixtures",
    operation_id="getScheduledFixtures",
    response_model=BaseResponse,
)
def get_scheduled_fixtures() -> BaseResponse:
    return matches_service.get_scheduled_fixtures()


@router.get(
    "/monitored",
    operation_id="getMonitoredFixtures",
    response_model=list[FixtureDto],
)
def get_monitored_fixtures() -> list[FixtureDto]:
    return monitoring_service.get_monitored_fixtures()


@router.get(
    "/matches",
    operation_id="getMatches",
    response_model=list[MatchModel],
)
def get_matches(
    date_param: date | None = Query(default=None, alias="date"),
) -> list[MatchModel]:
    return matches_service.get_matches(date_param)
