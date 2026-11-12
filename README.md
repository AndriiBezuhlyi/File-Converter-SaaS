# Flux Converter

The React frontend includes live email authentication, profile/password changes, synchronized auto-save settings, API-key management and conversion upload/poll/download through typed HTTP gateways. PostgreSQL/Prisma persistence, shared infrastructure, Redis sessions, protected guest credentials and worker-only notification/conversion delivery are implemented. The documented static-image matrix and DOCX/ODT/XLSX/PPTX/CSV/TXT → PDF run in isolated Linux subprocesses. Saved-file listing/deletion and periodic storage cleanup are implemented.

## Requirements and documentation

- [Technical task](docs/technical-task.md)
- [Architecture](docs/architecture.md)
- [Design system](DESIGN.md)
- [Technology inventory and compatibility notes](docs/TECH-STACK.md)
- [Database schema and migration workflow](docs/db-schema.md)

Use Node.js 24 LTS (minimum 24.11.1), npm 11.21.1 (the `packageManager` pin), and Docker with Compose v2 for infrastructure. This npm version correctly applies scoped security overrides across workspace links. Install from the repository root; one root lockfile covers all workspaces. CI and Docker invoke a local copy of the pinned npm without replacing the system installation.

## Setup

```sh
npm ci
```

If the system npm differs from the pin, use a local CLI without changing global tools:

```sh
npm install --prefix .cache/tools/npm --no-save --ignore-scripts --no-audit --no-fund npm@11.21.1
node .cache/tools/npm/node_modules/npm/bin/npm-cli.js ci
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
- API: http://127.0.0.1:3000; health, auth/profile/settings/keys, guest, capabilities, conversions and saved-file operations in [OpenAPI](packages/contracts/openapi.json).
- Worker: no HTTP listener; processes email notifications and conversions, with dependency/consumer readiness in a private heartbeat. Conversion startup requires the bounded Linux sandbox described below.

Backend development builds preserve TypeScript decorator metadata, then restart the selected process when its source changes. Separate output directories prevent the API and worker from overwriting each other. No global Nest CLI is needed.

The backend uses native ESM for NestJS 12. Relative TypeScript imports use `.js` extensions for the emitted Node.js files. Jest runs with VM modules and ts-jest ESM compilation; the resulting Node experimental warning is limited to test execution.

Frontend layout, providers, and routing live in `apps/web/src/app`; pages compose shared components from `shared/ui`. The documented routes connect implemented workflows through LiveApp HTTP gateways. Onest and IBM Plex Mono are self-hosted with Latin/Ukrainian glyphs and SIL OFL licenses in `apps/web/public/fonts`. Implement the remaining features in the order recorded in [the implementation plan](docs/implementation-plan.md).

The converter feature supports one local JPG/JPEG, PNG, WebP, AVIF, static GIF, restricted static SVG, or DOCX/ODT/XLSX/PPTX/CSV/TXT document via picker or drag-and-drop. It shows filename/size, selects targets from the static image matrix below or document → PDF, and rejects empty, unsupported, multiple, directory, and oversized inputs without discarding a previous valid selection. The local limit is 20,000,000 bytes (decimal MB), centralized in `features/converter/lib/file-selection.ts`; this local constant matches the implemented capabilities endpoint, but the frontend does not fetch capabilities dynamically. These metadata checks do not inspect file contents. File/target drafts stay in the app-level ConverterDraftProvider memory across SPA navigation for up to 30 idle minutes. Reload/tab close, identity change, session expiry, explicit clearing or matching job completion clears the draft; no browser persistence stores file bytes. The production entry injects the live conversion gateway; the server owns upload validation, processing, persistence and guest quota enforcement.

The conversion UI uses a feature-local `ConversionGateway` port, mapped from generated API contracts by `conversion-http-gateway.ts`, including guest/session access, CSRF, uploads and protected downloads. TanStack Query owns access/job data; local state owns selection, measured upload bytes, dialogs, and transient feedback. The flow rechecks access before submission, blocks duplicate clicks, distinguishes upload/acceptance/queued/processing/completed/failed, polls active jobs every 1.5 seconds with a 30-second interval after connectivity errors, stops terminal polling, and preserves a non-secret `conversion` ID in the URL. Ambiguous POST outcomes are never replayed automatically; without a discoverable accepted ID they remain blocked pending contract-backed recovery. Trial state is read from the gateway, never counted or stored in the browser. Downloads use returned Blobs, sanitized filenames, and short-lived object URLs, not arbitrary redirect URLs. Expiry/denial removes the download action without turning success into conversion failure or renewing a trial. The native auth dialog gates the next guest conversion, keeps selection in memory while open, and restores focus on close. SPA navigation preserves the draft within the same identity; signing in changes identity and clears it. A known accepted job can still be resumed by ID.

For controlled UI verification, run `npm run dev:web` and open [the development-only converter fixture](http://127.0.0.1:5173/test-fixtures/converter/?scenario=success). `scenario` accepts `success`, `failed`, `connection`, `unknown`, `expired`, `saved`, `reserved`, `consumed`, `download-error`, `download-expired`, `unmeasured`, and `rejected`. To check expiry discovered only when downloading, open `?scenario=download-expired&conversion=fixture_job`: the result starts available, then the download is denied while completion and the consumed guest allowance are preserved. The fixture is visibly labeled, accepts JPG → PNG for its one known synthetic PNG output, and never converts the source or calls product endpoints. It is a separate HTML entry under `apps/web/test-fixtures`, absent from the production bundle; no runtime mock switch is exposed by the application. Chromium E2E uses a separate Vite server on 4174 for these scenarios and the existing production preview on 4173 for ordinary routes. These responses do not establish real authentication, durable guest accounting, ownership enforcement, or live conversion. Those remain backend/integration work.

Authentication interfaces live at `/login`, `/register`, `/verify-email`, `/forgot-password`, and `/reset-password`. React Hook Form/Zod validate labeled fields, confirmation and email; passwords are never trimmed. New-password UI and backend policy both use 10–128 Unicode code points with local common/expected-password screening. Production `LiveApp` maps the OpenAPI contract to `AuthGateway`, preserves cookie/CSRF rotation, and consumes email-link tokens in memory after removing them from the URL. Forms already support password managers, pending/error feedback and duplicate-submit guards; session state uses TanStack Query. Passwords/link tokens must stay out of caches/storage. Verification requires an explicit action; reset never automatically signs in. Signing in does not save or transfer a guest result.

For controlled auth flows, open [the development-only authentication fixture](http://127.0.0.1:5173/test-fixtures/auth/#/login). It uses hash routes so reloads keep the separate fixture entry. The optional document query `scenario` accepts `success`, `signed-in`, `unverified`, `invalid-credentials`, `network`, `rate-limited`, `session-error`, and `logout-error`, for example `?scenario=logout-error#/`. Synthetic verification/reset links use `#/verify-email?token=fixture-token` or `#/reset-password?token=fixture-token`; other token values simulate invalid/expired links. Use invented credentials only. No emails or product requests are sent, and reloading resets the fixture's in-memory session. This entry and its gateway are excluded from production assets. It demonstrates UI transitions, not genuine account security or server-side expiry/revocation.

