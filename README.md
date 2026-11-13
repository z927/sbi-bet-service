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
npm run hooks          # una tantum: attiva gli hook git in .githooks/
```

> `.npmrc` points npm at the public registry because the configured private
> registry does not mirror the required packages. Remove/override it once the
> packages are available internally.

## npm scripts

| Script | Description |
| --- | --- |
| `npm run generate` | Regenerate `src/bet-api/generated/api-types.ts` from `openapi/openapi.yaml` (openapi-typescript). |
| `npm run typecheck` | Type-check the project with `tsc --noEmit`. |
| `npm run build` | **Build command**: `generate` + `typecheck`. |
| `npm run dev` | Run with `node --watch` (auto-restart). |
| `npm start` | Run the server. |
| `npm test` | Run the test suite (`node --test`). |
| `npm run bump` | Bump patch di `package.json`/`package-lock.json`, commit `chore(release): X.Y.Z [skip ci]` e tag `vX.Y.Z`. Con `-- --push` spinge anche commit e tag. |
| `npm run hooks` | Una tantum: imposta `core.hooksPath=.githooks` così gli hook (`commit-msg`, `post-merge`) diventano attivi. |

## Run

```bash
npm run dev      # http://127.0.0.1:8000
```

- OpenAPI document: `http://127.0.0.1:8000/openapi.json`
- Swagger UI: `http://127.0.0.1:8000/docs`

## Code generation

The SBI request/response **types** are generated from the contract:

- Output: `src/bet-api/generated/api-types.ts` (do not edit by hand).

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
| GET | `/api/v1/monitor` | `monitorFixtures` |
| GET | `/api/v1/scheduled-fixtures` | `getScheduledFixtures` |
| GET | `/api/v1/monitored` | `getMonitoredFixtures` |
| GET | `/api/v1/matches` | `getMatches` |

> `/restore` is documented in `AGENTS.md` as deprecated but is **not** part of
> `openapi/openapi.yaml`, so it is not exposed.

Conflicts return `409` with a `BaseResponse`. Invalid request bodies and query
parameters return `422`.

#### Auto-schedule flow

`GET /api/v1/auto-schedule` orchestrates the day's monitoring window:

1. Fetches today's matches from the diretta.it feed (calcio only).
2. Keeps only **major leagues** (`MONITOR_MAJOR_LEAGUES`, exact name or diretta id)
   with a start time still in the future.
3. Enriches each kept match with the detail feed to read its `end_time`
   (fallback: start + 2h), sets `monitored: true` and persists everything to
   SQLite. Each match carries `begin_monitoring_time`
   (start − `MONITOR_LEAD_MINUTES`) and `end_monitoring_time`.
4. Builds a **single aggregated cron expression** in the GCP 5-field format
   `*/{step} {hour-ranges} {dom} {mon} {DOW}` — e.g. `*/10 15-17,18-20 18 10 SUN`:
   the job fires every `SCHEDULER_CRON_STEP_MINUTES` (default 10) minutes during
   the monitoring windows (`beginMonitoringTime` → `endMonitoringTime`) of the
   day's matches, one hour range per match, in timezone `SCHEDULER_TIME_ZONE`.
   Day-of-month/month and the day-of-week name are pinned to today. Then it
   creates/updates **one** Cloud Scheduler job (`GCP_JOB_ID`) targeting
   `GET {MONITOR_JOB_TARGET_BASE_URL}/api/v1/monitor` via ADC auth.
   (GCP evaluates day-of-month and day-of-week with OR; the daily upsert keeps
   the extra weekday occurrences harmless in practice.)
5. `409` when the existing job already fires today; `200` otherwise. When no
   upcoming major-league matches exist, the job is deleted and `200` returned.
   If `MONITOR_JOB_TARGET_BASE_URL` is unset, matches are still persisted and the
   scheduler step is skipped (local dev).

Required GCP setup: the Cloud Run runtime service account needs
`roles/cloud.scheduler.admin` (create/update/delete jobs) and the service URL
must be set in `MONITOR_JOB_TARGET_BASE_URL` at deploy time.

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

