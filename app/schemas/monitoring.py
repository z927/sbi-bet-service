"""Monitoring endpoint models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class LeagueDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    name: str | None = None
    country: str | None = None
    league_id: int | None = Field(default=None, alias="leagueId")


class SingleItemDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    team: str | None = None
    team_id: int | None = Field(default=None, alias="teamId")
    score: int | None = None
    favourite: bool | None = None


class InfoDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    status_description: str | None = Field(default=None, alias="statusDescription")
    monitored: bool | None = None
    elapsed: int | None = None
    favourite_strategy_used: bool | None = Field(default=None, alias="favouriteStrategyUsed")


class TimeDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    start_time: str | None = Field(default=None, alias="startTime")
    begin_monitoring_time: str | None = Field(default=None, alias="beginMonitoringTime")
    end_monitoring_time: str | None = Field(default=None, alias="endMonitoringTime")


class FixtureDto(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    fixture_id: int | None = Field(default=None, alias="fixtureId")
    league: LeagueDto | None = None
    home: SingleItemDto | None = None
    away: SingleItemDto | None = None
    info: InfoDto | None = None
    time: TimeDto | None = None
    period: str | None = None