`/api-docs` documents the seven implemented conversion/file integration operations with placeholder examples, API-key rules, polling/retention and errors. [OpenAPI](packages/contracts/openapi.json) additionally describes operational health, first-party auth/profile/settings/key management, guest bootstrap, registration status and public capabilities. The production proxy forwards `/api/` routes; cookie-only operations are not third-party API-key integrations. Public capabilities require no credentials. Deployment availability is not established by these definitions. The documentation page sends no example requests; the app shell may read the session.

## Authentication backend

`ApiModule.withAuthentication()` composes the existing infrastructure with Auth/Users/Guest modules. `WorkerModule.withNotifications()` alone imports notification consumers; API replicas do not consume jobs. The offline/infrastructure-only module compositions remain available for focused tests.

All paths below have `/api/v1` prefix. DTOs reject unknown fields; email is trimmed/lowercase (maximum 254), display name is trimmed/optional text (maximum 80), and new passwords are 10–128 Unicode code points, including spaces, without trimming or normalization. A bundled curated local common/expected-password baseline rejects case-insensitive matches, including predictable product-name variants; it is not comprehensive breach detection. Length failures retain `VALIDATION_FAILED`; screening failures return `PASSWORD_POLICY_REJECTED` before registration/change/reset mutations, including reset-token consumption. Existing sign-in/current passwords accept 1–128 characters. See [OpenAPI](packages/contracts/openapi.json) for exact schemas and generated types.

| Operation                           | Request                                     | Success                                                               |
| ----------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| `GET /auth/csrf`                    | Same-origin cookie request                  | `200 { csrfToken }`                                                   |
| `GET /auth/session`                 | Cookie, if present                          | `200` anonymous or authenticated session                              |
| `POST /auth/register`               | email, password; optional trackStatus: true | Neutral `202 { status: "accepted" }`, optionally registration receipt |
| `POST /auth/login`                  | email, password                             | `200` authenticated session; SID/CSRF rotate                          |
| `POST /auth/logout`                 | No body                                     | `204`, current session revoked                                        |
| `POST /auth/verification/resend`    | email                                       | Neutral `202`                                                         |
| `POST /auth/verify-email`           | token                                       | `204`, registration/email change confirmed                            |
| `POST /auth/password-reset/request` | email                                       | Neutral `202`                                                         |
| `POST /auth/password-reset/confirm` | token, newPassword                          | `204`, all account sessions revoked                                   |
| `GET /users/me`                     | Authenticated cookie                        | `200` profile                                                         |
| `PATCH /users/me`                   | displayName, email, currentPassword         | `200 { profile, verificationRequired }`                               |
| `POST /users/me/password`           | currentPassword, newPassword                | `204`, all account sessions revoked                                   |

Bootstrap with `GET /auth/csrf` and keep the returned token in memory. Every mutation, including anonymous registration/login/recovery/logout, requires the same cookie, exact configured `Origin` and `X-CSRF-Token`. After login fetch a fresh CSRF token; after logout bootstrap a new context. No permissive CORS is enabled. Explicit `X-API-Key` is rejected on these first-party operations. Auth/profile responses and errors use `Cache-Control: no-store`; health keeps its existing operational response shape.

With `trackStatus: true`, registration also returns `registration: { receipt, expiresAt }`. `POST /auth/registration/status` accepts `{ receipt }` in the same session with Origin/CSRF and returns `200 { status: "pending" | "verified" | "expired" }`. The 15-minute status-only receipt never authenticates or verifies email. Wrong-session/expired/invalidated correlations return expired; duplicate decoys stay pending until expiry. Its limits are 30/session/minute and 60/IP/minute plus the global limit. Cross-tab messages trigger a backend recheck, never establish verification themselves. Keep receipts only in memory.

Anonymous Redis contexts expire after 15 minutes. Authenticated sessions expire after 30 idle minutes or seven days absolutely. HTTPS uses `__Host-converter.sid; Secure; HttpOnly; SameSite=Lax; Path=/` without Domain. Development-only HTTP is permitted for loopback `APP_ORIGIN` and uses `converter.dev.sid` without Secure. SID rotation/logout write atomic Redis revocation tombstones, preventing late requests from resurrecting a discarded SID. Every authenticated request reads PostgreSQL `sessionVersion`; password change/reset and completed email change increment it transactionally, without a validity cache. Redis failure returns `503` and never falls back to memory.

