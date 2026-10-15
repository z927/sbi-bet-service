"""Layer di persistenza SQLite per le partite scrappate."""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

_DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "diretta.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS matches (
    id            TEXT PRIMARY KEY,
    sport         INTEGER,
    tournament    TEXT,
    country       TEXT,
    home          TEXT,
    away          TEXT,
    home_score    INTEGER,
    away_score    INTEGER,
    status        TEXT,
    status_code   INTEGER,
    stage_id      INTEGER,
    is_live       INTEGER,
    minute        TEXT,
    start_time    INTEGER,
    data          TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_live ON matches (is_live);
CREATE INDEX IF NOT EXISTS idx_matches_sport ON matches (sport);
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches (tournament);

CREATE TABLE IF NOT EXISTS snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    TEXT NOT NULL,
    home_score  INTEGER,
    away_score  INTEGER,
    status_code INTEGER,
    stage_id    INTEGER,
    minute      TEXT,
    captured_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_match ON snapshots (match_id);
"""


def db_path() -> Path:
    return Path(os.environ.get("DIRETTA_DB", _DEFAULT_DB))


def _connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(SCHEMA)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_int(value) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def upsert_matches(matches: list[dict]) -> int:
    """Inserisce/aggiorna le partite e registra uno snapshot sui cambi di stato."""
    if not matches:
        return 0
    now = _now()
    stored = 0
    with _connect() as conn:
        for match in matches:
            match_id = match.get("id")
            if not match_id:
                continue
            state = (
                _as_int(match.get("home_score")),
                _as_int(match.get("away_score")),
                _as_int(match.get("status_code")),
                _as_int(match.get("stage_id")),
                match.get("minute"),
            )
            row = conn.execute(
                "SELECT home_score, away_score, status_code, stage_id, minute FROM matches WHERE id = ?",
                (match_id,),
            ).fetchone()
            previous = (
                (row["home_score"], row["away_score"], row["status_code"], row["stage_id"], row["minute"])
                if row
                else None
            )
            if previous != state:
                conn.execute(
                    "INSERT INTO snapshots (match_id, home_score, away_score, status_code, stage_id, minute, captured_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (match_id, *state, now),
                )
            conn.execute(
                """
                INSERT INTO matches (
                    id, sport, tournament, country, home, away, home_score, away_score,
                    status, status_code, stage_id, is_live, minute, start_time, data, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    sport = excluded.sport,
                    tournament = excluded.tournament,
                    country = excluded.country,
                    home = excluded.home,
                    away = excluded.away,
                    home_score = excluded.home_score,
                    away_score = excluded.away_score,
                    status = excluded.status,
                    status_code = excluded.status_code,
                    stage_id = excluded.stage_id,
                    is_live = excluded.is_live,
                    minute = excluded.minute,
                    start_time = excluded.start_time,
                    data = excluded.data,
                    updated_at = excluded.updated_at
                """,
                (
                    match_id,
                    _as_int(match.get("sport")),
                    match.get("tournament", ""),
                    match.get("country", ""),
                    match.get("home", ""),
                    match.get("away", ""),
                    state[0],
                    state[1],
                    match.get("status", ""),
                    state[2],
                    state[3],
                    1 if match.get("is_live") else 0,
                    state[4],
                    _as_int(match.get("start_time")),
                    json.dumps(match, ensure_ascii=False),
                    now,
                ),
            )
            stored += 1
    return stored


def get_matches(
    sport: int | None = None,
    scope: str = "live",
    filter_text: str | None = None,
    limit: int = 500,
) -> list[dict]:
    clauses: list[str] = []
    params: list = []
    if sport is not None:
        clauses.append("sport = ?")
        params.append(sport)
    if scope == "live":
        clauses.append("is_live = 1")
    if filter_text:
        clauses.append("(LOWER(home) LIKE ? OR LOWER(away) LIKE ? OR LOWER(tournament) LIKE ?)")
        needle = f"%{filter_text.lower()}%"
        params.extend([needle, needle, needle])
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    query = f"SELECT data FROM matches {where} ORDER BY tournament, start_time LIMIT ?"
    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [json.loads(row["data"]) for row in rows]


def get_match(match_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT data FROM matches WHERE id = ?", (match_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def get_snapshots(match_id: str, limit: int = 200) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT match_id, home_score, away_score, status_code, stage_id, minute, captured_at"
            " FROM snapshots WHERE match_id = ? ORDER BY id DESC LIMIT ?",
            (match_id, limit),
        ).fetchall()
    return [dict(row) for row in rows]


def count_matches() -> int:
    with _connect() as conn:
        return conn.execute("SELECT COUNT(*) AS n FROM matches").fetchone()["n"]


def delete_all() -> None:
    with _connect() as conn:
        conn.execute("DELETE FROM snapshots")
        conn.execute("DELETE FROM matches")