### Team identity mapping (diretta.it ↔ API-Football)

Canonical teams live in Supabase, with provider-specific ids kept separate so
odds/API-Football data and diretta.it live statistics can be joined. The schema
is in `supabase/migrations/20261031120000_team_mapping.sql` (`teams`,
`team_provider_mappings`, `team_aliases`, `fixture_links`). Apply it with the
Supabase CLI (`supabase db push` after linking the project) or paste the
migration into the SQL editor. The existing `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` settings are used; without them the module falls
back to an in-memory store (tests, local dev).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/mapping/teams` | List canonical teams. |
| POST | `/mapping/teams` | Create a canonical team (`name`, optional `country`, `aliases`). |
| GET | `/mapping/teams/resolve` | Resolve a provider team (`provider`, `providerTeamId`, `name`, `country`, `autoLink`). |
| POST | `/mapping/teams/sync` | Sync API-Football and diretta teams for a league (`leagueId`, optional `season`, `direttaTournamentId`, `dryRun`). |
| GET | `/mapping/teams/:teamId/aliases` | List aliases for a canonical team. |
| POST | `/mapping/teams/:teamId/aliases` | Add an alias (`alias`, optional `source`). |
| GET | `/mapping/mappings` | List provider mappings, optionally filtered by `status`. |
| PUT | `/mapping/mappings` | Upsert a mapping (`teamId`, `provider`, `providerTeamId`, …). |
| POST | `/mapping/mappings/:mappingId/status` | Confirm or reject a mapping (`status`). |
| PUT | `/mapping/fixtures` | Link a canonical fixture to diretta/API-Football ids. |
| GET | `/mapping/fixtures/resolve` | Resolve a fixture by `date`, `homeTeamId`, `awayTeamId`. |
| POST | `/mapping/seasons/sync` | Bulk-sync one league/season from API-Football (`leagueId`, optional `season`, `direttaTournamentId`, `dryRun`, `maxFixtures`). |

Resolution order: exact `(provider, providerTeamId)` → exact normalized alias →
fuzzy match. Exact-id and alias matches are stored as `confirmed`; fuzzy matches
(score ≥ `0.82`) are stored as `pending` for manual review. Rejected mappings are
reported as `rejected` and are not silently rematched.

#### Season sync

`POST /mapping/seasons/sync` treats API-Football as the season spine:

1. resolves the **current season** from `/leagues` (`seasons[].current`) unless
   `season` is provided;
2. imports every team of the season as a canonical team (existing provider id or
   exact alias first, otherwise a new team);
3. upserts every fixture as a `fixture_link` with the API-Football fixture id;
4. stores the league mapping API-Football ↔ diretta in `league_links` when
   `direttaTournamentId` is supplied;
5. is idempotent and does not overwrite an existing `direttaMatchId`.

#### Team sync

`POST /mapping/teams/sync` is the single entry point for reconciling teams
between the two providers. It imports the API-Football teams of a league/season
first, then collects the diretta teams observed in the live feed for the
`direttaTournamentId` (falling back to the stored `league_links` value). For each
provider team it reuses an existing mapping, then an exact normalized alias, then
a fuzzy match; only unmatched teams create a new canonical team. Fuzzy matches
are stored as `pending` for manual review. `dryRun: true` reports the work
without writing anything. The season's `league_links` row is created/updated when
`direttaTournamentId` is supplied.

Diretta matches are linked incrementally: when a match is observed in the live
feed, its `home_id`/`away_id` resolve to canonical teams and the existing
`fixture_link` for that date/teams supplies the API-Football fixture id. Set
`dryRun: true` to get the report without writing anything. Requires
`API_FOOTBALL_KEY`; upstream errors return `502`.

## Layout

```
openapi/openapi.yaml        maintained contract (source of truth)
src/
  main.ts                   entrypoint
  server.ts                 Fastify assembly, error handling, Swagger
  config.ts                 env-driven settings
  validation.ts             ISO date validation
  types.ts                  re-exported contract types
  clients/
    apifootball/
      client.ts             API-Football client (leagues, teams, fixtures)
    diretta/                diretta.it client, una risorsa per file
      transport.ts          HTTP + parsing del feed delimited (~ ¬ ÷)
      matches.ts            elenco gare (+ minuto live)
      match.ts              dettaglio match
      statistics.ts         statistiche
      events.ts             incidenti (gol, cartellini, ...)
      lineups.ts            formazioni
      odds.ts               quote (GraphQL)
      index.ts              oggetto `client` aggregato
  cloud_scheduler/
    client.ts               GCP Cloud Scheduler REST client (ADC auth)
  services/
    schedule_service.ts     POST /api/v1/schedule state
    auto_schedule_service.ts  GET /api/v1/auto-schedule orchestration
    cron.ts                 GCP cron builder (aggregated daily slots)
    strategies/             monitor orchestration (isolated, testable)
      strategy.ts           Strategy interface + result types
      major_leagues.ts      env allowlist of major leagues
      live_matches_strategy.ts  live (major) matches -> statistics
    signals/                goal-over-0.5 evaluation, live odds, Telegram, persistence
  bet-api/
    generated/api-types.ts  openapi-typescript output
    routes.ts               /api/v1 routes + route metadata
  scraper/
    db.ts                   node:sqlite persistence
    service.ts              TTL cache + orchestrazione (collect/enrich)
    routes.ts               scraper routes
    models.ts               response types
  mapping/
    normalize.ts            name normalization + fuzzy scoring
    repo.ts                 Supabase persistence + in-memory fallback
    service.ts              resolve/create/confirm business logic
    routes.ts               /mapping routes
    models.ts               mapping types
