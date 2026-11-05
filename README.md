# File Converter

The React frontend has a responsive layout, navigation, local file/target selection, conversion workflow UI, auth/account/file interfaces and API documentation. PostgreSQL/Prisma models and constraints, shared infrastructure, first-party email authentication, confirmed profile/password changes, Redis sessions, protected guest credentials/trial transaction helpers and worker-only notification delivery are implemented. Frontend authentication remains disconnected; settings/API keys, file/conversion endpoints and conversion consumers remain future work.

## Requirements and documentation

- [Technical task](docs/technical-task.md)
- [Architecture](docs/architecture.md)
- [Design system](DESIGN.md)
- [Technology inventory and compatibility notes](docs/TECH-STACK.md)
- [Database schema and migration workflow](docs/db-schema.md)

Use Node.js 24 LTS (minimum 24.11.1), npm 11, and Docker with Compose v2 for infrastructure. Install from the repository root; one root lockfile covers all workspaces.

## Setup

```sh
npm ci
```

Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` on Linux/macOS). Its credentials are development-only defaults. Environment files and caches are ignored by Git.

```sh
npm run infra:up
```

Local services: PostgreSQL on 5432, Redis on 6379, MinIO API on 9000/console on 9001, Mailpit SMTP on 1025/UI on 8025. All host bindings are loopback-only. The one-shot storage initializer creates a private development bucket.

MinIO Community is now [source-only and archived](https://github.com/minio/minio). Its local image builds the official server/client from fixed commits, so the first infrastructure build can take several minutes. No Go installation is needed on the host. Production uses an external S3-compatible bucket, not this development MinIO.

Apply migrations explicitly to the intended local database before starting the applications:

```sh
npm run db:migrate:deploy --workspace=@converter/backend
```

Both entry points validate settings and connect to all five dependencies at startup; an unavailable dependency fails startup with a sanitized error. They never migrate schemas or create buckets automatically. Infrastructure probes do not send email; the worker delivers committed notification intents. Module shells remain available for isolated tests. Before starting API/worker, set `APP_ORIGIN`, generate separate random 32-byte hex values for `SESSION_SECRET` and `NOTIFICATION_ENCRYPTION_KEY`, and keep them only in the untracked environment/secret store. Use a local cryptographic generator, for example Node.js `crypto.randomBytes(32).toString('hex')`; do not reuse example values or expose them through `VITE_*`.

## Development

Run each process in its own terminal:

```sh
npm run dev:web
npm run dev:api
npm run dev:worker
```

- Web: http://127.0.0.1:5173, with `/api/` proxied to the API; `/api-docs` remains a frontend route.
- API: http://127.0.0.1:3000; health routes plus the auth/profile operations in [OpenAPI](packages/contracts/openapi.json). Unimplemented product routes return 404.
- Worker: no HTTP listener; processes email notifications, with dependency/notification readiness in a private heartbeat. No conversion processor is registered.

Backend development builds preserve TypeScript decorator metadata, then restart the selected process when its source changes. Separate output directories prevent the API and worker from overwriting each other. No global Nest CLI is needed.

The backend uses native ESM for NestJS 12. Relative TypeScript imports use `.js` extensions for the emitted Node.js files. Jest runs with VM modules and ts-jest ESM compilation; the resulting Node experimental warning is limited to test execution.

Frontend layout, providers, and routing live in `apps/web/src/app`; pages compose shared components from `shared/ui`. All nine documented routes exist; future feature pages clearly indicate that their workflows are not available yet. Onest and IBM Plex Mono are self-hosted with Latin/Ukrainian glyphs and SIL OFL licenses in `apps/web/public/fonts`. Implement the remaining features in the order recorded in [the implementation plan](docs/implementation-plan.md).

The converter feature supports one local JPG/JPEG, PNG, or DOCX file via picker or drag-and-drop. It shows filename/size, selects only JPG ↔ PNG or DOCX → PDF targets, and rejects empty, unsupported, multiple, directory, and oversized inputs without discarding a previous valid selection. The local limit is 20,000,000 bytes (decimal MB), centralized in `features/converter/lib/file-selection.ts`; future server capabilities must supply the authoritative limit. These metadata checks do not inspect file contents. Files stay in component memory. The production entry has no conversion gateway, so it performs no upload, persistence, conversion, or quota consumption and explicitly disables submission.

The conversion UI is prepared behind a feature-local `ConversionGateway` port. Its types are frontend view models, not invented HTTP DTOs: plan item 8 must map the finalized/generated API contract to this port, including authenticated guest/session access and CSRF. TanStack Query owns access/job data; local state owns selection, measured upload bytes, dialogs, and transient feedback. The flow rechecks access before submission, blocks duplicate clicks, distinguishes upload/acceptance/queued/processing/completed/failed, polls active jobs every 2 seconds with a 30-second interval after connectivity errors, stops terminal polling, and preserves a non-secret `conversion` ID in the URL. Ambiguous POST outcomes are never replayed automatically; without a discoverable accepted ID they remain blocked pending contract-backed recovery. Trial state is read from the gateway, never counted or stored in the browser. Downloads use returned Blobs, sanitized filenames, and short-lived object URLs, not arbitrary redirect URLs. Expiry/denial removes the download action without turning success into conversion failure or renewing a trial. The native auth dialog gates the next guest conversion, keeps selection in memory while open, and restores focus on close. Navigating to the future auth pages may require file reselection.

For controlled UI verification, run `npm run dev:web` and open [the development-only converter fixture](http://127.0.0.1:5173/test-fixtures/converter/?scenario=success). `scenario` accepts `success`, `failed`, `connection`, `unknown`, `expired`, `saved`, `reserved`, `consumed`, `download-error`, `download-expired`, `unmeasured`, and `rejected`. To check expiry discovered only when downloading, open `?scenario=download-expired&conversion=fixture_job`: the result starts available, then the download is denied while completion and the consumed guest allowance are preserved. The fixture is visibly labeled, accepts JPG → PNG for its one known synthetic PNG output, and never converts the source or calls product endpoints. It is a separate HTML entry under `apps/web/test-fixtures`, absent from the production bundle; no runtime mock switch is exposed by the application. Chromium E2E uses a separate Vite server on 4174 for these scenarios and the existing production preview on 4173 for ordinary routes. These responses do not establish real authentication, durable guest accounting, ownership enforcement, or live conversion. Those remain backend/integration work.

Authentication interfaces live at `/login`, `/register`, `/verify-email`, `/forgot-password`, and `/reset-password`. React Hook Form/Zod validate labeled fields, confirmation and email; passwords are never trimmed. UI limits remain provisionally 8–128 characters; backend policy is now 10–128. Item 8 must align the UI minimum, map the agreed OpenAPI contract to `AuthGateway`, handle cookie/CSRF rotation and capture/remove link tokens from URL fragments. Current production pages send no credentials and do not consume backend email links. Forms already support password managers, pending/error feedback and duplicate-submit guards; session state uses TanStack Query. Passwords/link tokens must stay out of caches/storage. Verification requires an explicit action; reset never automatically signs in. Signing in does not save or transfer a guest result.

For controlled auth flows, open [the development-only authentication fixture](http://127.0.0.1:5173/test-fixtures/auth/#/login). It uses hash routes so reloads keep the separate fixture entry. The optional document query `scenario` accepts `success`, `signed-in`, `unverified`, `invalid-credentials`, `network`, `rate-limited`, `session-error`, and `logout-error`, for example `?scenario=logout-error#/`. Synthetic verification/reset links use `#/verify-email?token=fixture-token` or `#/reset-password?token=fixture-token`; other token values simulate invalid/expired links. Use invented credentials only. No emails or product requests are sent, and reloading resets the fixture's in-memory session. This entry and its gateway are excluded from production assets. It demonstrates UI transitions, not genuine account security or server-side expiry/revocation.

