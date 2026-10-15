import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Match, MatchSnapshot } from "./models.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = resolve(HERE, "..", "..", "data", "diretta.db");

const SCHEMA = `
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
`;

export function dbPath(): string {
  return resolve(process.env["DIRETTA_DB"] ?? DEFAULT_DB);
}

function connect(): DatabaseSync {
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  const conn = new DatabaseSync(path);
  conn.exec("PRAGMA journal_mode=WAL");
  conn.exec("PRAGMA foreign_keys=ON");
  return conn;
}

export function initDb(): void {
  const conn = connect();
  try {
    conn.exec(SCHEMA);
  } finally {
    conn.close();
  }
}

function now(): string {
  return new Date().toISOString();
}

function asInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

type SqlValue = string | number | null;

export function upsertMatches(matches: Match[]): number {
  if (matches.length === 0) {
    return 0;
  }
  const timestamp = now();
  let stored = 0;
  const conn = connect();
  try {
    const selectStmt = conn.prepare(
      "SELECT home_score, away_score, status_code, stage_id, minute FROM matches WHERE id = ?",
    );
    const insertSnapshot = conn.prepare(
      "INSERT INTO snapshots (match_id, home_score, away_score, status_code, stage_id, minute, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const upsert = conn.prepare(`
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
    `);

    for (const match of matches) {
      const matchId = match.id;
      if (!matchId) {
        continue;
      }
      const state: SqlValue[] = [
        asInt(match.home_score),
        asInt(match.away_score),
        asInt(match.status_code),
        asInt(match.stage_id),
        (match.minute ?? null) as SqlValue,
      ];
      const previousRow = selectStmt.get(matchId) as
        | { home_score: SqlValue; away_score: SqlValue; status_code: SqlValue; stage_id: SqlValue; minute: SqlValue }
        | undefined;
      const previous = previousRow
        ? [previousRow.home_score, previousRow.away_score, previousRow.status_code, previousRow.stage_id, previousRow.minute]
        : null;
      if (!previous || previous.some((value, index) => value !== state[index])) {
        insertSnapshot.run(matchId, ...state, timestamp);
      }
      upsert.run(
        matchId,
        asInt(match.sport),
        match.tournament ?? "",
        match.country ?? "",
        match.home ?? "",
        match.away ?? "",
        state[0]!,
        state[1]!,
        match.status ?? "",
        state[2]!,
        state[3]!,
        match.is_live ? 1 : 0,
        state[4]!,
        asInt(match.start_time),
        JSON.stringify(match),
        timestamp,
      );
      stored += 1;
    }
  } finally {
    conn.close();
  }
  return stored;
}

export function getMatches(
  sport: number | null = null,
  scope = "live",
  filterText: string | null = null,
  limit = 500,
): Match[] {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  if (sport !== null) {
    clauses.push("sport = ?");
    params.push(sport);
  }
  if (scope === "live") {
    clauses.push("is_live = 1");
  }
  if (filterText) {
    clauses.push("(LOWER(home) LIKE ? OR LOWER(away) LIKE ? OR LOWER(tournament) LIKE ?)");
    const needle = `%${filterText.toLowerCase()}%`;
    params.push(needle, needle, needle);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  const query = `SELECT data FROM matches ${where} ORDER BY tournament, start_time LIMIT ?`;
  const conn = connect();
  try {
    const rows = conn.prepare(query).all(...params) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data) as Match);
  } finally {
    conn.close();
  }
}

export function getMatch(matchId: string): Match | null {
  const conn = connect();
  try {
    const row = conn.prepare("SELECT data FROM matches WHERE id = ?").get(matchId) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as Match) : null;
  } finally {
    conn.close();
  }
}

export function getSnapshots(matchId: string, limit = 200): MatchSnapshot[] {
  const conn = connect();
  try {
    return conn
      .prepare(
        "SELECT match_id, home_score, away_score, status_code, stage_id, minute, captured_at FROM snapshots WHERE match_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(matchId, limit) as unknown as MatchSnapshot[];
  } finally {
    conn.close();
  }
}

export function countMatches(): number {
  const conn = connect();
  try {
    const row = conn.prepare("SELECT COUNT(*) AS n FROM matches").get() as { n: number };
    return row.n;
  } finally {
    conn.close();
  }
}

export function deleteAll(): void {
  const conn = connect();
  try {
    conn.exec("DELETE FROM snapshots");
    conn.exec("DELETE FROM matches");
  } finally {
    conn.close();
  }
}
