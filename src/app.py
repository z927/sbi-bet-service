"""API FastAPI attorno allo scraper di diretta.it.

Avvio:
    uvicorn backend.app:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query

import diretta_scraper as scraper

from . import db, service
from .models import HealthResponse, Match, MatchesResponse, Snapshot


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield
    service.clear_cache()


app = FastAPI(
    title="Diretta.it API",
    description="Backend REST per partite live, statistiche, eventi, formazioni e quote.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", db=str(db.db_path()), matches_stored=db.count_matches())


@app.get("/sports")
def sports() -> dict:
    return {"sports": scraper.SPORTS}


@app.get("/matches", response_model=MatchesResponse)
def list_matches(
    sport: int = Query(1, description="ID sport (1=calcio, 2=tennis, ...)"),
    scope: str = Query("live", pattern="^(live|today)$", description="Solo live o tutte le partite di oggi"),
    enrich: list[str] = Query(
        default_factory=list,
        description="Dati extra: detail, stats, events, lineups, odds",
    ),
    filter: str | None = Query(None, description="Filtro substring su squadra o torneo"),
    geo: str = Query("IT", description="Codice paese per le quote"),
    workers: int = Query(8, ge=1, le=32),
    refresh: bool = Query(False, description="Ignora la cache TTL e forza una nuova raccolta"),
):
    invalid = [e for e in enrich if e not in service.ENRICH_CHOICES]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Valori enrich non validi: {invalid}")
    matches, cached = service.get_matches(
        sport=sport,
        scope=scope,
        filter_text=filter,
        enrich=tuple(enrich),
        geo=geo,
        workers=workers,
        refresh=refresh,
    )
    return MatchesResponse(count=len(matches), cached=cached, matches=matches)


@app.get("/matches/{match_id}", response_model=Match)
def match_detail(
    match_id: str,
    sport: int = Query(1),
    enrich: list[str] = Query(default=["detail"]),
    geo: str = Query("IT"),
):
    invalid = [e for e in enrich if e not in service.ENRICH_CHOICES]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Valori enrich non validi: {invalid}")
    match = service.get_match(match_id, sport=sport, enrich=tuple(enrich), geo=geo)
    if match is None:
        raise HTTPException(status_code=404, detail="Partita non trovata")
    return match


@app.get("/matches/{match_id}/snapshots", response_model=list[Snapshot])
def match_snapshots(match_id: str, limit: int = Query(200, ge=1, le=2000)):
    return db.get_snapshots(match_id, limit=limit)


@app.get("/db/matches", response_model=MatchesResponse)
def stored_matches(
    sport: int | None = Query(None),
    scope: str = Query("live", pattern="^(live|today)$"),
    filter: str | None = Query(None),
    limit: int = Query(500, ge=1, le=5000),
):
    matches = db.get_matches(sport=sport, scope=scope, filter_text=filter, limit=limit)
    return MatchesResponse(count=len(matches), cached=True, matches=matches)


@app.post("/cache/clear")
def cache_clear():
    service.clear_cache()
    return {"status": "cleared"}
