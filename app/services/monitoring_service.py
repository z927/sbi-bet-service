"""Monitoring service.

Keeps monitored fixtures in memory. Persistence is an open question in
AGENTS.md; no repository layer is introduced until it is clarified.
"""

from __future__ import annotations

import threading

from ..schemas.base import BaseResponse
from ..schemas.monitoring import FixtureDto

_lock = threading.Lock()
_monitored: dict[int, FixtureDto] = {}


def monitor_fixtures(fixtures: list[FixtureDto]) -> BaseResponse:
    with _lock:
        for fixture in fixtures:
            if fixture.fixture_id is not None:
                _monitored[fixture.fixture_id] = fixture
    return BaseResponse(message=f"Monitoring {len(_monitored)} fixtures", status_code=200)


def restore_fixtures(day: str | None = None) -> BaseResponse:
    # Deprecated endpoint: restore semantics are an open question; return
    # the documented BaseResponse shape without inventing behavior.
    suffix = f" for {day}" if day else ""
    return BaseResponse(message=f"Restore requested{suffix}", status_code=200)


def get_monitored_fixtures() -> list[FixtureDto]:
    with _lock:
        return list(_monitored.values())


def reset() -> None:
    """Clear in-memory state. Intended for tests."""
    with _lock:
        _monitored.clear()