Only verified accounts sign in. Wrong credentials return `401 INVALID_CREDENTIALS`; a correct password for an unverified account returns `403 EMAIL_NOT_VERIFIED`. Registration/resend/recovery acknowledgements do not disclose account existence. Profile/password changes require the current password; new email stays pending until confirmed. One-time tokens are purpose-bound, hashed in PostgreSQL and limited to five failed secret attempts. Verification expires after 24 hours, recovery/email change after 30 minutes. Resend replaces the prior token; credential changes invalidate pending tokens. Verification/reset do not automatically sign in.

Notifications persist in `BackgroundTask` in the same transaction as the account/token change. AES-256-GCM encrypts delivery material with task/version-bound authenticated data; BullMQ carries only `{ taskId }`. A worker reconciles pending intents every five seconds, claims a 60-second lease, sends through the existing SMTP adapter and conditionally completes the current lease. Delivery is at least once: a crash after SMTP acceptance may produce the same safe single-use link again. Five durable attempts use exponential delays; monitor `lastErrorCode`, attempts and pending age, and request a fresh link after exhaustion. Completed/skipped intents erase ciphertext. Keep the encryption key stable across API/worker replicas and backups until pending intents are drained; replacing it makes existing encrypted intents unreadable. Never log request bodies, cookies, tokens, keys or delivery contents.

Email links use `/verify-email#token=...` or `/reset-password#token=...`: the fragment never reaches HTTP/proxy logs. The live frontend captures the fragment in memory, removes it from the URL and explicitly submits the token in a JSON body; verification never automatically signs in.

| Distributed limit                                  | Quota                                               |
| -------------------------------------------------- | --------------------------------------------------- |
| All auth/profile requests                          | 120 per IP/minute                                   |
| CSRF bootstrap/read                                | 30 per IP/minute                                    |
| Login                                              | 10 per IP/minute and normalized-email/minute        |
| Registration/resend/reset request, combined        | 5 per IP/15 minutes and 3 per normalized email/hour |
| Token consumption, combined                        | 10 per IP/minute                                    |
| Confirmed profile/password/key mutations, combined | 5 per user/15 minutes                               |

Atomic Redis counters use HMAC-derived identity keys. Excess returns `429 RATE_LIMITED` with `Retry-After`; unavailable Redis fails closed. Current windows are fixed from the first attempt. Validation/token failures use `400`, missing sessions `401`, CSRF/origin/current-password failures `403`, unavailable profile email `409`, and infrastructure failures `503`, in `{ error: { code, message } }` without internal diagnostics.

Run `npm run test:auth` with explicit dedicated loopback `TEST_DATABASE_URL` (`converter_test` or `converter_test_<suffix>`) and `TEST_REDIS_URL` after deploying migrations there. The suite uses real PostgreSQL/Redis/BullMQ, local controlled S3/SMTP, synthetic accounts and a random Redis namespace, and cleans only its own data. CI runs it in the database job. Offline unit/HTTP boundary tests remain in `test:all`; production SMTP, TLS ingress and browser integration require deployment verification.

## Account settings and API keys

All operations below require a verified first-party account session. Mutations also require the exact `APP_ORIGIN` and synchronizer `X-CSRF-Token`; key mutations confirm `currentPassword`. Guest cookies and any explicit `X-API-Key` are rejected. Responses use `Cache-Control: no-store`.

| Method | Path                              | Response                                          |
| ------ | --------------------------------- | ------------------------------------------------- |
| GET    | `/api/v1/users/me/settings`       | `200 { autoSave: boolean }`                       |
| PATCH  | `/api/v1/users/me/settings`       | Body and response: `{ autoSave: boolean }`        |
| GET    | `/api/v1/users/me/api-key`        | `200 { key: { prefix, createdAt } \| null }`      |
| POST   | `/api/v1/users/me/api-key`        | `201 { metadata: { prefix, createdAt }, secret }` |
| POST   | `/api/v1/users/me/api-key/rotate` | `200` with the same one-time issuance shape       |
| DELETE | `/api/v1/users/me/api-key`        | `204`; repeated revocation is safe                |

Auto-save defaults to false, persists per account and uses the same Query key/mutation on profile and files pages. Updating it never changes existing files or accepted conversions; acceptance-time policy remains the responsibility of the conversion lifecycle. Saved-file listing is implemented through the owning account/API-key boundary.

Keys use a random public lookup prefix and 256-bit secret (`fc_<24 hex>.<43 base64url>`). PostgreSQL stores only SHA-256 of the full high-entropy credential. Creation rejects an existing active key (`409 API_KEY_EXISTS`); rotation requires one (`409 API_KEY_MISSING`). Short user-row-locked transactions serialize create/rotate/revoke and recheck the session snapshot; the existing partial unique index provides the database invariant. Rotation/revocation takes effect at commit for subsequent authentication checks, without a validity cache. Already-authorized requests are not retroactively cancelled.

`ApiKeysService.authenticate` provides the API-key principal. Conversion/file routes use `ConversionBoundaryGuard` for key precedence, cookie authorization and shared distributed limits (120/minute per IP and principal for reads; 20/IP/minute and 10/principal/minute for mutations). Consumers import `ApiKeysModule` and `AuthSecurityModule`. Malformed, incorrect and revoked explicit keys return `401 API_KEY_INVALID`, with no cookie fallback. Conversion controllers compose these permissions with account/guest authorization; file/download routes enforce the same owner boundary.

Run `npm run test:account` with explicit dedicated loopback `TEST_DATABASE_URL` and `TEST_REDIS_URL`, after deploying existing migrations there. The suite uses real PostgreSQL/Redis and controlled local S3/SMTP fixtures. It checks permission boundaries, password/CSRF/Origin validation, one-active-key concurrency, rollback, stale sessions, immediate revocation and rate limits. It creates and cleans only owned synthetic data. CI runs it in the database job.

