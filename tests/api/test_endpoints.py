"""API tests for the scoped endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import matches_service, monitoring_service, schedule_service


@pytest.fixture(autouse=True)
def clean_state():
    schedule_service.reset()
    monitoring_service.reset()
    matches_service.reset()
    yield
    schedule_service.reset()
    monitoring_service.reset()
    matches_service.reset()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_schedule_returns_base_response(client: TestClient) -> None:
    response = client.post(
        "/schedule",
        json={
            "defaultFixtures": [{"fixtureId": 1, "match": "A vs B"}],
            "favouriteFixtures": [
                {"fixtureId": 2, "match": "C vs D", "homeTeam": True, "awayTeam": False}
            ],
        },
        params={"day": "2026-10-15"},
    )
    assert response.status_code == 200
    body = response.json()
    assert set(body) <= {"message", "statusCode"}
    assert body["statusCode"] == 200


def test_schedule_accepts_empty_optional_body(client: TestClient) -> None:
    response = client.post("/schedule", json={})
    assert response.status_code == 200


def test_schedule_requires_body(client: TestClient) -> None:
    response = client.post("/schedule")
    assert response.status_code == 422


def test_schedule_invalid_day_returns_422(client: TestClient) -> None:
    response = client.post("/schedule", json={}, params={"day": "not-a-date"})
    assert response.status_code == 422


def test_schedule_conflict_returns_409(client: TestClient) -> None:
    client.post("/schedule", json={}, params={"day": "2026-10-15"})
    response = client.post("/schedule", json={}, params={"day": "2026-10-15"})
    assert response.status_code == 409
    body = response.json()
    assert body["statusCode"] == 409
    assert body["message"]


def test_auto_schedule_ok_then_conflict(client: TestClient) -> None:
    first = client.get("/auto-schedule")
    assert first.status_code == 200
    assert first.json()["statusCode"] == 200
    second = client.get("/auto-schedule")
    assert second.status_code == 409
    assert second.json()["statusCode"] == 409


def test_monitor_accepts_fixture_array(client: TestClient) -> None:
    payload = [
        {
            "fixtureId": 10,
            "league": {"name": "Serie A", "country": "Italy", "leagueId": 5},
            "home": {"team": "Inter", "teamId": 1, "score": 1, "favourite": True},
            "away": {"team": "Milan", "teamId": 2, "score": 0, "favourite": False},
            "info": {
                "statusDescription": "1H",
                "monitored": True,
                "elapsed": 20,
                "favouriteStrategyUsed": False,
            },
            "time": {
                "startTime": "2026-10-15T18:00:00",
                "beginMonitoringTime": "2026-10-15T17:00:00",
                "endMonitoringTime": "2026-10-15T20:00:00",
            },
            "period": "1H",
        }
    ]
    response = client.post("/monitor", json=payload)
    assert response.status_code == 200
    assert response.json()["statusCode"] == 200


def test_monitor_rejects_non_array(client: TestClient) -> None:
    response = client.post("/monitor", json={"fixtureId": 1})
    assert response.status_code == 422


def test_monitored_returns_stored_fixtures_with_wire_names(client: TestClient) -> None:
    client.post("/monitor", json=[{"fixtureId": 10, "home": {"teamId": 1}}])
    response = client.get("/monitored")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list) and len(body) == 1
    assert body[0]["fixtureId"] == 10
    assert body[0]["home"]["teamId"] == 1


def test_restore_returns_base_response(client: TestClient) -> None:
    response = client.get("/restore", params={"day": "2026-10-15"})
    assert response.status_code == 200
    assert response.json()["statusCode"] == 200


def test_scheduled_fixtures_returns_base_response(client: TestClient) -> None:
    response = client.get("/v3/scheduled-fixtures")
    assert response.status_code == 200
    assert response.json()["statusCode"] == 200


def test_matches_returns_array_and_filters_by_date(client: TestClient) -> None:
    from app.schemas.matches import MatchModel

    matches_service.set_matches(
        [
            MatchModel(id=1, match="A vs B", startTime="2026-10-15T18:00:00"),
            MatchModel(id=2, match="C vs D", startTime="2026-10-16T18:00:00"),
        ]
    )
    response = client.get("/matches")
    assert response.status_code == 200
    assert len(response.json()) == 2

    filtered = client.get("/matches", params={"date": "2026-10-15"})
    assert filtered.status_code == 200
    body = filtered.json()
    assert len(body) == 1
    assert body[0]["firstHalfScore"] is None or "firstHalfScore" in body[0]


def test_matches_invalid_date_returns_422(client: TestClient) -> None:
    response = client.get("/matches", params={"date": "15-10-2026"})
    assert response.status_code == 422
