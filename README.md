# diretta-scraper — Node/TypeScript backend

A single Fastify/TypeScript service exposing:

1. The scoped **SBI Backend APIs v0.1.5** — *Schedule*, *Monitoring* and *Matches*.
2. A **diretta.it live scraper** REST API (matches, statistics, events, lineups, odds)
   with SQLite persistence and a TTL cache.

The maintained OpenAPI contract for the SBI endpoints lives in
`openapi/openapi.yaml` and is the source of truth for their shape.

## Requirements

- Node.js `>= 22.6` (runs TypeScript natively via type stripping — no build step needed to run).

## Setup

```bash
npm install
cp .env.example .env   # non-secret placeholders only
```

> `.npmrc` points npm at the public registry because the configured private
> registry does not mirror the required packages. Remove/override it once the
> packages are available internally.

## npm scripts

| Script | Description |
| --- | --- |
| `npm run generate` | Regenerate `src/sbi/generated/api-types.ts` from `openapi/openapi.yaml` (openapi-typescript). |
| `npm run typecheck` | Type-check the project with `tsc --noEmit`. |
| `npm run build` | **Build command**: `generate` + `typecheck`. |
| `npm run dev` | Run with `node --watch` (auto-restart). |
| `npm start` | Run the server. |
| `npm test` | Run the test suite (`node --test`). |

## Run

```bash
npm run dev      # http://127.0.0.1:8000
```

- OpenAPI document: `http://127.0.0.1:8000/openapi.json`
- Swagger UI: `http://127.0.0.1:8000/docs`

## Code generation

The SBI request/response **types** are generated from the contract:

- Output: `src/sbi/generated/api-types.ts` (do not edit by hand).

The running server **serves the contract file itself** at `/openapi.json`
(via `@fastify/swagger` static mode), so the published document can never drift
from `openapi/openapi.yaml`. The hand-written Fastify routes are checked against
the contract by `test/contract.test.ts`.

Regenerate after changing the contract:

```bash
npm run generate
```

## Endpoints

### SBI (contract in `openapi/openapi.yaml`)

| Method | Path | Operation ID |
| --- | --- | --- |
| POST | `/api/v1/schedule` | `scheduleEvents` |
| GET | `/api/v1/auto-schedule` | `autoScheduleEvents` |
| POST | `/api/v1/monitor` | `monitorFixtures` |
| GET | `/api/v1/scheduled-fixtures` | `getScheduledFixtures` |
| GET | `/api/v1/monitored` | `getMonitoredFixtures` |
| GET | `/api/v1/matches` | `getMatches` |

> `/restore` is documented in `AGENTS.md` as deprecated but is **not** part of
> `openapi/openapi.yaml`, so it is not exposed.

Conflicts return `409` with a `BaseResponse`. Invalid request bodies and query
parameters return `422`.

### diretta.it scraper

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | Health + stored matches count. |
| GET | `/sports` | Supported sport IDs (calcio only). |
| GET | `/matches` | Collect matches (`sport`, `scope=live|today`, `enrich`, `filter`, `geo`, `workers`, `refresh`). |
| GET | `/live` | All live matches (`sport`, `enrich`, `geo`, `workers`, `refresh`) — alias of `/matches?scope=live`. |
| GET | `/matches/:matchId` | Match detail (`sport`, `enrich`, `geo`). |
| GET | `/matches/:matchId/statistics` | Live statistics for a match id, straight from diretta.it (`sport`). |
| GET | `/matches/:matchId/snapshots` | Persisted state-change snapshots (`limit`). |
| GET | `/db/matches` | Matches stored in SQLite (`sport`, `scope`, `filter`, `limit`). |
| POST | `/cache/clear` | Clear the in-memory TTL cache. |
| GET | `/test/scrape` | **Testing only**: forces a live feed fetch and reports diagnostics (`sport`, `scope`, `sample`). |

`enrich` accepts any of `detail`, `stats`, `events`, `lineups`, `odds`.

Scraping is enabled for **calcio only** (`sport=1`): every other `sport` value
returns `422` on all scraper routes.

`GET /live` and `GET /matches/:matchId/statistics` are the dedicated endpoints
for the two core live flows: listing every live match and reading a single
match's statistics. `GET /matches/:matchId/statistics` returns
`{ match_id, statistics }` where `statistics` is divided into `all` (whole
match), `first_half` and `second_half`. Each period maps a category key
(`top`, `shots`, `attack`, `passing`, `defense`, `goalkeeper`) to an array of
stats (`id`, `name`, `home`, `away`). Upstream failures from diretta.it are
mapped to `502` with `{ detail }`.

`GET /test/scrape` bypasses the TTL cache, always calls diretta.it and returns
`{ ok, sport, scope, feed, elapsed_ms, matches_parsed, live_matches, stored,
sample, error }`. `ok: false` with `error` set means the scrape failed; results
are still persisted to SQLite when the scrape succeeds.

## Layout

