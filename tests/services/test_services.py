"""Service-level tests."""

from __future__ import annotations

from datetime import date

import pytest

from app.core.errors import ConflictError
from app.schemas.matches import MatchModel
from app.schemas.monitoring import FixtureDto
from app.schemas.schedule import ScheduleRequest
from app.services import matches_service, monitoring_service, schedule_service


@pytest.fixture(autouse=True)
def clean_state():
    schedule_service.reset()
    monitoring_service.reset()
    matches_service.reset()


def test_schedule_stores_and_conflicts() -> None:
    day = date(2026, 10, 15)
    response = schedule_service.schedule_events(ScheduleRequest(), day)
    assert response.status_code == 200
    with pytest.raises(ConflictError):
        schedule_service.schedule_events(ScheduleRequest(), day)


def test_schedule_defaults_to_today() -> None:
    response = schedule_service.schedule_events(ScheduleRequest())
    assert response.status_code == 200


def test_auto_schedule_conflicts_on_second_run() -> None:
    assert schedule_service.auto_schedule_events().status_code == 200
    with pytest.raises(ConflictError):
        schedule_service.auto_schedule_events()


def test_monitor_keys_by_fixture_id() -> None:
    monitoring_service.monitor_fixtures(
        [FixtureDto(fixture_id=1), FixtureDto(fixture_id=1, period="2H")]
    )
    monitored = monitoring_service.get_monitored_fixtures()
    assert len(monitored) == 1
    assert monitored[0].period == "2H"


def test_monitor_ignores_missing_fixture_id() -> None:
    monitoring_service.monitor_fixtures([FixtureDto(period="1H")])
    assert monitoring_service.get_monitored_fixtures() == []


def test_get_matches_filters_by_date() -> None:
    matches_service.set_matches(
        [
            MatchModel(id=1, start_time="2026-10-15T18:00:00"),
            MatchModel(id=2, start_time="2026-10-16T18:00:00"),
        ]
    )
    assert len(matches_service.get_matches()) == 2
    assert [m.id for m in matches_service.get_matches(date(2026, 10, 15))] == [1]
