Mission
Build and maintain a Node.js/TypeScript backend using Fastify with an API-first workflow. The first integration scope is limited to the existing Schedule, Monitoring, and Matches APIs described in the supplied OpenAPI specification for SBI Backend APIs v0.1.5. The same service also exposes the diretta.it live scraper REST API.
Treat the supplied OpenAPI specification as the source of truth for the existing API contract. Preserve its paths, HTTP methods, parameter names, request/response shapes, and documented status codes. Do not invent undocumented behavior or silently “correct” inconsistencies in the source contract.
Required workflow: API-first
1. Inspect the OpenAPI contract before implementing or changing an endpoint.
2. Define or update the API contract first. Keep it version-controlled (openapi/openapi.yaml).
3. Generate request/response types from the contract (openapi-typescript) rather than hand-writing them.
4. Implement matching Fastify routes that expose the contract.
5. Put business logic in service modules; keep routes thin.
6. Add tests for contract shape, validation, status codes, and service behavior.
7. Validate the served OpenAPI document and check for unintended differences.
8. Do not implement an endpoint until its request and response behavior are understood. If the source specification is incomplete, document the gap and ask for clarification rather than guessing.
The server serves `openapi/openapi.yaml` directly at `/openapi.json` (Fastify Swagger static mode), so the published contract cannot drift. A contract test asserts that the implemented routes cover the contract’s paths, methods and operation IDs.
Scope: existing API contract
The upstream server listed in the provided specification is:
http://bet-service-658489904938.europe-west6.run.app
The Swagger UI shared by the user uses the same service host over HTTPS. Configure the upstream base URL through environment configuration; do not hard-code it throughout the codebase. Use HTTPS where supported and verify the deployment's actual scheme before production use.
Schedule
Method	Path	Operation ID	Contract
POST	/api/v1/schedule	scheduleEvents	Required JSON body ScheduleRequest; optional query parameter day (date). Documented responses: 200 and 409, both BaseResponse.
GET	/api/v1/auto-schedule	autoScheduleEvents	No declared parameters or body. Documented responses: 200 and 409, both BaseResponse.


ScheduleRequest:
- defaultFixtures: array of DefaultItem
- favouriteFixtures: array of FavouriteItem
DefaultItem:
- fixtureId: integer
- match: string
FavouriteItem:
- fixtureId: integer
- match: string
- homeTeam: boolean
- awayTeam: boolean
The OpenAPI schema does not mark the properties of ScheduleRequest, DefaultItem, or FavouriteItem as required. Do not make them mandatory without an explicit contract change.
Monitoring
Method	Path	Operation ID	Contract
POST	/api/v1/monitor	monitorFixtures	Required JSON array of FixtureDto; documented response 200 with BaseResponse.
GET	/restore	restoreFixtures	Optional query parameter day (date); documented response 200 with BaseResponse. Deprecated in the source specification.


FixtureDto:
- fixtureId: integer
- league: LeagueDto
- home: SingleItemDto
- away: SingleItemDto
- info: InfoDto
- time: TimeDto
- period: string
Nested models:
- LeagueDto: name (string), country (string), leagueId (integer)
- SingleItemDto: team (string), teamId (integer), score (integer), favourite (boolean)
- InfoDto: statusDescription (string), monitored (boolean), elapsed (integer), favouriteStrategyUsed (boolean)
- TimeDto: startTime (string), beginMonitoringTime (string), endMonitoringTime (string)
These properties are not marked required by the supplied schema. Preserve that optionality unless a deliberate, documented contract revision is approved.
Matches
Method	Path	Operation ID	Contract
GET	/api/v1/scheduled-fixtures	getScheduledFixtures	No declared parameters or body; 200 returns BaseResponse. Description says it retrieves events from Sofascore and fixtures from API-Football.
GET	/api/v1/monitored	getMonitoredFixtures	No declared parameters or body; 200 returns an array of FixtureDto.
GET	/api/v1/matches	getMatches	Optional query parameter date (date); 200 returns an array of MatchModel.


