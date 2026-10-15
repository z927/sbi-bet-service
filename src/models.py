"""Modelli Pydantic per le risposte dell'API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class Match(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    sport: int | None = None
    tournament: str = ""
    country: str = ""
    tournament_id: str = ""
    league_url: str = ""
    home: str = ""
    away: str = ""
    home_short: str = ""
    away_short: str = ""
    home_score: int | None = None
    away_score: int | None = None
    home_id: str = ""
    away_id: str = ""
    home_logo: str | None = None
    away_logo: str | None = None
    status: str = ""
    status_code: int | None = None
    stage_id: int | None = None
    stage_start: int | None = None
    is_live: bool = False
    minute: str | None = None
    start_time: int | None = None


class MatchesResponse(BaseModel):
    count: int
    cached: bool
    matches: list[Match]


class Snapshot(BaseModel):
    match_id: str
    home_score: int | None = None
    away_score: int | None = None
    status_code: int | None = None
    stage_id: int | None = None
    minute: str | None = None
    captured_at: str


class HealthResponse(BaseModel):
    status: str
    db: str
    matches_stored: int