`/api-docs` describes the planned seven-operation conversion REST contract with placeholder examples, API-key rules, polling/retention and errors. It remains pre-launch frontend documentation, not a live explorer. [OpenAPI](packages/contracts/openapi.json) describes health, implemented first-party auth/profile routes and guest bootstrap; conversion/file schemas remain pending. No requests are made by the documentation page.

## Authentication backend

`ApiModule.withAuthentication()` composes the existing infrastructure with Auth/Users/Guest modules. `WorkerModule.withNotifications()` alone imports notification consumers; API replicas do not consume jobs. The offline/infrastructure-only module compositions remain available for focused tests.

All paths below have `/api/v1` prefix. DTOs reject unknown fields; email is trimmed/lowercase (maximum 254), display name is trimmed/optional text (maximum 80), and new passwords are 10–128 characters without normalization. Existing sign-in/current passwords accept 1–128 characters. See [OpenAPI](packages/contracts/openapi.json) for exact schemas and generated types.

| Operation                           | Request                             | Success                                      |
| ----------------------------------- | ----------------------------------- | -------------------------------------------- |
| `GET /auth/csrf`                    | Same-origin cookie request          | `200 { csrfToken }`                          |
| `GET /auth/session`                 | Cookie, if present                  | `200` anonymous or authenticated session     |
| `POST /auth/register`               | email, password                     | Neutral `202 { status: "accepted" }`         |
| `POST /auth/login`                  | email, password                     | `200` authenticated session; SID/CSRF rotate |
| `POST /auth/logout`                 | No body                             | `204`, current session revoked               |
| `POST /auth/verification/resend`    | email                               | Neutral `202`                                |
| `POST /auth/verify-email`           | token                               | `204`, registration/email change confirmed   |
| `POST /auth/password-reset/request` | email                               | Neutral `202`                                |
| `POST /auth/password-reset/confirm` | token, newPassword                  | `204`, all account sessions revoked          |
| `GET /users/me`                     | Authenticated cookie                | `200` profile                                |
| `PATCH /users/me`                   | displayName, email, currentPassword | `200 { profile, verificationRequired }`      |
| `POST /users/me/password`           | currentPassword, newPassword        | `204`, all account sessions revoked          |