MatchModel:
- id: integer
- league: string
- match: string
- score: string
- firstHalfScore: string
- startTime: string
- slug: string
- favouriteTeam: string
- monitored: boolean
- favouriteStrategyUsed: boolean
The properties above are not marked required in the supplied OpenAPI schema. Keep the wire-format field names exactly as specified, including firstHalfScore, startTime, favouriteTeam, and favouriteStrategyUsed.
Contract and compatibility rules
- The OpenAPI source is authoritative for the scoped endpoints. Do not expand this implementation to unrelated API groups (users, statistics, filters, priorities, notifications, config, events) unless explicitly requested.
- Preserve the exact paths and methods listed above. Do not rename routes without an explicit versioned contract change.
- Preserve query names and date formats: day on /api/v1/schedule; date on /api/v1/matches. These parameters are optional in the source contract.
- Preserve the documented response model and status codes. In particular, /api/v1/schedule and /api/v1/auto-schedule document 409 conflicts.
- BaseResponse has message (string) and statusCode (integer). The OpenAPI schema does not mark either property required.
- The source contract contains some ambiguities and omissions. For example, it does not define business-level error payloads beyond the listed models, required fields are often omitted, and /api/v1/scheduled-fixtures documents BaseResponse despite a description about retrieving and saving fixtures. Do not infer a richer response from the description alone. Capture these as open questions and preserve the documented contract until clarified.
- `/restore` is deprecated in the source specification and is not part of `openapi/openapi.yaml`; it is intentionally not exposed. Keep it in this document as a known gap.
- The specification's servers URL uses HTTP, while the shared Swagger URL is HTTPS. Keep the base URL configurable and verify the deployed scheme. Never disable TLS certificate verification to work around connection errors.
- Do not assume that the backend must proxy every upstream route. Clarify whether it is intended to be a compatible replacement, a façade/proxy, or a new implementation before introducing upstream calls or changing persistence behavior.
Recommended project structure
Use this structure unless the existing repository already has a coherent alternative:
src/
  main.ts                 entrypoint
  server.ts               Fastify assembly, error handling, Swagger
  config.ts               env-driven settings
  validation.ts           ISO date validation helpers
  types.ts                re-exported contract types
  sbi/
    generated/api-types.ts  openapi-typescript output (do not edit by hand)
    routes.ts               /api/v1 routes + route metadata
    services/               in-memory business logic
  scraper/
    feed.ts                 diretta.it HTTP client + feed parsing
    db.ts                   node:sqlite persistence
    service.ts              TTL cache + orchestration
    routes.ts               scraper routes
    models.ts               response types
test/
  contract.test.ts
  sbi.test.ts
  scraper.test.ts
openapi/
  openapi.yaml
Keep dependency direction clear:
router -> service -> db/feed
Types should not contain business logic. Routes should handle HTTP concerns and delegate operations to services. Do not introduce a repository, database, queue, cache, or provider integration for the SBI scope until the intended behavior and persistence requirements are known.
TypeScript and Fastify conventions
- Use a supported Node.js version (>= 22.6, which runs TypeScript via native type stripping). Declare it in package.json engines.
- Use type annotations for public functions, service methods, and model fields.
- Prefer generated contract types (openapi-typescript) for request/response shapes where practical; validate runtime input with Fastify JSON schemas.
- Use ISO YYYY-MM-DD strings for date query parameters; validate the format explicitly and return 422 on invalid values.
- Preserve JSON wire names with the exact camelCase from the contract; never rename fields to snake_case on the wire.
- Prefer asynchronous route/service/client code. Do not mix blocking I/O into request handlers.
- Centralize configuration and read environment variables through settings. Provide .env.example with non-secret placeholders.
- Keep secrets out of source code, logs, tests, and committed environment files.
- Use structured logging; do not log credentials or sensitive request payloads.
- Translate exceptions centrally and return contract-compatible error responses. Do not swallow exceptions or return success-shaped responses for failed operations.
- Avoid unnecessary abstractions and dependencies. Explain material architectural choices in the pull request or implementation notes.
Testing requirements
For each scoped endpoint, add tests that verify:
- Exact HTTP method and path.
- Required/optional query parameters and valid/invalid date values.
- Request-body validation, including arrays and nested FixtureDto structures.
- JSON field names and types match the supplied OpenAPI schema.
- Response status codes and response schemas match the contract.
- /api/v1/schedule and /api/v1/auto-schedule handle documented 409 conflicts.
- /restore is treated as deprecated in documentation; do not add it without an explicit decision.
- External integrations, if any, are mocked in unit tests. Tests must not rely on live sports APIs or production data.
- OpenAPI output has no unintended route or schema drift.
Prefer deterministic tests with the built-in node:test runner and Fastify’s inject. Add extra tooling only if the implementation requires it.
Definition of done
A change is complete only when:
1. The API contract has been reviewed and updated first when needed.
2. Implementation matches the contract or documents an approved deviation.
3. Relevant tests pass.
4. OpenAPI output has been checked for drift.
5. Configuration and setup instructions are documented.
6. No unrelated API groups or speculative business behavior have been added.
7. Any unresolved ambiguity in the upstream specification is recorded explicitly.
Open questions — do not guess
Before implementing behavior beyond the documented contract, establish:
1. Is this service a drop-in replacement, a façade/proxy for the existing service, or an independent backend?
2. Should /api/v1/scheduled-fixtures return the documented BaseResponse, or is there an updated contract with fixture data?
3. What is the expected response content for BaseResponse on successful and failed operations?
4. Which request fields are semantically required even though the schema does not mark them required?
5. What are the intended scheduling/monitoring business rules, duplicate handling, and persistence requirements?
6. Which upstream integrations are actually needed, and what are their timeouts, retry policies, and failure semantics?