## Validated conversion admission and polling

- `GET /api/v1/capabilities` publishes the authoritative 20,000,000-byte input limit, supported directions and 1,500 ms polling interval.
- `POST /api/v1/conversions` accepts exactly one multipart `file` and `targetFormat` (the static image matrix below or DOCX/ODT/XLSX/PPTX/CSV/TXT to PDF), returning `202` with a queued UUID, formats, timestamp and acceptance-time `saveResult`. Explicit API keys take precedence without cookie fallback. Cookie submissions require the existing CSRF handshake and exact application Origin; bootstrap a guest cookie separately.
- Uploads stream to a private process-owned staging directory. Each API process admits four concurrent uploads with a 60-second deadline; per-file limits bound active staging to approximately 80 MB. Abort/error cleanup releases slots only after Multer settles. Distributed limits allow 20 submissions/IP/minute and 10/principal/minute, with separate 120/minute polling counters. Admission serializes active-job counts across replicas (five per owner, 1,000 globally).
- Signatures and bounded Sharp metadata determine image types and enforce 40 million pixels. DOCX validation checks ZIP directory/local-header agreement, CRC, entry count (1,000), expanded bytes (80 MB) and per-entry ratio (200:1). The accepted subset excludes ZIP64, encryption, path traversal, macros, embedded programs, external relationships and alternate XML encodings. Full image/document decoding remains the isolated worker's responsibility.
- Private object upload precedes a short transaction creating input metadata, the conversion, the account settings snapshot (false for guests), durable dispatch intent and atomic guest reservation. A stable BullMQ job ID enables immediate best-effort dispatch. Once accepted, queue failure retains `202 queued` and the intent; the worker reconciles durable intents. Ambiguous transaction acknowledgement never deletes a possibly committed source. Durable deletion intents and periodic cleanup reconcile uncertain/orphan objects and crash staging.
- `GET /api/v1/conversions/:id` checks account/API ownership or the retained owning guest capability, including after login or a stale account session. Poll queued/processing every 1.5 seconds and back off on connectivity errors. Unknown/unowned IDs return 404. Failed jobs return HTTP 200 with a safe error; completed state and result availability (available/expired/deleted) are independent. Responses expose result metadata, never object keys or storage URLs.
- Rejections use `{ error: { code, message } }`; malformed multipart is 400, oversized bytes 413, unknown signatures 415, unsafe content/directions 422 and capacity 429. All conversion responses are no-store. An ambiguous POST must not be automatically retried.

Run `npm run test:conversions` with explicit loopback `TEST_DATABASE_URL` (a dedicated `converter_test` database with migrations deployed) and `TEST_REDIS_URL`. The suite uses real PostgreSQL/Redis/BullMQ and controlled local S3/SMTP protocol fixtures. It does not execute conversion engines or prove production object-store configuration. Processing/reconciliation, protected downloads and periodic cleanup are implemented in items 15 and 16.

## Guest credentials and trial accounting

`POST /api/v1/guest-session` accepts an empty JSON object and returns `200 { trialState: "available" | "reserved" | "consumed", activeConversionId: UUID | null }`. Bootstrap via `GET /api/v1/auth/csrf` first, then send the CSRF session cookie, exact `APP_ORIGIN` and `X-CSRF-Token`. Unknown body fields are rejected. Explicit API keys are rejected without fallback. Responses are `no-store`; no guest token or internal guest ID appears in JSON. Redis-backed limits allow 30 bootstrap requests/IP/minute and five new contexts/IP/15 minutes; denial returns `429` with `Retry-After`, unavailable dependencies fail closed.

HTTPS sets `__Host-converter.guest; Secure; HttpOnly; SameSite=Lax; Path=/` without Domain; loopback development HTTP uses `converter.dev.guest` without Secure. PostgreSQL stores only the SHA-256 hash of a random 32-byte token. `GUEST_CREDENTIAL_TTL_SECONDS` defaults to 30 days (validated range: three hours through 365 days). The cookie has an absolute `Expires`, never a rolling `Max-Age`; reuse preserves the original deadline and quota. Invalid, duplicated, unknown or expired presented credentials return `401 GUEST_CREDENTIAL_INVALID`, without silently creating a new allowance. Login/logout, revoked account sessions and lost Redis CSRF contexts do not replace the guest identity. Obtain a fresh CSRF context when needed; the retained guest cookie still proves guest ownership, never account authorization.

`GuestTrialService` exposes internal database-only helpers used by conversion admission, worker publication and lease recovery:

- `reserve(tx, principal, accept)` locks the guest row, validates hash/expiry/state and requires at least two hours of credential lifetime for a new admission. The callback creates input metadata, a queued conversion and durable `conversion_dispatch` intent in the same short transaction. Failure rolls everything back. A reserved trial rejects another admission with `409 GUEST_CONVERSION_IN_PROGRESS`; consumed rejects it with `401 GUEST_CONVERSION_LIMIT_REACHED`. Bootstrap itself still returns either state with `200`.
- `settle(tx, guestId, conversionId, expectedAttempt, work)` locks GuestSession before Conversion and fences the current processing version/token and unexpired lease. Result publication and trial consumption commit together. Completion uses fresh database time, a guest-owned present temporary output and an immutable one-hour result deadline within the credential lifetime. Transient retries retain the reservation; terminal failure releases only the matching reservation. Duplicate/late terminal callbacks do not execute work or change a newer reservation. `reconcileExpired` explicitly handles an expired current lease, permits failure/requeue and forbids successful publication.
- `ownedConversion(tx, principal, id)` revalidates the guest credential and restricts lookup to that guest. A retained cookie can resolve the original conversion after login without transferring it to the account or saving it. The status adapter selects the correct principal and reports file expiry/deletion; downloads enforce the same ownership and expiry rules.