Bootstrap with `GET /auth/csrf` and keep the returned token in memory. Every mutation, including anonymous registration/login/recovery/logout, requires the same cookie, exact configured `Origin` and `X-CSRF-Token`. After login fetch a fresh CSRF token; after logout bootstrap a new context. No permissive CORS is enabled. Explicit `X-API-Key` is rejected on these first-party operations. Auth/profile responses and errors use `Cache-Control: no-store`; health keeps its existing operational response shape.

Anonymous Redis contexts expire after 15 minutes. Authenticated sessions expire after 30 idle minutes or seven days absolutely. HTTPS uses `__Host-converter.sid; Secure; HttpOnly; SameSite=Lax; Path=/` without Domain. Development-only HTTP is permitted for loopback `APP_ORIGIN` and uses `converter.dev.sid` without Secure. SID rotation/logout write atomic Redis revocation tombstones, preventing late requests from resurrecting a discarded SID. Every authenticated request reads PostgreSQL `sessionVersion`; password change/reset and completed email change increment it transactionally, without a validity cache. Redis failure returns `503` and never falls back to memory.

Only verified accounts sign in. Wrong credentials return `401 INVALID_CREDENTIALS`; a correct password for an unverified account returns `403 EMAIL_NOT_VERIFIED`. Registration/resend/recovery acknowledgements do not disclose account existence. Profile/password changes require the current password; new email stays pending until confirmed. One-time tokens are purpose-bound, hashed in PostgreSQL and limited to five failed secret attempts. Verification expires after 24 hours, recovery/email change after 30 minutes. Resend replaces the prior token; credential changes invalidate pending tokens. Verification/reset do not automatically sign in.

Notifications persist in `BackgroundTask` in the same transaction as the account/token change. AES-256-GCM encrypts delivery material with task/version-bound authenticated data; BullMQ carries only `{ taskId }`. A worker reconciles pending intents every five seconds, claims a 60-second lease, sends through the existing SMTP adapter and conditionally completes the current lease. Delivery is at least once: a crash after SMTP acceptance may produce the same safe single-use link again. Five durable attempts use exponential delays; monitor `lastErrorCode`, attempts and pending age, and request a fresh link after exhaustion. Completed/skipped intents erase ciphertext. Keep the encryption key stable across API/worker replicas and backups until pending intents are drained; replacing it makes existing encrypted intents unreadable. Never log request bodies, cookies, tokens, keys or delivery contents.

