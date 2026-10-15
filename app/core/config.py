"""Application configuration read from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover - dotenv is optional
    pass


@dataclass(frozen=True)
class Settings:
    app_name: str = "SBI Backend APIs"
    app_version: str = "0.1.5"
    upstream_base_url: str = "https://bet-service-658489904938.europe-west6.run.app"
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings(
        upstream_base_url=os.environ.get("UPSTREAM_BASE_URL", Settings.upstream_base_url),
        log_level=os.environ.get("LOG_LEVEL", Settings.log_level).upper(),
    )