```
openapi/openapi.yaml        maintained contract (source of truth)
src/
  main.ts                   entrypoint
  server.ts                 Fastify assembly, error handling, Swagger
  config.ts                 env-driven settings
  validation.ts             ISO date validation
  types.ts                  re-exported contract types
  services/                 SBI in-memory business logic
    strategies/             monitor orchestration (isolated, testable)
      strategy.ts           Strategy interface + result types
      major_leagues.ts      env allowlist of major leagues
      live_matches_strategy.ts  live (major) matches -> statistics
  sbi/
    generated/api-types.ts  openapi-typescript output
    routes.ts               /api/v1 routes + route metadata
  scraper/
    client/                 diretta.it client, una risorsa per file
      transport.ts          HTTP + parsing del feed delimited (~ ¬ ÷)
      matches.ts            elenco gare (+ minuto live)
      match.ts              dettaglio match
      statistics.ts         statistiche
      events.ts             incidenti (gol, cartellini, ...)
      lineups.ts            formazioni
      odds.ts               quote (GraphQL)
      index.ts              oggetto `client` aggregato
    db.ts                   node:sqlite persistence
    service.ts              TTL cache + orchestrazione (collect/enrich)
    routes.ts               scraper routes
    models.ts               response types
test/
  contract.test.ts          routes vs contract, served /openapi.json
  sbi.test.ts               SBI endpoint behavior
  scraper.test.ts           scraper routes, parsing, cache, persistence (mocked fetch)
  strategies.test.ts        monitor strategy: major-league filter, stats, failures
```

Dependency direction: `router -> service -> db/client`.

## Configuration

Read from environment variables via `src/config.ts`:

- `HOST`, `PORT` — bind address/port (default `127.0.0.1:8000`).
- `LOG_LEVEL` — `debug|info|warn|error|silent` (default `info`).
- `UPSTREAM_BASE_URL` — SBI upstream base URL (defaults to the HTTPS host).
- `APP_NAME`, `APP_VERSION` — metadata.
- `DIRETTA_DB` — SQLite file (default `data/diretta.db`).
- `DIRETTA_CACHE_TTL` — matches cache TTL in seconds (default `15`).
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — if both set, the monitor signal
  sends alerts via Telegram; otherwise it’s a no-op.
- `MONITOR_SIGNAL_TOUCHES_THRESHOLD` — threshold for touch-ratio signal (default
  `0.4`, touches in opponent box / minutes in first half ≥ threshold). The alert
  text is fixed: `Alert goal Over 0.5 HT`. Each alert is sent at most once per
  match per rule.

Secrets must never be committed.

## Test

```bash
npm test
```

`test/contract.test.ts` verifies the implemented routes cover the contract
(paths, methods, operation IDs) and that `/openapi.json` equals
`openapi/openapi.yaml`. `test/sbi.test.ts` and `test/scraper.test.ts` cover
status codes, wire field names and service behavior. Scraper tests mock
`fetch`; no live sports APIs are called.

## Container and CI/CD

`Dockerfile` (production: `npm ci --omit=dev`, `HOST=0.0.0.0`,
`DIRETTA_DB=/tmp/diretta.db`, `node src/main.ts`):

```bash
docker build -t sbi-bet-service .
docker run -p 8080:8080 sbi-bet-service
```

`.github/workflows/ci.yml` runs on every push/PR:

| Job | Trigger | What it does |
| --- | --- | --- |
| `release` | push/PR | commitlint on PRs, semantic-release on `main` (seeds the `v0.0.1` baseline tag only on `main` pushes) |
| `test` | push/PR | `npm ci`, generate + typecheck, OpenAPI drift check, `npm test` |
| `build` | push/PR | builds the image; pushes `ghcr.io/<owner>/<repo>` (`latest` + `sha-<sha>`) **only on `main`** |
| `deploy` | push to `main` only | `gcloud run deploy bet-service` with the pushed image **pinned by digest** |

One-time setup:

1. After the first successful push to `main`, make the GHCR package **public**
   (package → Settings → Visibility), otherwise Cloud Run cannot pull it.
2. Required repository secrets: `GCP_PROJECT_ID`, `GCP_EMAIL`, `GCP_CREDENTIALS`
   (service account JSON), `GCP_APP_NAME` (legacy, unused by the new flow).

## Scope and behavior notes

- All schema properties are optional, matching the source specification.
- JSON wire names keep camelCase (`fixtureId`, `firstHalfScore`, `startTime`, …).
- SBI services keep state **in memory only**; only `/api/v1/monitor` calls the
  diretta scraper: it selects live matches from major leagues
  (`MONITOR_MAJOR_LEAGUES`) and prints their statistics to the console for now.
  The request body is still required by the contract but ignored.
- Monitor does not feed other endpoints (`/monitored`, `/matches` stay empty).
- The scraper persists to SQLite and caches collected matches in memory.

## Open questions (from AGENTS.md, not guessed)

1. Is this service a drop-in replacement, a façade/proxy, or an independent backend?
2. Should `/api/v1/scheduled-fixtures` return `BaseResponse`, or an updated contract with fixture data?
3. What is the expected `BaseResponse` content on success and failure?
4. Which request fields are semantically required despite not being marked required?
5. What are the intended scheduling/monitoring rules, duplicate handling and persistence needs?
6. Which upstream integrations are needed, and their timeouts/retries/failure semantics?

Provisional conflict rules currently implemented (in-memory, pending answers to Q1/Q5):

- `POST /api/v1/schedule` returns `409` if the target day already has a schedule.
- `GET /api/v1/auto-schedule` returns `409` if it already ran in the current process.