Email links use `/verify-email#token=...` or `/reset-password#token=...`: the fragment never reaches HTTP/proxy logs. Future frontend integration must capture it in memory, remove it from the URL and explicitly submit the token in a JSON body. Current frontend query-token fixtures are separate and remain disconnected.

| Distributed limit                              | Quota                                               |
| ---------------------------------------------- | --------------------------------------------------- |
| All auth/profile requests                      | 120 per IP/minute                                   |
| CSRF bootstrap/read                            | 30 per IP/minute                                    |
| Login                                          | 10 per IP/minute and normalized-email/minute        |
| Registration/resend/reset request, combined    | 5 per IP/15 minutes and 3 per normalized email/hour |
| Token consumption, combined                    | 10 per IP/minute                                    |
| Confirmed profile/password mutations, combined | 5 per user/15 minutes                               |

Atomic Redis counters use HMAC-derived identity keys. Excess returns `429 RATE_LIMITED` with `Retry-After`; unavailable Redis fails closed. Current windows are fixed from the first attempt. Validation/token failures use `400`, missing sessions `401`, CSRF/origin/current-password failures `403`, unavailable profile email `409`, and infrastructure failures `503`, in `{ error: { code, message } }` without internal diagnostics.

Run `npm run test:auth` with explicit dedicated loopback `TEST_DATABASE_URL` (`converter_test` or `converter_test_<suffix>`) and `TEST_REDIS_URL` after deploying migrations there. The suite uses real PostgreSQL/Redis/BullMQ, local controlled S3/SMTP, synthetic accounts and a random Redis namespace, and cleans only its own data. CI runs it in the database job. Offline unit/HTTP boundary tests remain in `test:all`; production SMTP, TLS ingress and browser integration require deployment verification.

## Guest credentials and trial accounting

`POST /api/v1/guest-session` accepts an empty JSON object and returns `200 { trialState: "available" | "reserved" | "consumed", activeConversionId: UUID | null }`. Bootstrap via `GET /api/v1/auth/csrf` first, then send the CSRF session cookie, exact `APP_ORIGIN` and `X-CSRF-Token`. Unknown body fields are rejected. Explicit API keys are rejected without fallback. Responses are `no-store`; no guest token or internal guest ID appears in JSON. Redis-backed limits allow 30 bootstrap requests/IP/minute and five new contexts/IP/15 minutes; denial returns `429` with `Retry-After`, unavailable dependencies fail closed.

HTTPS sets `__Host-converter.guest; Secure; HttpOnly; SameSite=Lax; Path=/` without Domain; loopback development HTTP uses `converter.dev.guest` without Secure. PostgreSQL stores only the SHA-256 hash of a random 32-byte token. `GUEST_CREDENTIAL_TTL_SECONDS` defaults to 30 days (validated range: three hours through 365 days). The cookie has an absolute `Expires`, never a rolling `Max-Age`; reuse preserves the original deadline and quota. Invalid, duplicated, unknown or expired presented credentials return `401 GUEST_CREDENTIAL_INVALID`, without silently creating a new allowance. Login/logout, revoked account sessions and lost Redis CSRF contexts do not replace the guest identity. Obtain a fresh CSRF context when needed; the retained guest cookie still proves guest ownership, never account authorization.

`GuestTrialService` exposes internal database-only helpers for future conversion adapters:

- `reserve(tx, principal, accept)` locks the guest row, validates hash/expiry/state and requires at least two hours of credential lifetime for a new admission. The callback creates input metadata, a queued conversion and durable `conversion_dispatch` intent in the same short transaction. Failure rolls everything back. A reserved trial rejects another admission with `409 GUEST_CONVERSION_IN_PROGRESS`; consumed rejects it with `401 GUEST_CONVERSION_LIMIT_REACHED`. Bootstrap itself still returns either state with `200`.
- `settle(tx, guestId, conversionId, expectedAttempt, work)` locks GuestSession before Conversion and fences the current processing version/token and unexpired lease. Result publication and trial consumption commit together. Completion uses fresh database time, a guest-owned present temporary output and an immutable one-hour result deadline within the credential lifetime. Transient retries retain the reservation; terminal failure releases only the matching reservation. Duplicate/late terminal callbacks do not execute work or change a newer reservation. `reconcileExpired` explicitly handles an expired current lease, permits failure/requeue and forbids successful publication.
- `ownedConversion(tx, principal, id)` revalidates the guest credential and restricts lookup to that guest. A retained cookie can resolve the original conversion after login without transferring it to the account or saving it. Future HTTP status/download adapters must select the correct principal and also enforce file expiry/deletion on every read.

Call these helpers inside a bounded caller-owned Prisma transaction (five-second timeout in tests); perform no storage, queue, SMTP or conversion work under database locks. Workers can import the narrow `GuestTrialModule` without HTTP/session middleware. Future conversion dispatch/reconciliation must finish or terminal-fail accepted work before credential expiry minus one hour; expired leases alone do not reset quota. These helpers and tests do not register conversion consumers, upload/status/download endpoints or frontend gateways. Guest trials are per browser context; clearing cookies can create a new context, subject to issuance limits.

Run `npm run test:guest` with explicit dedicated loopback `TEST_DATABASE_URL` and `TEST_REDIS_URL`, after deploying migrations to that test database. The separate Jest/Supertest suite uses real PostgreSQL/Redis and controlled local S3/SMTP fixtures, synthetic owned data and a random Redis namespace; CI runs it with the existing test services. It covers security, fixed lifetime, concurrency/rollback, attempt fencing/reconciliation, result-window enforcement, account independence and quota limits. Conversion-engine execution, real downloads and frontend integration remain future verification.

## Verification

`/account` now composes session-gated profile/security forms, shared auto-save settings and API-key management. Profile UI uses an optional name (80-character UI limit), email and current-password confirmation; new passwords retain the provisional 8–128-character UI limits. Email changes acknowledge pending verification; confirmed password changes clear inputs and return to sign-in. API secrets appear only after creation/rotation, support copy/manual-copy fallback, and are irreversibly hidden until another rotation. Passwords/full keys never enter Query/Mutation caches or browser storage. Ambiguous key responses block replay until metadata is read again. Settings share one query/mutation across consumers, serialize pending writes and reconcile uncertain responses. Ownership-bound gateway scopes and server validation remain transport/backend responsibilities.

