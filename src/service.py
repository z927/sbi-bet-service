"""Servizio: orchestra lo scraper, la cache TTL e la persistenza."""

from __future__ import annotations

import os
import threading
import time

import diretta_scraper as scraper

from . import db

ENRICH_CHOICES = ("detail", "stats", "events", "lineups", "odds")

_lock = threading.Lock()
_cache: dict[tuple, tuple[float, list[dict]]] = {}


def ttl_seconds() -> float:
    return float(os.environ.get("DIRETTA_CACHE_TTL", "15"))


def _cache_key(sport: int, scope: str, filter_text: str | None, enrich: tuple[str, ...], geo: str) -> tuple:
    return (sport, scope, filter_text, enrich, geo)


def get_matches(
    sport: int = 1,
    scope: str = "live",
    filter_text: str | None = None,
    enrich: tuple[str, ...] = (),
    geo: str = "IT",
    workers: int = 8,
    refresh: bool = False,
) -> tuple[list[dict], bool]:
    """Ritorna (matches, cached). Usa la cache TTL e persiste su SQLite."""
    key = _cache_key(sport, scope, filter_text, enrich, geo)
    now = time.time()

    if not refresh:
        with _lock:
            hit = _cache.get(key)
            if hit and now - hit[0] < ttl_seconds():
                return hit[1], True

    options = set(enrich)
    matches = scraper.collect(
        sport=sport,
        scope=scope,
        filter_text=filter_text,
        options=options,
        geo=geo,
        workers=workers,
    )
    db.upsert_matches(matches)

    with _lock:
        _cache[key] = (now, matches)
    return matches, False


def get_match(
    match_id: str,
    sport: int = 1,
    enrich: tuple[str, ...] = ("detail",),
    geo: str = "IT",
) -> dict | None:
    match = scraper._single_match(match_id, sport, set(enrich), geo)
    db.upsert_matches([match])
    return match


def clear_cache() -> None:
    with _lock:
        _cache.clear()