Call these helpers inside a bounded caller-owned Prisma transaction (five-second timeout in tests); perform no storage, queue, SMTP or conversion work under database locks. Workers can import the narrow `GuestTrialModule` without HTTP/session middleware. Future conversion dispatch/reconciliation must finish or terminal-fail accepted work before credential expiry minus one hour; expired leases alone do not reset quota. Conversion admission/status now compose these helpers. Conversion consumers, download endpoints and frontend gateways remain separate work. Guest trials are per browser context; clearing cookies can create a new context, subject to issuance limits.

Run `npm run test:guest` with explicit dedicated loopback `TEST_DATABASE_URL` and `TEST_REDIS_URL`, after deploying migrations to that test database. The separate Jest/Supertest suite uses real PostgreSQL/Redis and controlled local S3/SMTP fixtures, synthetic owned data and a random Redis namespace; CI runs it with the existing test services. It covers security, fixed lifetime, concurrency/rollback, attempt fencing/reconciliation, result-window enforcement, account independence and quota limits. Real engine execution, downloads and frontend integration are covered separately by the item 15 checks described below.

## Verification

`/account` now composes session-gated profile/security forms, shared auto-save settings and API-key management. Profile UI uses an optional name (80-character UI limit), email and current-password confirmation; new passwords mirror the server’s 10–128 Unicode code-point policy and local screening. Email changes acknowledge pending verification; confirmed password changes clear inputs and return to sign-in. API secrets appear only after creation/rotation, support copy/manual-copy fallback, and require an explicit Hide confirmation before their in-memory reveal is cleared. Cancel/Escape preserve the secret; hiding does not revoke the key, and revocation remains a separate operation. Passwords/full keys never enter Query/Mutation caches or browser storage. Ambiguous key responses block replay until metadata is read again. Settings share one query/mutation across consumers, serialize pending writes and reconcile uncertain responses. Ownership-bound gateway scopes and server validation remain transport/backend responsibilities.

