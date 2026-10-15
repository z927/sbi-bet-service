"""Schedule service.

Business rules (provisional, in-memory only):
- POST /schedule conflicts (409) when the target day already has a schedule.
- GET /auto-schedule conflicts (409) when an auto-schedule already ran.

Persistence and real scheduling semantics are open questions in AGENTS.md;
this service keeps state in memory until they are clarified.
"""

from __future__ import annotations

import threading
from datetime import date

from ..core.errors import ConflictError
from ..schemas.base import BaseResponse
from ..schemas.schedule import ScheduleRequest

_lock = threading.Lock()
_schedules: dict[date, ScheduleRequest] = {}
_auto_scheduled: bool = False


def schedule_events(request: ScheduleRequest, day: date | None = None) -> BaseResponse:
    target_day = day or date.today()
    with _lock:
        if target_day in _schedules:
            raise ConflictError(f"Schedule already exists for {target_day.isoformat()}")
        _schedules[target_day] = request
    default_count = len(request.default_fixtures or [])
    favourite_count = len(request.favourite_fixtures or [])
    return BaseResponse(
        message=(
            f"Scheduled {default_count} default and {favourite_count} favourite "
            f"fixtures for {target_day.isoformat()}"
        ),
        status_code=200,
    )


def auto_schedule_events() -> BaseResponse:
    global _auto_scheduled
    with _lock:
        if _auto_scheduled:
            raise ConflictError("Auto-schedule already executed")
        _auto_scheduled = True
    return BaseResponse(message="Auto-schedule completed", status_code=200)


def reset() -> None:
    """Clear in-memory state. Intended for tests."""
    global _auto_scheduled
    with _lock:
        _schedules.clear()
        _auto_scheduled = False
