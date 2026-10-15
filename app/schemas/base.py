"""Base response model shared across scoped endpoints."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class BaseResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    message: str | None = Field(default=None, alias="message")
    status_code: int | None = Field(default=None, alias="statusCode")
