# SBI Backend APIs — FastAPI implementation

API-first implementation of the scoped **Schedule**, **Monitoring** and **Matches**
endpoints from *SBI Backend APIs v0.1.5*. The maintained contract lives in
`openapi/openapi.yaml` and is the source of truth.

> This package (`app/`) is separate from the existing diretta.it scraper in `src/`.
> The scoped SBI contract is implemented only here to avoid route collisions
> (for example `GET /matches` has a different shape in each app).

## Endpoints

| Method | Path | Operation ID |
| --- | --- | --- |
| POST | `/schedule` | `scheduleEvents` |
| GET | `/auto-schedule` | `autoScheduleEvents` |
| POST | `/monitor` | `monitorFixtures` |
| GET | `/restore` | `restoreFixtures` (deprecated) |
| GET | `/v3/scheduled-fixtures` | `getScheduledFixtures` |
| GET | `/monitored` | `getMonitoredFixtures` |
| GET | `/matches` | `getMatches` |

## Setup

```bash
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
cp .env.example .env  # non-secret placeholders only
```

## Run

```bash
.venv/bin/uvicorn app.main:app --reload
```

- OpenAPI: `http://127.0.0.1:8000/openapi.json`
- Swagger UI: `http://127.0.0.1:8000/docs`

## Test

```bash
.venv/bin/python -m pytest
```

`tests/contract/` checks the FastAPI-generated schema against `openapi/openapi.yaml`
for paths, methods, operation IDs, query parameters, status codes, schema property
names/required flags and undocumented routes. `tests/api/` covers request/response
shapes and status codes; `tests/services/` covers service behavior. No live
upstream calls are made.

## Configuration

Read from environment variables via `app/core/config.py`:

- `UPSTREAM_BASE_URL` — upstream SBI Backend base URL (defaults to the HTTPS host).
- `LOG_LEVEL` — logging level (default `INFO`).

Secrets must never be committed. `.env` is not required for local runs.

## Scope and behavior notes

- All schema properties are optional, matching the source specification.
- JSON wire names keep camelCase (`fixtureId`, `firstHalfScore`, `startTime`, …)
  via explicit aliases.
- Services keep state **in memory only** (no repository, DB, queue or cache) until
  persistence requirements are agreed. There are no upstream integrations yet.
- `409` is returned by an application exception handler mapped to `BaseResponse`.

## Open questions (from AGENTS.md, not guessed)

1. Is this service a drop-in replacement, a façade/proxy, or an independent backend?
2. Should `/v3/scheduled-fixtures` return `BaseResponse`, or an updated contract with fixture data?
3. What is the expected `BaseResponse` content on success and failure?
4. Which request fields are semantically required despite not being marked required?
5. What are the intended scheduling/monitoring rules, duplicate handling and persistence needs?
6. Which upstream integrations are needed, and their timeouts/retries/failure semantics?

Provisional conflict rules currently implemented (in-memory, pending answers to Q1/Q5):

- `POST /schedule` returns `409` if the target day already has a schedule.
- `GET /auto-schedule` returns `409` if it already ran in the current process.