Open [the account fixture](http://127.0.0.1:5173/test-fixtures/account/#/account) to inspect controlled states with invented credentials. Optional document scenarios: `success`, `anonymous`, `no-key`, `profile-read-error`, `settings-read-error`, `key-read-error`, `profile-error`, `settings-error`, `settings-unknown`, `key-unknown`. The confirmation value `wrong` simulates rejection. Fixture sessions/data reset on reload; no real keys are issued or revoked. Ordinary account routes have no private transport and clearly report unavailable data. The fixture is excluded from production assets.

`/files` composes a session-gated saved-file list and the same auto-save settings used in the profile. It supports debounced filename search, format filters, date ordering, cursor pagination, metadata details, independent Blob downloads and confirmed deletion. Read/next-page failures offer retry without clearing loaded rows; download denial removes the action and refreshes the list. Confirmed deletion updates every cached list for the same gateway scope; settings changes never delete existing files. Account/files pages load on demand. `FilesGateway` has a live HTTP adapter; backend services enforce ownership, cursor validation, storage and deletion.

Open [the files fixture](http://127.0.0.1:5173/test-fixtures/account/#/files) to exercise the list with five invented rows and small synthetic PNG/JPG/PDF downloads. Use `?scenario=empty#/files`, `?scenario=files-read-error#/files`, `?scenario=next-page-error#/files`, `?scenario=download-error#/files`, `?scenario=download-denied#/files` or `?scenario=delete-error#/files` under the same fixture path for controlled outcomes. These assets and gateway implementations are development-only. Neither production route substitutes fixture data for unavailable account/file APIs.

```sh
npm run test:all
npm run check
npm run test:e2e:install
npm run test:e2e
```

`test:all` runs all workspace tests and backend integrations in sequence, without requiring Docker, a running app, a database or browser installation. Vitest covers frontend unit/component tests and integration of session/settings components with a real QueryClient and controlled gateways. Jest/Nest Testing/Supertest cover configuration, HTTP bootstrap, dependency startup/rollback/shutdown, sanitized readiness and worker heartbeat. Local protocol fixtures exercise real S3 and SMTP SDK transports with synthetic data, without contacting external providers. Existing tests are preserved. See [Testing in TECH-STACK.md](docs/TECH-STACK.md#testing) for tools and scope.

`check` runs formatting, ESLint, all workspace typechecks, `test:all`, Prisma schema validation, generated-contract drift checks, and production builds. Playwright additionally verifies keyboard navigation, direct-route reloads, 404 recovery, mobile navigation, and responsive overflow. These checks alone do not establish real-engine or production-provider functionality.

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

`apps/web/src/shared/api` provides a shared Axios transport with finite timeouts, AbortSignal cancellation, measured upload progress and non-retrying requests. `VITE_API_BASE_URL` defaults to `/api/v1` and accepts only a root-relative same-origin path, matching the development proxy and production deployment. Request paths cannot contain absolute URLs, query strings or traversal; use explicit query parameters for reads. Errors expose only a safe category, HTTP status and bounded machine error code, without retaining Axios config, credentials, server messages or response bodies.

Cookie mutations use `SessionClient`, which reads the current token from `GET /auth/csrf` before each mutation, including after session rotation. Tokens stay outside Query caches and browser storage; automatic Axios XSRF injection is disabled. FormData is forwarded for the browser adapter to set multipart boundaries. Downloads require a successful nonempty Blob with an expected output MIME type and sanitize Content-Disposition filenames. They use relative application routes, never arbitrary server-returned storage URLs.

The health client imports generated OpenAPI types and validates runtime replies, including the documented 503 readiness payload. `readinessQuery` / `useApiReadiness` provide scoped caching, cancellation and moderate polling with slower polling after request failures. They are opt-in developer building blocks, not a new product status interface or an authorization signal. They are not mounted by production bootstrap.

Production `LiveApp` connects auth/session, profile/settings and key gateways using generated OpenAPI types and runtime decoders. Account data is scoped by identity and cleared after identity changes. Settings use TanStack Query mutations; password and key operations use request closures so credentials and one-time secrets never enter mutation caches. Key metadata alone is cached; ambiguous issuance responses require explicit reconciliation. Email-link fragments are consumed in memory and scrubbed from the URL; new-password forms match the server's 10–128 Unicode code-point policy and limited local common/expected-password screening. The owner retained the 10-character minimum; existing login/current-password proof and Argon2id parameters are unchanged. Policy copies stay within backend/frontend module boundaries and have an exact-parity regression test. Maintainers update the bundled baseline through reviewed Git changes; no external service is queried and a missing policy module fails loading rather than disabling screening. LiveApp also wires guest/conversion/file gateways; controlled transport tests alone do not establish real conversion.

### Runtime integrations

`apps/backend/src/infrastructure` contains separate configuration, database, Redis, queue, storage, email and health modules. `ApiModule.withInfrastructure()` and `WorkerModule.withInfrastructure()` compose them; only the API exposes HTTP. Production uses `ApiModule.withAuthentication()` and `WorkerModule.withProcessors()`. API replicas never register consumers.

- Redis session/rate-limit prefixes and the BullMQ queue prefix are distinct under `REDIS_NAMESPACE`. BullMQ 6 receives a dedicated node-redis connection; session/rate-limit use another connection. Offline buffering is disabled, reconnect backoff is capped, and operations/startup/shutdown have deadlines. Future consumers must have their own appropriate connections.
- StoragePort supports generated input/output keys and authenticated streamed operations, without public URLs or ACLs. Provision a **private** bucket with anonymous access blocked and narrowly scoped credentials. Readiness uses HeadBucket to check access/availability; it does not attest bucket policy or object ownership. Conversion/file services enforce ownership and upload validation above this adapter.
- EmailService verifies SMTP connectivity without sending mail. Local development delivers to Mailpit; production requires TLS and a verified sender/provider. Pooled sending disables file/URL content loading. The notification worker sends verification/recovery/email-change messages from committed encrypted intents.
- Zod validates configuration without echoing rejected secrets. Production has no integration credential defaults; S3 requires HTTPS, Redis requires a password and SMTP requires TLS. Use trusted private networks for database/Redis or verified TLS endpoints as appropriate; never disable certificate validation.
- Readiness returns only dependency names and up/down states, cached for `HEALTH_CHECK_INTERVAL_MS`; unavailable dependencies return 503. Worker writes an atomic PID/timestamp/readiness marker under its private `WORKER_TEMP_DIR`. Run `node apps/backend/dist/worker/infrastructure/health/worker-probe.js` from the repository root to probe it; production Compose uses this instead of opening an HTTP port. The marker checks infrastructure, notification/conversion consumer readiness and reconciliation health; it is not a conversion progress estimate.
- SIGTERM/SIGINT close HTTP/context, clients, pools and timers within `SHUTDOWN_TIMEOUT_MS`. Keep container stop grace longer than this deadline. The production defaults are 20s shutdown and 30s grace. Increase infrastructure/transfer timeouts and probe/container budgets together when needed; default network operations are bounded at 5s.

`npm run test:infrastructure` is a separate live suite requiring explicit loopback `TEST_DATABASE_URL` (a converter_test database with migrations applied) and `TEST_REDIS_URL`. It checks real PostgreSQL, Redis and BullMQ together with controlled local S3/SMTP fixtures. It never reads integration credentials from `.env`, flushes Redis globally or uses the product queue: keys/jobs use a generated test namespace. CI supplies PostgreSQL 18 and Redis 8. This suite is deliberately excluded from offline `test:all`.

## Docker deployment foundation

`infra/compose.yaml` is local infrastructure. `infra/compose.production.yaml` is a standalone production definition, not an overlay that inherits development port bindings.

API, worker, and proxy each have their own multi-stage Dockerfile. The worker image installs LibreOffice Writer/Calc/Impress and fonts; both API and worker images install Bubblewrap and `prlimit` for isolated image validation/processing. Each conversion uses a new mount/PID/network namespace with an empty service environment, read-only runtime/fonts, a read-only input, and a private 128 MiB `/work` tmpfs. The namespace root, `/dev` and `/proc` are read-only. Macros and document link updates are disabled; external network and other attempts' files are unavailable.

The subprocess has a 60-second wall deadline, 50 CPU seconds, 2 GiB virtual-address limit, 40,000,000-byte output/file limit and 128 file descriptors. The worker runs one conversion at a time and requires cgroup v2 limits of at most one CPU, 1 GiB RAM and 128 processes; startup fails without these limits or a working sandbox. Process limits use the worker cgroup rather than `RLIMIT_NPROC`, whose host-UID accounting would interfere with independent replicas. The outer 256 MiB staging tmpfs remains bounded. JPG orientation is applied and metadata stripped; PNG transparency becomes white for JPEG quality 90. Document rendering uses bundled Carlito/DejaVu fonts; arbitrary document fidelity is not guaranteed.

`infra/security/worker-seccomp.json` is derived from [Moby profiles commit 4b8214f](https://github.com/moby/profiles/blob/4b8214fc4971e06172938a1f1554ccff6647ee80/seccomp/default.json), under the adjacent `LICENSE.moby`. The reviewed worker-only additions allow `clone`, `unshare`, `mount`, `umount2` and `pivot_root` for nested namespaces. Compose retains `cap_drop: ALL`, `no-new-privileges`, read-only root and resource caps. Do not replace this with privileged mode or an unconfined profile. Host user-namespace/LSM compatibility must also pass the engine tests at deployment.

The dispatcher reconciles durable intents every two seconds and recovers expired 120-second processing leases. At most three durable attempts use exponential backoff; invalid engine inputs fail terminally. Version/token fencing and PostgreSQL publication transactions prevent duplicate results and settle guest quota atomically. Inputs and unpublished objects receive durable deletion intents; normal attempt directories are removed immediately. Periodic cleanup handles crash/orphan/expired-file deletion. `GET /api/v1/conversions/{id}/download` enforces account/API-key ownership or the original guest capability, expiry and deletion state without exposing storage keys.

After building, run `npm run test:processing --workspace=@converter/backend` with explicit loopback `TEST_DATABASE_URL` pointing to an isolated `converter_test_*` database and `TEST_REDIS_URL`. In the bounded worker image, `npm run test:engine:linux --workspace=@converter/backend` checks all directions, orientation/transparency, namespace isolation, disk bounds and the real deadline. Mount the test directory read-only when using the production image. `node test/processing-http.linux.mjs` additionally exercises separate real API/worker processes with controlled storage/SMTP fixtures; it requires built API/worker outputs and the owned `converter_test_item15` database. It never uses production credentials or storage. Optional `BROWSER_QA=1` holds this fixture for browser verification after acceptance assertions pass.

Copy `.env.production.example` to an untracked `.env.production` and provide real credentials. In production, `DATABASE_URL` must reach `postgres:5432`, and `REDIS_URL` must reach `redis:6379` with the configured password; encode password characters correctly in URLs.

```sh
npm run infra:production:config
docker compose --env-file .env.production -f infra/compose.production.yaml build
```

Only the proxy publishes a host port. This template requires HTTPS termination on the server's ingress/load balancer before port 8080; certificates are not provisioned here. Restrict direct HTTP access to that ingress. Set `APP_ORIGIN` to the public HTTPS origin, provide independent session/outbox keys and set `AUTH_TRUSTED_PROXIES` to the exact proxy and ingress IPs/CIDRs. The ingress must replace untrusted forwarded headers; Nginx appends its peer address and supplies the fixed HTTPS scheme expected by this deployment. Never trust all addresses. Secure-cookie issuance and client-IP limits depend on this chain; verify them at deployment. Access logs exclude query strings/referrers. Pin validated image digests at release time. Backups, migration release job, real-provider delivery/storage checks and converter sandbox verification remain prerequisites; dependency readiness alone does not prove them.

`npm run infra:down` stops local infrastructure and retains named volumes. No reset/delete-volume command is included.

## Local development instructions

Open this project directory itself in Codex so its [AGENTS.md](AGENTS.md) and repository skills can be discovered. The index explicitly routes to the applicable local rules; [progress.md](docs/progress.md) records meaningful changes. The live guest flow permits one successful free conversion, followed by login/registration for further conversions.

## Saved files and cleanup

`GET /api/v1/files` supports literal case-insensitive `search`, output `format` (`jpg`, `png`, `webp`, `avif`, `pdf`), `sort` (`newest`/`oldest`), `limit` (1-100, default 20), and an opaque date/id `cursor` bound to the filters. Detail, proxied download and idempotent DELETE routes accept an owning account session or API key; guests cannot use `/files`. Cookie deletion requires Origin and CSRF. Logical deletion commits before the response and blocks both download routes before asynchronous object removal.

Auto-save is snapshotted at acceptance. Saved account outputs have no automatic expiry; other results expire exactly one hour after completion. Guest ownership and consumed trial markers survive result cleanup and login. The worker runs bounded cleanup batches every 30 seconds, using renewable database leases, retryable deletion intents and a persisted S3 enumeration cursor. It removes expired outputs, terminal inputs and unpublished/orphan objects; generated keys are fenced against late acceptance/publication. Unknown objects receive a one-hour grace period. The storage identity additionally needs ListBucket permission restricted to the inputs/ and outputs/ prefixes. Each worker cleans stale attempt directories locally; API instances clean hour-old staging directories only when their recorded owner PID is absent.

Run `npm run test:files` against explicit isolated loopback `TEST_DATABASE_URL` (`converter_test` or `converter_test_<suffix>`) and `TEST_REDIS_URL`, with existing migrations deployed. The suite uses real PostgreSQL/Redis/BullMQ and controlled private-storage/SMTP protocol fixtures; production-provider validation remains a deployment check. LiveApp wires the My files HTTP gateway.

## Static image formats and rollout

| Input    | Output               |
| -------- | -------------------- |
| JPG/JPEG | PNG, WebP, AVIF      |
| PNG      | JPG, WebP, AVIF      |
| WebP     | JPG, PNG, AVIF       |
| AVIF     | JPG, PNG, WebP       |
| GIF, SVG | JPG, PNG, WebP, AVIF |

Animated GIF/WebP/AVIF are rejected before admission and again in the worker. SVG/GIF output and same-format re-encoding are excluded. HEVC/HEIC and AVIF sequences are excluded. Outputs auto-orient, convert to sRGB and strip metadata. JPEG flattens alpha to white at quality 90; WebP uses quality 80/effort 4; AVIF uses quality 50/effort 4/8-bit; PNG is lossless. PNG/WebP/AVIF preserve supported alpha. Inputs that cannot finish within existing resource budgets fail safely; the pixel limit is not a latency guarantee.

SVG accepts UTF-8 XML 1.0 with the SVG namespace, explicit numeric width/height, optional viewBox, and svg/g/rect/circle/ellipse/line/polyline/polygon/path/title/desc elements. Only allowlisted numeric geometry, path/points, basic literal colors and stroke/fill attributes are supported. Non-whitespace text, CSS/styles, transforms, references (including local/data URLs), fonts, nested SVG, scripts, animation, DTD/entities, processing instructions and foreign namespaces are rejected. Limits: 20,000,000 bytes, 40,000,000 pixels, depth 32, 10,000 elements, 24 attributes/element, 100,000 characters/attribute and 1,000,000 attribute characters total. Saxes parses XML before Sharp inside the sandbox.

New image admission requires Linux API and worker runtimes. The API image includes Bubblewrap/util-linux and reuses the worker seccomp policy and CPU/RAM/PID limits. At most one new-format validation runs per API process; concurrent validation returns capacity error 429 without reserving quota. The subprocess receives only staged input and read-only runtime files, an empty service environment, private networking, bounded tmpfs, 60-second outer deadline and unchanged prlimit/cgroup limits. Existing JPG/PNG admission remains compatible; all images are checked again in the worker.

Deploy compatible frontend/API consumers that understand expanded response enums before producing new values. Replace or retire old frontend sessions/API consumers before activation; this release adds no client-version negotiation. Apply migration 20261109000000_image_formats, commit it, then apply 20261109000001_image_constraints; never combine enum creation and use into one transaction. Upgrade worker and API with their sandbox prerequisites, verify readiness and real pairs, then expose selection. After new rows exist, disable new submissions and retain compatible readers/workers for rollback. Migrations preserve data; no enum-removing down migration is provided. Local acceptance databases are not production migration evidence.

Focused Linux checks: node --test test/image-formats.linux.mjs test/conversion-engine.linux.mjs in the bounded worker runtime with API and worker builds present. The image-formats-http.linux.mjs harness runs every image pair for synthetic account/API/guest principals against an explicit dedicated converter_test_imp06_* database and isolated Redis namespace with local storage/SMTP protocol fixtures. Container init/reaping is required, as in production Compose. No external conversion service is used.

## Document formats and rollout

DOCX, ODT, XLSX, PPTX, CSV and TXT target PDF only. Writer handles DOCX/ODT/TXT, Calc handles XLSX and the controlled CSV intermediate, and Impress handles PPTX. The worker installs Calc/Impress alongside Writer, Carlito and DejaVu; readiness checks all three component registries. The sandbox, one-active-job worker, credential/network/filesystem isolation, 20,000,000-byte upload, 80,000,000 expanded ZIP bytes, 1,000 ZIP entries, 40,000,000-byte output and existing CPU/RAM/PID/time/tmpfs budgets are unchanged. Oversized or expensive inputs fail honestly within those budgets. Exact Microsoft Office rendering is not promised.

- ODT has separate ODF MIME/manifest/text checks. XLSX/PPTX require the matching OOXML main part/type and internal package relationships. ZIP integrity, duplicate/path/symlink/encryption/expansion checks are shared with DOCX. New Office inputs accept XML/relationships and internal PNG/JPEG media only; embedded fonts, vector/media objects, macros, OLE/ActiveX, external links, data connections, DTD/entities, CDATA, XML base overrides and active XML are rejected. XML bounds: depth 128, 200,000 elements per part, 128 attributes per element and 1,000,000 characters per attribute. The worker repeats document validation before loading LibreOffice.
- XLSX exports visible sheets only, honoring print areas, page orientation and page breaks. Local formulas recalculate using the isolated profile's `OOXMLRecalcMode=0`; cached values are not authoritative. External/DDE/add-in data-source formulas are rejected. Unsupported local formulas may render Calc errors rather than Excel results. Hidden and very-hidden sheets are not printed.
- PPTX exports visible slides only, without notes or hidden slides. `ExportHiddenSlides`, `ExportNotes`, `ExportNotesPages` and `ExportOnlyNotesPages` are explicitly false. Fonts and pagination may differ from Office.
- CSV is UTF-8 with optional BOM, commas, double-quoted fields, doubled quotes and quoted newlines. Require at least two columns and rectangular rows; reject unquoted semicolons/tabs, ambiguous single-column input, invalid quotes/UTF-8/control bytes and other encodings. Semicolons/tabs inside quoted content are literal text. Bounds: 10,000 rows, 256 columns, 100,000 cells, 32,767 characters per cell. The parser generates private Flat ODF with **every cell explicitly typed as a string**, preserving leading zeros, date/number spelling and formula-like text without Calc's CSV type/formula heuristics or locale guesses. No public import-options field is added.
- TXT is UTF-8 with optional BOM; normalize CRLF/CR to LF, preserve tabs and let Writer wrap long lines with the explicit UTF-8 text filter and Carlito. Empty/whitespace-only, malformed encoding and disallowed control bytes fail before reservation. Text has no fictitious magic signature; CSV/TXT require their respective filename extension and bounded content validation. Archive/image content detection still precedes that hint.

Apply `20261109000002_document_formats`, commit, then `20261109000003_document_constraints`; preserve all historical migrations. Upgrade compatible frontend/API readers before producing new enum values, retire old consumers that cannot decode them, and deploy matching API/worker packages with required components before exposing new selection. No client-version negotiation or production deployment is performed here. Rollback must stop new submissions while retaining compatible readers/workers for existing and queued values; do not remove enums or rewrite data.

Focused verification: `node --test test/document-formats.linux.mjs` in the bounded Linux worker with API/worker builds and test-only Poppler; `document-formats-http.linux.mjs` exercises all six document inputs as guest/account/API key against an explicit disposable `converter_test_imp06_*` database and isolated Redis/storage/SMTP fixtures. Poppler is a verification tool and is not installed in the production image. The separate database test checks additive upgrades and all new pair/MIME constraints. See the development progress entry for actual outcomes and remaining acceptance limits.