supabase/
  migrations/               SQL schema (teams, mappings, aliases, leagues, fixtures)
test/
  contract.test.ts          routes vs contract, served /openapi.json
  api.test.ts               SBI endpoint behavior
  scraper.test.ts           scraper routes, parsing, cache, persistence (mocked fetch)
  strategies.test.ts        monitor strategy: major-league filter, stats, failures
  cron.test.ts              GCP cron builder + day matching (pure)
  auto_schedule.test.ts     auto-schedule orchestration (stubbed scheduler, mocked feed)
  mapping.test.ts           team resolution, aliases, pending review, fixture links
  season_sync.test.ts       current-season sync, idempotency, dry-run (mocked API-Football)
```

Dependency direction: `router -> service -> db/client`.

## Configuration

Read from environment variables via `src/config.ts`:

- `HOST`, `PORT` — bind address/port (default `127.0.0.1:8000`).
- `LOG_LEVEL` — `debug|info|warn|error|silent` (default `info`).
- `UPSTREAM_BASE_URL` — SBI upstream base URL (defaults to the HTTPS host).
- `APP_NAME` — metadata (default `SBI Backend APIs`).
- `APP_VERSION` — **override opzionale** della versione applicativa: il valore
  di default è la `version` di `package.json`, che è la source of truth.
- `DIRETTA_DB` — SQLite file (default `data/diretta.db`).
- `DIRETTA_CACHE_TTL` — matches cache TTL in seconds (default `15`).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — Supabase persistence (matches,
  team/league/fixture mapping). Without them the mapping module uses an
  in-memory store (local dev/tests).
- `API_FOOTBALL_BASE_URL`, `API_FOOTBALL_KEY` — API-Football provider used by
  `POST /mapping/seasons/sync` (default base URL
  `https://v3.football.api-sports.io`).
