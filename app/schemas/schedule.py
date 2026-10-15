"""Schedule endpoint models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DefaultItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    fixture_id: int | None = Field(default=None, alias="fixtureId")
    match: str | None = None


class FavouriteItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    fixture_id: int | None = Field(default=None, alias="fixtureId")
    match: str | None = None
    home_team: bool | None = Field(default=None, alias="homeTeam")
    away_team: bool | None = Field(default=None, alias="awayTeam")


class ScheduleRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    default_fixtures: list[DefaultItem] | None = Field(default=None, alias="defaultFixtures")
    favourite_fixtures: list[FavouriteItem] | None = Field(default=None, alias="favouriteFixtures")