Open [the account fixture](http://127.0.0.1:5173/test-fixtures/account/#/account) to inspect controlled states with invented credentials. Optional document scenarios: `success`, `anonymous`, `no-key`, `profile-read-error`, `settings-read-error`, `key-read-error`, `profile-error`, `settings-error`, `settings-unknown`, `key-unknown`. The confirmation value `wrong` simulates rejection. Fixture sessions/data reset on reload; no real keys are issued or revoked. Ordinary account routes have no private transport and clearly report unavailable data. The fixture is excluded from production assets.

`/files` composes a session-gated saved-file list and the same auto-save settings used in the profile. It supports debounced filename search, format filters, date ordering, cursor pagination, metadata details, independent Blob downloads and confirmed deletion. Read/next-page failures offer retry without clearing loaded rows; download denial removes the action and refreshes the list. Confirmed deletion updates every cached list for the same gateway scope; settings changes never delete existing files. Account/files pages load on demand. `FilesGateway` is a frontend port: finalized HTTP mapping belongs to item 8, while ownership, cursor validation, storage and deletion enforcement remain backend work.

Open [the files fixture](http://127.0.0.1:5173/test-fixtures/account/#/files) to exercise the list with five invented rows and small synthetic PNG/JPG/PDF downloads. Use `?scenario=empty#/files`, `?scenario=files-read-error#/files`, `?scenario=next-page-error#/files`, `?scenario=download-error#/files`, `?scenario=download-denied#/files` or `?scenario=delete-error#/files` under the same fixture path for controlled outcomes. These assets and gateway implementations are development-only. Neither production route substitutes fixture data for unavailable account/file APIs.

```sh
npm run test:all
npm run check
npm run test:e2e:install
npm run test:e2e
```

`test:all` runs all workspace tests and backend integrations in sequence, without requiring Docker, a running app, a database or browser installation. Vitest covers frontend unit/component tests and integration of session/settings components with a real QueryClient and controlled gateways. Jest/Nest Testing/Supertest cover configuration, HTTP bootstrap, dependency startup/rollback/shutdown, sanitized readiness and worker heartbeat. Local protocol fixtures exercise real S3 and SMTP SDK transports with synthetic data, without contacting external providers. Existing tests are preserved. See [Testing in TECH-STACK.md](docs/TECH-STACK.md#testing) for tools and scope.

`check` runs formatting, ESLint, all workspace typechecks, `test:all`, Prisma schema validation, generated-contract drift checks, and production builds. Playwright additionally verifies keyboard navigation, direct-route reloads, 404 recovery, mobile navigation, and responsive overflow. These checks do not establish that the planned server-backed product workflows work.

### Lint safeguards

`npm run lint` generates Prisma Client before typed analysis, checks the repository with zero warnings and runs the configuration regression tests (`npm run lint:config`). This also prepares the ignored client types for `npm run check` on clean checkouts. It uses the existing ESLint/typescript-eslint packages; no additional plugins are required.

- TypeScript uses `recommendedTypeChecked` and the nearest workspace TSConfig through `projectService`. This catches unhandled/misused promises, unsafe `any` operations, invalid `await`, and other type-dependent mistakes. TypeScript project analysis adds lint time; JavaScript tooling remains outside typed linting and generated files stay ignored. E2E has DOM types for code executed inside browser callbacks; the backend retains its own Node-only TSConfig.
- Static imports/re-exports enforce web/backend/contracts separation and the frontend direction `app → pages → features → shared` (direct downward imports are allowed). Browser/contracts code cannot import Node built-ins, NestJS, Prisma, or conversion engines; browser source also rejects Node globals. These rules inspect import strings, not a resolved dependency graph: dynamic imports, alternate aliases, cycles, and API/worker provider composition still require review. Extend the rules/tests when adding import aliases.
- Frontend-only `consistent-type-imports` keeps type dependencies explicit. Backend imports retain NestJS decorator/DI metadata. Existing Hooks and Fast Refresh rules remain enabled. Strict equality permits intentional `value == null` checks; `var` and unused ESLint suppressions fail lint. Prettier remains the formatting authority.

Research references: [typed linting](https://typescript-eslint.io/getting-started/typed-linting/), [promise checks](https://typescript-eslint.io/rules/no-misused-promises/), and [static import restrictions](https://eslint.org/docs/latest/rules/no-restricted-imports). `eslint-plugin-jsx-a11y` was evaluated but not installed: its current stable 6.10.2 release declares ESLint support only through v9, while this project uses v10 ([upstream compatibility](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/v6.10.2/package.json)). Revisit when a compatible stable release exists; static linting cannot replace keyboard/browser accessibility checks. Query-specific linting can be evaluated with the API hooks in plan item 8; import-graph, test-framework, and style plugins are deferred until a concrete gap justifies them.

At foundation setup, `npm audit --omit=dev` reports no known production vulnerabilities. The full audit reports 20 moderate findings in the Jest development dependency chain, originating from the `sprintf-js` precision-specifier advisory. The installed upstream line has no compatible fix; do not apply the audit's suggested Jest downgrade or an untested major override. Recheck when updating test tooling.

Playwright installs Chromium in the ignored project-local `.cache/ms-playwright`. On Linux CI, use `node scripts/playwright.mjs install --with-deps chromium`. A production web build must exist before running E2E tests; Playwright starts its own preview server.

```sh
npm run build
npm run start:api --workspace=@converter/backend
npm run start:worker --workspace=@converter/backend
```

## Database and contracts

The Prisma schema defines eight domain models with reviewed SQL constraints, partial indexes and ownership/publication guards. See [db-schema.md](docs/db-schema.md) for relationships, transaction responsibilities and the custom migration objects. `npm run db:validate` and `npm run db:generate` require no database connection. Backend build, typecheck, test and development scripts generate the ignored Prisma client automatically. Applying migrations is explicit: use `npm run db:migrate:deploy --workspace=@converter/backend` only for the intended `DATABASE_URL` target; do not run development migration commands in production. The runtime DatabaseService owns one Prisma client and one bounded pg pool per process.

`npm run test:database` runs the real migrations and constraint/concurrency tests against a dedicated local PostgreSQL 18 database supplied through `TEST_DATABASE_URL`. It creates and drops only a generated schema, fails without an explicit loopback test target, and never loads `.env` or falls back to `DATABASE_URL`. CI runs it in a separate PostgreSQL service job. The ordinary `test:all` command remains offline.

Prisma CLI configuration loads the root `.env`; the runtime application never imports the CLI. Prisma uses the existing PostgreSQL driver adapter. Pool sizing must account for API replicas, workers and migration/administrative headroom: each process uses up to `DATABASE_POOL_MAX` connections (default 5), with a statement timeout.

`packages/contracts/openapi.json` documents operational health routes, first-party auth/profile and guest bootstrap. `npm run contracts:generate` generates its TypeScript declarations; `npm run contracts:check` checks for drift without modifying the committed output. Finalize conversion/file contracts before implementing those routes.

### Frontend HTTP clients

`apps/web/src/shared/api` provides a shared Axios transport with finite timeouts, AbortSignal cancellation, measured upload progress and non-retrying requests. `VITE_API_BASE_URL` defaults to `/api/v1` and accepts only a root-relative same-origin path, matching the development proxy and production deployment. Request paths cannot contain absolute URLs, query strings or traversal; use explicit query parameters for reads. Errors expose only a safe category and HTTP status, without retaining Axios config, credentials, server messages or response bodies.

Cookie mutations require an explicitly supplied CSRF header/token from the eventual agreed backend handshake. The transport neither invents a token endpoint nor reads guessed CSRF cookies; automatic Axios XSRF injection is disabled. FormData is forwarded for the browser adapter to set multipart boundaries. Downloads require a successful nonempty Blob with an expected output MIME type and sanitize Content-Disposition filenames. They use relative application routes, never arbitrary server-returned storage URLs.

The health client imports generated OpenAPI types and validates runtime replies, including the documented 503 readiness payload. `readinessQuery` / `useApiReadiness` provide scoped caching, cancellation and moderate polling with slower polling after request failures. They are opt-in developer building blocks, not a new product status interface or an authorization signal. They are not mounted by production bootstrap.

Product gateway adapters remain blocked on finalized OpenAPI schemas: auth/session and CSRF handshake, guest eligibility response, complete conversion status/result metadata, profile/settings/key operations, and file-list filters/pagination. Existing feature hooks already implement job polling, cache reconciliation, private-cache clearing and ambiguous-POST safeguards; preserve them when mapping finalized wire contracts to frontend view models. Production conversion/auth/account/files gateways remain unavailable. Live product integration requires the backend operations from plan items 11–16; controlled transport tests do not establish real authentication or conversion.

### Runtime integrations

`apps/backend/src/infrastructure` contains separate configuration, database, Redis, queue, storage, email and health modules. `ApiModule.withInfrastructure()` and `WorkerModule.withInfrastructure()` compose them; only the API exposes HTTP. The production entry points additionally compose authentication/guest modules and worker-only notifications respectively. Conversion consumers remain pending.

- Redis session/rate-limit prefixes and the BullMQ queue prefix are distinct under `REDIS_NAMESPACE`. BullMQ 6 receives a dedicated node-redis connection; session/rate-limit use another connection. Offline buffering is disabled, reconnect backoff is capped, and operations/startup/shutdown have deadlines. Future consumers must have their own appropriate connections.
- StoragePort supports generated input/output keys and authenticated streamed operations, without public URLs or ACLs. Provision a **private** bucket with anonymous access blocked and narrowly scoped credentials. Readiness uses HeadBucket to check access/availability; it does not attest bucket policy or object ownership. Authorization and upload validation remain future product responsibilities.
- EmailService verifies SMTP connectivity without sending mail. Local development delivers to Mailpit; production requires TLS and a verified sender/provider. Pooled sending disables file/URL content loading. The notification worker sends verification/recovery/email-change messages from committed encrypted intents.
- Zod validates configuration without echoing rejected secrets. Production has no integration credential defaults; S3 requires HTTPS, Redis requires a password and SMTP requires TLS. Use trusted private networks for database/Redis or verified TLS endpoints as appropriate; never disable certificate validation.
- Readiness returns only dependency names and up/down states, cached for `HEALTH_CHECK_INTERVAL_MS`; unavailable dependencies return 503. Worker writes an atomic PID/timestamp/readiness marker under its private `WORKER_TEMP_DIR`. Run `node apps/backend/dist/worker/infrastructure/health/worker-probe.js` from the repository root to probe it; production Compose uses this instead of opening an HTTP port. The marker checks infrastructure, not conversion progress.
- SIGTERM/SIGINT close HTTP/context, clients, pools and timers within `SHUTDOWN_TIMEOUT_MS`. Keep container stop grace longer than this deadline. The production defaults are 20s shutdown and 30s grace. Increase infrastructure/transfer timeouts and probe/container budgets together when needed; default network operations are bounded at 5s.

`npm run test:infrastructure` is a separate live suite requiring explicit loopback `TEST_DATABASE_URL` (a converter_test database with migrations applied) and `TEST_REDIS_URL`. It checks real PostgreSQL, Redis and BullMQ together with controlled local S3/SMTP fixtures. It never reads integration credentials from `.env`, flushes Redis globally or uses the product queue: keys/jobs use a generated test namespace. CI supplies PostgreSQL 18 and Redis 8. This suite is deliberately excluded from offline `test:all`.

## Docker deployment foundation

`infra/compose.yaml` is local infrastructure. `infra/compose.production.yaml` is a standalone production definition, not an overlay that inherits development port bindings.

API, worker, and proxy each have their own multi-stage Dockerfile. The worker image alone installs LibreOffice Writer, fonts, and sandbox tooling. Container limits are prepared; the per-conversion sandbox runner is not implemented, and untrusted files must not be processed until it is.

Copy `.env.production.example` to an untracked `.env.production` and provide real credentials. In production, `DATABASE_URL` must reach `postgres:5432`, and `REDIS_URL` must reach `redis:6379` with the configured password; encode password characters correctly in URLs.

```sh
npm run infra:production:config
docker compose --env-file .env.production -f infra/compose.production.yaml build
```

Only the proxy publishes a host port. This template requires HTTPS termination on the server's ingress/load balancer before port 8080; certificates are not provisioned here. Restrict direct HTTP access to that ingress. Set `APP_ORIGIN` to the public HTTPS origin, provide independent session/outbox keys and set `AUTH_TRUSTED_PROXIES` to the exact proxy and ingress IPs/CIDRs. The ingress must replace untrusted forwarded headers; Nginx appends its peer address and supplies the fixed HTTPS scheme expected by this deployment. Never trust all addresses. Secure-cookie issuance and client-IP limits depend on this chain; verify them at deployment. Access logs exclude query strings/referrers. Pin validated image digests at release time. Backups, migration release job, real-provider delivery/storage checks and converter sandbox verification remain prerequisites; dependency readiness alone does not prove them.

`npm run infra:down` stops local infrastructure and retains named volumes. No reset/delete-volume command is included.

## Local development instructions

Open this project directory itself in Codex so its [AGENTS.md](AGENTS.md) and repository skills can be discovered. The index explicitly routes to the applicable local rules; [progress.md](docs/progress.md) records meaningful changes. The documented policy is one successful free guest conversion, followed by login/registration for further conversions; the foundation does not implement this flow yet.