- `MONITOR_MAJOR_LEAGUES` — comma-separated major-league allowlist (exact full
  diretta.it tournament name like `"ITALIA: Serie A"`, or diretta.it id);
  empty/unset falls back to the built-in list of major European leagues and UEFA
  competitions in `src/services/strategies/major_leagues.ts` (~46 entries,
  translated to the names the diretta.it feed actually uses — e.g.
  `"SPAGNA: LaLiga"`, `"ROMANIA: Superliga"`, `"EUROPA: Champions League"`).
  A few entries are documented backups for names that cannot be verified
  off-season (cups, Nations League, World Cup qualifiers); prune them after a
  matchday if the primary name is confirmed (`GET /test/scrape` shows the
  feed's tournament names). Setting the env **replaces** the whole list.
- `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_JOB_ID` — Cloud Scheduler location of the
  auto-schedule job (injected at deploy time by CI).
- `MONITOR_JOB_TARGET_BASE_URL` — public base URL of this service; the scheduler
  job GETs `/api/v1/monitor` to it. Empty disables scheduler creation.
- `SCHEDULER_TIME_ZONE` — timezone for the scheduler cron (default `Africa/Freetown`).
- `MONITOR_LEAD_MINUTES` — minutes subtracted from each match start to compute
  `beginMonitoringTime` (default `0`).
- `SCHEDULER_CRON_STEP_MINUTES` — minute step of the scheduler cron
  (`*/N` during the match windows; default `10`).
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — if both set, the monitor signal
  sends alerts via Telegram; otherwise it’s a no-op.
- All live signals evaluate only on a 0-0 score: any other score (or a missing
  score) produces no alert, for every rule.
- The only active live signal is goal-over-0.5 (below).
- Goal-over-0.5 signal — fires on a 0-0 score inside fixed windows: minute
  15'-35' of the first half (`Alert Goal Over 0.5 HT`) and minute 60'-80'
  (absolute clock) of the second half (`Alert Goal Over 0.5 FT`). An alert is
  sent only when the touch ratio ("Palloni toccati nell'area avversaria" /
  elapsed minutes) meets `MONITOR_SIGNAL_GOAL_RATIO_THRESHOLD` (default `0.7`,
  comparison `>=`). The first half uses first-half touches over first-half
  elapsed minutes; the second half uses only second-half touches over
  second-half elapsed minutes. Missing or
  non-numeric stats produce no alert. Each alert is sent at most once per match
  per rule.
- When a signal fires, the monitor fetches live odds from diretta.it's live
  odds feed (`400.ds.lsapp.eu/pq_graphql`, `lobtm`/`ole2`) for the matching
  Over 0.5 market (`FIRST_HALF` for the HT alert, `FULL_TIME` for the FT
  alert), picks the highest quote among live active bookmaker offers, and stores
  it in `signals.odds`. The same quote is shown in the Telegram message as
  `💶 Quota live`; when no live offer is available the line shows `n/a` and
  `signals.odds` is `null`. Some events only expose FULL_TIME markets on the live
  feed, so first-half live odds may show `n/a`.
- `MONITOR_SIGNAL_GOAL_RATIO_THRESHOLD` — minimum touch ratio for the
  goal-over-0.5 alert (default `0.7`).
- `MONITOR_SIGNAL_WIN_RATE` — win rate percentage shown in the Telegram message
  (default `80`).

Secrets must never be committed.

## Major leagues (MONITOR_MAJOR_LEAGUES)

Lista delle leghe maggiori monitorate di default (da `src/services/strategies/major_leagues.ts`). Spunta le caselle man mano che verifichi la presenza nel feed diretta.it (`GET /test/scrape` mostra i nomi dei tornei usati dal feed).

### Austria
- [X] AUSTRIA: Bundesliga

### Belgio
- [X] BELGIO: Jupiler League (ex Jupiler Pro League)
- [X] BELGIO: Challenger Pro League

### Repubblica Ceca
- [X] REPUBBLICA CECA: 1. Liga

### Danimarca
- [X] DANIMARCA: Superliga

### Inghilterra
- [ ] INGHILTERRA: Community Shield (stima, fuori stagione)
- [X] INGHILTERRA: Premier League
- [X] INGHILTERRA: League One
- [X] INGHILTERRA: Championship
- [ ] INGHILTERRA: FA Cup

### Francia
- [ ] FRANCIA: Coupe de France
- [ ] FRANCIA: Coppa di Francia (variante italiana, backup)
- [X] FRANCIA: Ligue 1
- [X] FRANCIA: Ligue 2
- [X] FRANCIA: Ligue 3 (ex National 1, rinominata 2026-27)

### Germania
- [ ] GERMANIA: DFB Pokal
- [X] GERMANIA: 2. Bundesliga
- [X] GERMANIA: Bundesliga

### Irlanda
- [X] IRLANDA: Irish Premier Division

### Italia
- [X] ITALIA: Serie A
- [X] ITALIA: Serie B
- [ ] ITALIA: Coppa Italia

### Paesi Bassi
- [X] OLANDA: Eredivisie
- [X] OLANDA: Eerste Divisie
- [ ] OLANDA: KNVB Beker

### Portogallo
- [X] PORTOGALLO: Liga Portugal
- [X] PORTOGALLO: Liga Portugal 2

### Romania
- [X] ROMANIA: Superliga

### Scozia
- [X] SCOZIA: Premiership

### Serbia
- [X] SERBIA: Super Liga

### Spagna
- [X] SPAGNA: LaLiga
- [X] SPAGNA: LaLiga2
- [ ] SPAGNA: Copa del Rey

### Svizzera
- [X] SVIZZERA: Super League
- [ ] SVIZZERA: Coppa di Svizzera

### Turchia
- [X] TURCHIA: Super Lig

### UEFA / internazionali
- [X] EUROPA: Champions League
- [X] EUROPA: Champions League - Prima fase
- [X] EUROPA: Europa League
- [X] EUROPA: Europa League - Prima fase
- [X] EUROPA: Conference League
- [X] EUROPA: Conference League - Prima fase
- [ ] EUROPA: Nations League (non verificabile, finestra internazionale)
- [ ] MONDO: Nations League (backup)
- [ ] EUROPA: World Cup - Qualification Europe (non verificabile)
- [ ] MONDO: World Cup - Qualification Europe (backup)

## Logging

Structured logging uses `pino` (`src/logger.ts`) with an `AsyncLocalStorage`
context that behaves like the logback MDC:

- `traceId` — request id (`x-request-id` when provided, otherwise a UUID) or a
  per-run UUID for cron/strategy executions. Inside the live strategy each match
  gets its own trace, opened at the start of the match and closed right after its
  processing, so a single match can be followed independently.
- `strategy` — strategy name (e.g. `live-matches-statistics`).
- `match` — `"home - away"`.
- `fixtureId` — SBI fixture id; in the live scraper flow it is the diretta.it
  match id for now.

The default console logger pattern is:

```text
[ LEVEL ] | thread | traceId | message
```

A dedicated strategy logger (`getStrategyLogger`, equivalent to a logback logger
with `additivity="false"`) writes only strategy/signal events:

```text
[ LEVEL ] | traceId | strategy | match | fixtureId | message
```

Per-match strategy events include `match strategy started` / `match strategy
completed`, plus `match minute` (`minute`, `period`) and `touch ratio` (`touches`,
`ratio` = touches in the opponent box / elapsed minutes) messages when the data
is available. Additional structured fields (e.g. `rule`, `minute`, `err`) are
appended as a compact JSON object after the message. `LOG_LEVEL` controls both
loggers.

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
| `release` | push/PR | commitlint on PRs; su `main` semantic-release bumpa `package.json`/`package-lock.json`, committa `chore(release): X.Y.Z [skip ci]`, tagga `vX.Y.Z` e crea la GitHub Release (semina il tag baseline `v0.0.1`) |
| `test` | push/PR | `npm ci`, generate + typecheck, OpenAPI drift check, `npm test` |
| `build` | push/PR | builds the image; pushes `ghcr.io/<owner>/<repo>` (`latest` + `sha-<sha>`) **only on `main`** |
| `deploy` | push to `main` only | `gcloud run deploy bet-service` with the pushed image **pinned by digest** |

One-time setup:

1. After the first successful push to `main`, make the GHCR package **public**
   (package → Settings → Visibility), otherwise Cloud Run cannot pull it.
2. Required repository secrets: `GCP_PROJECT_ID`, `GCP_EMAIL`, `GCP_CREDENTIALS`
   (service account JSON), `GCP_APP_NAME` (legacy, unused by the new flow).

## Versioning and releases

**Source of truth: `package.json` → `version`.** `src/config.ts` la legge a
runtime, quindi `APP_VERSION` (env) è solo un override opzionale e non può più
disallinearsi: `test/config.test.ts` lo verifica.

Regole semver (`.releaserc.json`): ogni release incrementa di **patch**; solo un
commit con breaking change (`!` o `BREAKING CHANGE:`) passa a **major**.

Come viene incrementata:

| Caso | Chi bumpa |
| --- | --- |
| Merge su `main` con CI attivo | **semantic-release** (job `release`): scrive `package.json` + `package-lock.json`, crea il commit `chore(release): X.Y.Z [skip ci]`, il tag `vX.Y.Z` e la GitHub Release. |
| Merge su `main` con `[skip ci]` (il CI non parte) | **Hook locale `post-merge`**: fa lo stesso in locale e spinge commit + tag con `npm run bump -- --push`. |

Dettagli:

- I commit di release contengono `[skip ci]` (e quelli spinti dal CI usano il
  `GITHUB_TOKEN`, che non riattiva le workflow): il bump non fa partire build né
  deploy.
- Un merge con `[skip ci]` salta **tutte** le job (test/build/deploy): il bump lo
  recupera l'hook in locale, mentre build e deploy partono solo dai push senza
  `[skip ci]`.
- L'hook si aggancia a `git pull`/`git merge` su `main` e **non ribumpa** se il
  range già contiene un commit `chore(release)` senza lavoro successivo (caso
  "il CI ha già rilasciato").
- Setup una tantum: `npm run hooks` (senza, git ignora `.githooks/post-merge` e
  `.githooks/commit-msg`).
- Manuale: `npm run bump` (solo locale) oppure `npm run bump -- --push`.
- **Requisito CI**: il job `release` deve poter pushare su `main`
  (`permissions: contents: write` già presente). Se il branch è protetto con
  required reviews, il push del commit di release va autorizzato (ruleset/bypass)
  altrimenti semantic-release fallirà.

## Scope and behavior notes

- All schema properties are optional, matching the source specification.
- JSON wire names keep camelCase (`fixtureId`, `firstHalfScore`, `startTime`, …).
- SBI schedule state is kept **in memory only**; `GET /api/v1/monitor` calls the
  diretta scraper: it selects live matches from major leagues
  (`MONITOR_MAJOR_LEAGUES`) and prints their statistics to the console for now.
  The endpoint takes no body (contract revision: it was POST with a
  `FixtureDto` array body).
- `GET /api/v1/auto-schedule` persists the day's upcoming major-league matches
  to SQLite with `monitored: true` and manages the Cloud Scheduler job described
  above. Monitor still does not feed the other endpoints (`/monitored`,
  `/matches` stay empty).
- The scraper persists to SQLite and caches collected matches in memory.

## Open questions (from AGENTS.md, not guessed)

1. Is this service a drop-in replacement, a façade/proxy, or an independent backend?
2. Should `/api/v1/scheduled-fixtures` return `BaseResponse`, or an updated contract with fixture data?
3. What is the expected `BaseResponse` content on success and failure?
4. Which request fields are semantically required despite not being marked required?
5. What are the intended scheduling/monitoring rules, duplicate handling and persistence needs?
6. Which upstream integrations are needed, and their timeouts/retries/failure semantics?

Provisional conflict rules currently implemented (pending answers to Q1/Q5):

- `POST /api/v1/schedule` returns `409` if the target day already has a schedule.
- `GET /api/v1/auto-schedule` returns `409` if the Cloud Scheduler job already
  fires today (state is derived from Cloud Scheduler, so it survives restarts).
