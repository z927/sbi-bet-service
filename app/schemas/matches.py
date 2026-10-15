"""Matches endpoint models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class MatchModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    id: int | None = None
    league: str | None = None
    match: str | None = None
    score: str | None = None
    first_half_score: str | None = Field(default=None, alias="firstHalfScore")
    start_time: str | None = Field(default=None, alias="startTime")
    slug: str | None = None
    favourite_team: str | None = Field(default=None, alias="favouriteTeam")
    monitored: bool | None = None
    favourite_strategy_used: bool | None = Field(default=None, alias="favouriteStrategyUsed")
