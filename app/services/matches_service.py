"""Matches service.

The source contract documents GET /v3/scheduled-fixtures as returning
BaseResponse even though its description mentions retrieving events from
Sofascore and fixtures from API-Football. The documented contract is
preserved; upstream integrations are an open question and are not wired.
"""

from __future__ import annotations

import threading
from datetime import date

from ..schemas.base import BaseResponse
from ..schemas.matches import MatchModel

_lock = threading.Lock()
_matches: list[MatchModel] = []


def get_scheduled_fixtures() -> BaseResponse:
    return BaseResponse(
        message="Scheduled fixtures refresh triggered",
        status_code=200,
    )


def get_matches(day: date | None = None) -> list[MatchModel]:
    if day is None:
        with _lock:
            return list(_matches)
    prefix = day.isoformat()
    with _lock:
        return [m for m in _matches if (m.start_time or "").startswith(prefix)]


def set_matches(matches: list[MatchModel]) -> None:
    """Replace stored matches. Intended for wiring/seed/tests."""
    global _matches
    with _lock:
        _matches = list(matches)


def reset() -> None:
    """Clear in-memory state. Intended for tests."""
    set_matches([])
