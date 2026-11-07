# Development Progress

Entries are ordered from newest to oldest. Each entry uses the same structure: changes, followed by verification and limitations. Implementation-plan references identify the covered scope; partial delivery is labeled explicitly.

Historical entries describe the implementation and verification available at the time, including limitations that later work may have resolved. See [the implementation plan](implementation-plan.md) for plan markers. Item 8 is complete following frontend integration and automated/live verification; Item 17 has not started.

## 2026-11-07 — IMP-01.01 invalid guest session feedback (partial acceptance)

### Changes

- Preserve `GUEST_CREDENTIAL_INVALID` as a distinct frontend error and explain invalid/expired guest access with sign-in and registration links instead of an ineffective retry prompt. Transient access failures retain retry behavior.
- Preserve backend credential validation, fixed cookie expiry, quota accounting and refusal to replace invalid credentials. No configuration, contracts, schema or existing tests changed; the improvement plan remains untouched.
- Add six separate gateway/component regressions covering error classification, recovery actions and prevention of uploads when access is denied.

### Verification and limitations

- Passed 27 converter frontend tests, two existing backend guest configuration/cookie tests, scoped ESLint and frontend TypeScript/production build. Build reports a bundle-size warning.
- Playwright against `http://127.0.0.1:5173`: malformed and syntactically valid unknown synthetic credentials return real `401 GUEST_CREDENTIAL_INVALID`; the revised UI offers authentication, sends no conversion POST, preserves the credential across reload and receives no replacement cookie. No page runtime errors were observed. Chrome DevTools was unavailable because its profile was already in use.
- A clean-context real JPG-to-PNG conversion completed; download returned 200 with 95 bytes and a valid PNG signature. Reload preserved the result, and the next attempt required sign-in before another upload.
- The owner's reported failure matches the rejected-credential boundary. The exact reason their retained credential became invalid (malformed/duplicate, missing database record or expiry) remains unverified; their browser credential was not accessed. Default lifetime is 30 days, stored against the database clock and not extended by bootstrap. A fresh context has no retained credential and follows initial issuance instead.
- Live database/worker guest, admission and processing regression suites were not run against the shared active worker database; no isolated live-test target was configured for this task. Expired-record behavior was inspected in existing live tests, not newly executed. Full IMP-01.01 acceptance remains pending these limitations and owner verification. No IMP-01.02 work was performed.
- Disposable diagnostic scripts remain under `.cache/tasks/imp-01-01/`; no additional worktrees were created.

## 2026-11-07 — Item 8 completion marker

### Changes

- At the user's request, marked Item 8 complete in the implementation plan after resolving its final E2E blocker. Implementation and verification are recorded in the preceding commits `fe49113` and `43e5e63` and the entries below.
- Item 17 remains unstarted. The next step is the user's manual application testing and a separate list of requested fixes or improvements.

### Verification and limitations

- Documentation-only status correction, based on the previously executed 134 frontend tests, 27 backend unit tests, 51 PostgreSQL/Redis integration checks, 42 ordinary browser tests and the separate successful real-engine live E2E. The ordinary suite's opt-in live skip does not replace its separately verified run.
- Checked formatting, the diff and preservation of Item 17. Application tests were not rerun because no implementation or test behavior changed.

## 2026-11-07 — Authorized Item 8 E2E expectation update

### Changes

- With explicit user approval, updated only the request allowlist in the existing keyboard file-selection E2E test. It permits session reads, CSRF reads and guest bootstrap; conversion submissions and other API requests still fail the test. Application behavior and other tests were unchanged.
- Resolved the remaining automated regression blocker from the preceding Item 8 audit. Implementation-plan markers and Item 17 remain unchanged; the user will manually test the application before requesting further work.

### Verification and limitations

- Passed scoped ESLint, Prettier and `npm run test:e2e -- --workers=2`: 42 passed, one intentionally skipped opt-in live test, zero failures. The formerly failing keyboard selection test passed.
- The skipped test requires `CONVERTER_LIVE_E2E=1` and separately provisioned local API/worker/storage/mail services. It already passed separately during the preceding task with real conversion engines; that live test was not rerun for this test-only change. Ordinary E2E fixtures remain distinct from live integration evidence.
- No new dependencies, branches, worktrees, containers, services or artifact directories. Existing Item 8 artifacts and synthetic services are retained as previously reported; no destructive cleanup or push.

## 2026-11-07 — Item 8 frontend integration audit and completion work

### Changes

- Audited all six backend/frontend integration areas against controllers, generated OpenAPI contracts, gateways, hooks and tests. Auth/CSRF and conversions were partial; guest and account/settings/API keys already had real transports; saved-file transport and production wiring were missing. No production conversion simulator was found: controlled gateways remain in development fixtures.
- Added the generated-contract-backed saved-files HTTP gateway and production wiring. Search, format, date sorting and opaque pagination map to the existing API. Downloads use the shared Axios Blob transport; deletion obtains fresh CSRF and synchronizes file and conversion caches. Search respects the server's 200-character limit.
- Corrected private-cache cleanup for transport-prefixed scopes on background identity changes and session-read failures; email confirmation now refreshes sessions after the committed mutation. Abort upload HTTP on converter unmount without inventing server-side job cancellation or replaying ambiguous acceptance. Lock selection during initial session hydration to prevent identity remounts discarding a newly selected file.
- Added separate focused HTTP/component regression tests and opt-in `tests/e2e/live-integration.spec.ts`. Existing tests, API/schema/dependencies, implementation-plan markers and Item 17 were not changed. Reused the established design, Axios transport, generated types and Query architecture.

### Verification and limitations

- Live browser acceptance passed with an actual API, Linux worker using Sharp/LibreOffice in its configured sandbox, PostgreSQL, Redis, MinIO and Mailpit: guest success/download and second-upload sign-in gate; registration/email verification/login; retained guest access after login; account JPG → PNG, PNG → JPG and DOCX → PDF; acceptance-time saving, My Files filters/search/sort, protected downloads and confirmed deletion. Download signatures and saved/download byte equality were checked. Desktop/mobile screenshots are outside the repository.
- Existing live suites passed: auth 10, guest 11, account 6, conversions 9, processing 6, files 9. These suites use protocol fixtures for storage/mail, and processing tests substitute the engine; their passing results alone are not real full-stack conversion evidence. An initial guest-suite run shared its database with the active worker and observed reconciliation interference; the isolated-database rerun passed all 11.
- Production build, contract drift check, full typecheck, lint/config checks, backend unit tests (27) and frontend Vitest (134 tests across 26 files, `--maxWorkers=2`) passed. Build retains the existing roughly 550 kB entry-chunk warning.
- Existing browser regression run: 41 passed, one opt-in live test skipped, one failed. `tests/e2e/file-selection.spec.ts:68` expects all requests to be session reads, but the real converter gateway already at baseline `878076c` bootstraps guest eligibility using CSRF and POST. The test's local file-selection assertions pass; its request allowlist is stale. AGENTS.md prohibits modifying existing tests during functionality changes, so that test was preserved. Item 8 remains open until this gate is resolved; Item 17 was not started.
- Chrome DevTools verified the clean-context page identity, content, no overlay/console errors and no overflow; its upload tool denied both artifact and repository fixture paths as outside configured roots. Browser plugin is unavailable; the existing Playwright Chromium completed live interactions and responsive screenshots. No new browser dependencies were installed. Context7 documentation was available; React best practices preserved existing query ownership and component boundaries.
- No extra branches/worktrees, integration, push, reset or rebase. Local synthetic services/data and unique QA scripts/screenshots remain in `Converter-artifacts/item8/`, `.cache/tasks/item8/` and the five `converter-item8-*` containers; these were not destructively removed. The API supervisor keeps generated credentials in memory and does not modify secret-bearing configuration. Synthetic users/messages remain within the dedicated test environment.

## 2026-11-07 — Task workspace and artifact cleanup

### Changes

- With explicit user approval, removed the unused `Converter-task16-cleanup` worktree using Git and deleted its fully merged `task16-cleanup` branch. The branch pointed to `516b538`, already contained in `main`; no merge, cherry-pick, forced deletion or application change was needed.
- Preserved all 12 loose `item15-*` diagnostic scripts, build/HTTP logs and screenshots together in the sibling `Converter-artifacts/item15/` directory. File contents were unchanged; the directory is a local QA archive outside the repository.
- Added scoped workspace-hygiene guidance to the local AGENTS.md: group disposable artifacts, prefer the existing checkout for read-only review, report retained worktrees/artifacts and inspect unique work before authorized Git cleanup. Global rules, implementation-plan status and application/runtime data were unchanged.

### Verification and limitations

- Confirmed the task worktree had no tracked changes, untracked/ignored files or commits absent from `main` before removal. Git now lists only the primary `Converter` worktree, and the disposable branch is absent. The implementation commits remain in `main`.
- Verified SHA-256 equality for all 12 moved files (508,646 bytes total) and confirmed no loose `item15-*` files remain in the workspace root. The archive preserves unique historical QA evidence; its scripts still contain their original environment/path assumptions and were not rerun or promoted into maintained tests.
- Passed explicit Prettier and whitespace checks, verified 17 relative documentation links and confirmed the same structure and reverse chronological order across all 28 progress entries.
- No application tests/builds or services were required for this filesystem/documentation maintenance. No remote push was performed as part of cleanup.

## 2026-11-05 — Saved files and retention cleanup (plan item 16)

### Changes

- Implementation commit: `deb7c20` (`feat(files): add saved file access and repeatable retention cleanup`). Completed plan item 16; frontend file transport/cache integration remains part of item 8.
- Implemented account/API-key saved-file list, details, proxied downloads and idempotent deletion. Lists use bounded date/id keyset pagination, literal case-insensitive name search, format filters and deterministic date ordering. Guest credentials cannot authorize these routes; cookie mutations retain Origin/CSRF protection.
- Logical deletion and its durable intent commit together, immediately denying both file and conversion download routes. Acceptance-time auto-save and the one-hour completion-time temporary window remain unchanged; cleanup never transfers guest ownership or resets trial records.
- Added worker-only repeatable cleanup with renewable database sweep leases, per-object claims, bounded batches, retry backoff and persisted prefix pagination. Producer intents and row locks fence late input acceptance/output publication against deletion. Expired outputs, terminal inputs and orphan objects are removed without deleting live saved outputs. Each worker cleans its local stale attempts independently of the global sweep leader; API staging cleanup checks absent owner PIDs and age.
- Added generated file contracts, a focused live suite and CI execution. Updated runtime documentation; item 16 is complete, while frontend My files transport/cache integration remains item 8. Existing user edits to instructions and the implementation plan are preserved separately from this task's completion marker.

### Verification and limitations

- Passed 27 backend unit tests, 9 saved-file/cleanup live tests, 6 processing live tests, 9 conversion REST live tests and 13 offline infrastructure/bootstrap integration tests. Live suites used newly created isolated local PostgreSQL 18 and Redis 8 containers with synthetic data and controlled S3/SMTP protocol fixtures. Existing test files were not modified.
- Covered literal wildcard search, tied-date cursors after deletion, owner/guest/key boundaries, cookie CSRF/Origin, both download routes, acceptance-time settings, exact one-hour retention, expiry denial before cleanup, consumed guest quota preservation, terminal-input cleanup, deletion retries, late-acceptance fencing, orphan replay, sweep exclusion and local scratch cleanup. A signed S3 XML protocol test validates enumeration filtering and continuation parameters.
- Passed TypeScript checks, backend API/worker builds, contract drift and focused formatting/diff checks. ESLint and lint-configuration tests were run separately from the sandbox-blocked subprocess attempt. The final approved lint run passed ESLint with zero warnings and all six lint-configuration tests.
- No rendered frontend surface changed, so browser automation was not needed. Production S3 permissions/provider behavior and Linux engine execution were not revalidated; engines were unchanged. The new local test containers are retained, with no production service or persisted schema changes. Both task-specific containers were stopped after verification, preserving their test data. The read-only reviewer created an unused task16-cleanup worktree/branch and made no commits or file changes; no subagent integration was required.

## 2026-11-05 — Independent conversion worker (plan item 15)

### Changes

- Implementation commit: `516b538` (`feat(worker): add isolated real conversion processing`). Completed plan item 15; remaining integration gates are tracked separately in item 8.
- Added worker-only BullMQ conversion consumption, durable dispatch reconciliation, bounded attempts/backoff, expired-lease recovery and transactional publication fenced by version/token and database time. Guest reservation settlement and acceptance-time retention reuse existing invariants.
- Added isolated Sharp JPG <-> PNG and LibreOffice DOCX -> PDF adapters. Linux namespaces exclude service secrets, networking and other attempts; read-only mounts, bounded tmpfs, process/address/CPU/file limits and a whole-tree deadline constrain untrusted parsing. Worker startup checks the sandbox and required per-worker cgroup budgets.
- Added the explicitly approved worker-only Moby-derived seccomp profile, retaining dropped capabilities, no-new-privileges and existing container limits.
- Connected the live typed frontend gateway and protected conversion downloads; generated result metadata includes persisted guest/account ownership. Polling, real upload bytes, quota gating and downloads use existing Query/UI orchestration.
- Periodic physical deletion, crash scratch cleanup and saved-file management remain item 16. Item 8 remains open for its remaining integration gates. Existing instruction/plan edits were preserved.

### Verification and limitations

- Passed 26 backend unit tests, 121 frontend tests, 6 processing integration tests, 9 conversion REST tests and 13 infrastructure/bootstrap integration tests. Processing tests use real isolated PostgreSQL/Redis/BullMQ and controlled S3/SMTP fixtures.
- Passed Linux real-engine checks for all three directions, EXIF orientation, white transparency flattening, malformed input, hidden environment/files/network, read-only namespace roots, aggregate tmpfs exhaustion and the actual 60-second whole-tree timeout.
- Passed separate real API/worker HTTP acceptance for all directions, saved-result metadata, downloaded signatures/sizes and unauthorized download rejection. Storage/SMTP were controlled protocol fixtures, not production-provider validation.
- Passed browser guest upload/conversion/download, subsequent-upload sign-in gate, account login/conversion/saved download at 1440x1000 and 390x844 without console errors or horizontal overflow. Chrome DevTools was blocked by an already-running profile; the existing Playwright installation provided verification. Screenshots and temporary browser scripts remain outside the repository.
- Passed lint/config checks, TypeScript checks, contract drift, builds and focused formatting checks. Vite reports a 548 kB shared chunk. After the user freed host disk space and relocated Docker data, the final worker image built and exported successfully. All three Linux engine/isolation/deadline tests and real all-direction HTTP acceptance passed again against that final image; the six processing integration tests also passed after service recovery. Item 15 is complete; item 8 and item 16 remain open.

## 2026-11-05 — Validated conversion admission and status polling (plan item 14)

### Changes

- Implemented shared account/API-key/guest conversion controllers, capabilities, bounded multipart staging, byte-detected JPG/PNG/DOCX validation, durable admission and ownership-protected status polling. OpenAPI and generated frontend types match implemented operations; no schema, migration, production dependency or secret configuration changes were needed.
- Uploads use a private process-owned staging directory, the existing 20,000,000-byte decimal limit, four in-flight uploads per API process and a 60-second deadline. Image metadata is limited to 40 million pixels; DOCX ZIP checks bound entries, expansion and compression ratio and reject unsafe paths, mismatched headers/checksums, encryption, macros, embedded programs and external relationships. Multer cleanup settles before releasing upload slots; a real partial-stream/abort test verifies cleanup and subsequent admission.
- Private input upload precedes one short database transaction for source metadata, queued conversion, settings snapshot, dispatch intent and guest reservation. A transaction-scoped advisory lock serializes active-job admission across replicas (five per owner, 1,000 globally). Explicit API keys take precedence without cookie fallback; cookie writes require exact Origin/CSRF. Status reads preserve retained guest capability access after login or stale account sessions, with no ownership transfer. Result availability is independent of completed status and reflects expiry/deletion without exposing storage keys.
- Best-effort BullMQ dispatch uses a stable conversion UUID. Dispatch failure after durable acceptance retains queued status and the pending intent. Ambiguous COMMIT acknowledgement never deletes a potentially committed source. Worker processing/dispatch reconciliation remains item 15; orphan/crash cleanup and protected downloads remain item 16. Frontend converter mapping remains item 8; no rendered frontend behavior changed, so browser/E2E validation was not run.

### Verification and limitations

- Added eleven focused validator cases and nine real PostgreSQL/Redis/BullMQ HTTP integration cases with controlled S3/SMTP protocol fixtures; wired the new suite into CI. Final conversion tests and existing guest/account/auth regressions passed (9/11/6/10 cases). Full npm run check passed formatting, zero-warning ESLint, six lint-configuration checks, workspace types, 26 backend unit tests, 116 frontend tests, 13 backend integrations, Prisma validation, generated-contract drift and all production builds. Vite retains its existing non-failing chunk-size warning.
- Context7 supplied NestJS/Sharp references; persistence and permission review used the project database-review skill. Two read-only review passes found and then verified the fix for the in-flight staging gap, with no remaining concrete blocker reported. Sandbox process restrictions required approved escalation for full checks and test-database migrations; only new isolated loopback test services were used and both containers were stopped afterward. Existing tests and user edits to AGENTS.md/other plan lines were preserved; only item 14 was marked complete.

## 2026-11-05 — Account settings and hashed API keys (plan item 13)

### Changes

- Implemented session-only settings reads/updates and API-key metadata/create/rotate/revoke operations, synchronized OpenAPI and generated types. Settings persist per account, default to false and never mutate existing files/conversions. No schema, migration, production dependency or secret-bearing configuration changes were needed.
- API keys have a random public prefix and 256-bit secret; only SHA-256 of the full credential is stored. Current-password confirmation happens before short transactions; user-row locks and session-snapshot rechecks serialize lifecycle mutations, with the existing partial unique index enforcing one active key. Rotation/revocation is immediate for subsequent database-backed checks, without a validity cache. Account/guest guards reject explicit keys; the exported integration-only guard rejects missing/invalid/revoked keys without cookie fallback and applies distributed IP/account limits.
- Added generated-type HTTP gateways and production composition for auth/session/profile/settings/keys. Auth/CSRF is the prerequisite for live account access; forms now match the existing 10–128-character password contract and consume/scrub fragment link tokens. Profile and files pages share the settings Query/mutation. Account caches are identity-scoped and cleared on identity changes; pages remount by account scope without interrupting login navigation. Passwords and one-time key secrets remain in request closures/local component state, outside Query/mutation caches and persistent browser storage. Ambiguous key responses block replay until explicit reconciliation. Added password-confirmed key revocation UI; file listing remains explicitly unavailable.
- Added six real PostgreSQL/Redis account integration cases and seven focused frontend HTTP/component tests; CI runs the account suite with dedicated test services. With explicit user approval, updated only four existing E2E files whose production assertions assumed disconnected authentication or zero session requests. Local file-selection checks still forbid uploads; login/logout checks exercise the real frontend transport against controlled HTTP replies. Existing conversion/file fixtures remain controlled simulations, not evidence of implemented conversion endpoints.

### Verification and limitations

- Verification: `npm run check` passed formatting, zero-warning lint, six lint-configuration checks, workspace types, backend/frontend tests, Prisma validation, contract drift and all builds. The final full Playwright run passed all 42 tests. Real account/auth/guest suites passed 6/10/11 cases using isolated loopback PostgreSQL 18/Redis 8 and controlled local S3/SMTP fixtures. Initially overlapping regression runs hit existing five-second startup timeouts; unchanged sequential reruns passed. A focus failure in the initial parallel E2E run passed both isolated and final full reruns, without changing that test or file-management code. Vite reports a non-failing main-chunk size warning; optimization is outside this task.
- Chrome DevTools verified live login → profile, auto-save → files → profile/reload, key creation → one-time hide → rotation → revocation against the real local API. Desktop 1366px and mobile 390px checks found meaningful content, no framework overlay, no horizontal overflow or relevant console errors; browser storage remained empty. Screenshots stay outside the repository. Browser plugin is unavailable; Chrome DevTools and the existing Playwright workflow were used. Context7 supplied Prisma, TanStack Query and Playwright references. Two read-only reviews found no remaining material defects.
- Updated existing README, architecture/schema references, technology inventory and this designated log. The user-edited AGENTS.md and implementation plan are preserved. Item 8 remains incomplete overall: guest/conversion/file frontend mappings and live conversion/file endpoints/consumers belong to later items. No push, production mutation or unrelated integration was performed.

## 2026-11-05 — Protected guest credentials and trial accounting (plan item 12)

### Changes

- Implemented the user-approved `POST /api/v1/guest-session` contract and generated OpenAPI types. Bootstrap returns trial state and an optional reserved conversion ID, never the opaque credential or internal guest ID. The separate host-only HttpOnly/Lax cookie uses Secure under HTTPS and fixed absolute expiry (30 days by default), with no renewal on reuse/login/logout. PostgreSQL stores only the token hash. Invalid/expired presented credentials are rejected without reminting quota.
- Reused existing CSRF/session middleware, exact Origin, Redis counters and database providers. Explicit API keys are rejected. Bootstrap is limited to 30/IP/minute; issuance to five/IP/15 minutes. Guest access is independent of stale/revoked account sessions; a new anonymous CSRF context does not replace the durable guest identity. Configuration is validated, with a three-hour minimum to leave admission headroom, and propagated through example environments and production Compose.
- Added database-only trial helpers with consistent GuestSession-before-Conversion locks and caller-owned short transactions. Acceptance reserves input/job/dispatch intent atomically; current unexpired processing attempts can publish/consume or terminal-fail/release, while transient retries retain reservations. Duplicate/late callbacks cannot change newer work. Explicit expired-lease reconciliation permits failure/requeue, never success. Database timestamps and immutable output expiry enforce the one-hour result window within credential lifetime; new admission requires two hours remaining. Future conversion workers must enforce the completion/recovery deadline.
- Added two focused unit tests and a separate real PostgreSQL/Redis Jest/Supertest suite (`npm run test:guest`), wired into CI's existing database job. Eleven live cases cover HTTP/HTTPS cookies, request shape, CSRF/Origin/key rejection, quota limits, concurrency/rollback, lease/version fencing, reconciliation, timing, retained completed-result ownership after login/logout and Redis failure. Tests use owned synthetic data, random Redis prefixes and local controlled S3/SMTP fixtures. No new dependencies, schema changes, migrations, existing-test edits or real environment changes were needed.

### Verification and limitations

- Verification passed: `npm run check` (formatting, zero-warning ESLint, six lint-config checks, workspace types, 109 frontend/15 backend unit/13 backend integration tests, Prisma validation, contract drift and all production builds), 11 final guest integration tests, 10 existing live auth tests and `npm run infra:config`. Final request-shape and result-access refinements also passed scoped ESLint, backend TypeScript and API compilation. Two read-only reviews found no remaining material issues after fixes. Temporary loopback PostgreSQL 18/Redis 8 Docker services were dedicated to this task.
- Updated README, architecture, schema reference, technology inventory and configuration examples. Marked only item 12 complete; its item 8 integration follow-up remains open. No conversion/upload/status/download endpoints, conversion consumer, frontend mapping or browser behavior were implemented or verified. These integrations remain items 8 and 14–16. User edits to AGENTS.md and other plan lines remain outside the commit; no push was performed.

## 2026-11-02 — Email authentication and account security (plan item 11)

### Changes

- Implemented the user-approved first-party auth/session/profile contract, with the requested 10–128-character new-password policy, explicit DTO validation, normalized email, Argon2id, neutral registration/recovery acknowledgements, verified-email login and one-time purpose-bound verification/reset/email-change tokens. OpenAPI and generated frontend types are synchronized; frontend gateways remain disconnected.
- Added Redis-backed cookie sessions, synchronizer CSRF and exact Origin checks, no-store auth/profile responses, explicit API-key rejection and atomic distributed rate limits. SID rotation/logout use revocation tombstones to prevent late saves recreating old sessions. The approved migration adds nonnegative `User.sessionVersion`; every authenticated request checks PostgreSQL, and password reset/change or confirmed email change atomically revokes prior sessions and pending tokens. Credential work happens outside short user-locked transactions, with credential/version rechecks before confirmed mutations.
- Reused the existing database/Redis/SMTP/BullMQ infrastructure without new dependencies. Registration/resend/profile transactions persist AES-256-GCM encrypted email intents; a worker-only notification dispatcher/consumer queues task IDs, claims leases, bounds retries, skips invalid tokens and clears completed ciphertext. SMTP delivery is at least once; duplicate messages retain the same single-use token. Worker readiness includes notification dispatch/consumer status. API replicas have no consumers; conversion and other task types remain outside scope.
- Updated README, architecture, schema reference, technology inventory, password requirement and example configuration. Added public origin, independent session/outbox keys and exact trusted-proxy configuration; real environment files were not changed. Email links put tokens in fragments, and proxy access logs exclude queries/referrers. Deployment requires HTTPS ingress and a verified forwarded-header trust chain.

### Verification and limitations

- Verification: `npm run check` passed formatting, zero-warning ESLint, six lint-configuration checks, workspace typechecks, 109 frontend/12 backend unit/13 backend integration tests, Prisma validation, contract drift and all production builds. Final email-validation/readiness refinements passed focused backend typecheck/lint, 13 backend unit tests, 10 real auth tests and API/worker builds. The separate PostgreSQL suite passed 13 migration/concurrency cases, and the real infrastructure suite passed. Auth tests cover BullMQ-to-SMTP delivery, CSRF/Origin, SID rotation/logout tombstones, confirmed profile/email/password changes, cross-session revocation, purpose/attempt/expiry checks, concurrent single-use consumption, idle/absolute expiry, Secure cookie flags, durable SMTP retry and Redis failure. CI now runs `test:auth` with its existing PostgreSQL/Redis services.
- Live verification used an owned loopback PostgreSQL 18 cluster and checksum-verified portable Redis 8 in ignored cache, plus controlled local SMTP/S3 fixtures and synthetic accounts. No external provider, Docker image/Compose execution, production TLS ingress or frontend/browser integration was verified: Docker/WSL are unavailable locally. Item 8 still needs generated-client/gateway mapping, UI password-minimum alignment and fragment-token handling. Items 12–16, existing tests and the user's AGENTS.md/plan edits were preserved; no push was performed.

## 2026-11-02 — Frontend HTTP foundation (plan item 8; partial)

### Changes

- Confirmed that generated OpenAPI exposes only two operational health endpoints; product DTOs and the CSRF handshake remain unfinalized. The user authorized the available foundation and a blocker report. Added `apps/web/src/shared/api` with same-origin Axios requests, validated paths/timeouts, AbortSignal, explicit mutation CSRF, measured upload progress, sanitized errors and validated Blob downloads with safe filenames. Added generated-type health clients and opt-in Query options/hook with caching and 10s/30s polling/backoff.
- Preserved existing conversion/auth/account/files orchestration, production bootstrap and UI. No product endpoints, DTOs, credential handling, dependencies, environment files, existing tests, plans or instruction files changed. README documents usage and boundaries. Complete product adapters require auth/session/CSRF contracts, guest eligibility and conversion-result schemas, profile/settings/key schemas, file query/pagination schemas, and the corresponding backend operations. Item 8 is not claimed fully complete.

### Verification and limitations

- Verification passed: 11 new focused tests and final `npm run check`, including formatting, zero-warning ESLint, six lint-config checks, workspace typechecks, 109 frontend/eight backend unit/eight backend integration tests (125 total), Prisma validation, contract drift and all production builds. Transport tests use controlled Axios adapters; Query integrations use a real QueryClient, including timed polling/backoff and cancellation. Two read-only reviews found no material remaining issue. No live product integration or browser/E2E run was performed: no product contract/backend routes or rendered UI changes were introduced. Existing AGENTS.md user edits remain outside the task commit.

## 2026-11-01 — Generate Prisma types before CI lint

### Changes

- Reproduced the exact eight unsafe-type errors in DatabaseService using tracked sources without generated Prisma Client or `.env`. The custom `prisma-client` output is Git-ignored; installation does not generate it. `check` previously ran typed ESLint before the typecheck step that generated the client, leaving the correct relative import unresolved.
- Prepended the existing `db:generate` command to root `lint`, covering both standalone lint and CI checks. Updated README. No service code, schema, imports, ESLint rules, dependencies, workflows or implementation-plan entries changed.

### Verification and limitations

- Verification: fixed lint and all workspace typechecks passed in the isolated source snapshot, reusing installed dependencies. Its full Jest run encountered Windows-junction test-discovery limitations; full `npm run check` instead passed in the normal worktree: formatting, lint and six lint-config cases, typechecks, 114 tests, Prisma validation, contract drift and all builds. No database was required. Hosted Linux CI was not rerun. Preserved the user's existing AGENTS.md changes outside the fix commit.

## 2026-11-01 — Runtime integrations (plan item 10)

### Changes

- Added explicit Nest infrastructure modules for Prisma/PostgreSQL, operational Redis, BullMQ producer connections, private S3-compatible object storage and pooled SMTP. Both existing entry points opt into the same infrastructure composition; the base module shells remain usable for offline tests. No authentication/session middleware, guest accounting, product controllers/transactions, notification outbox, queue consumers or frontend HTTP integration was added. Existing schema and migrations are unchanged.
- Each process owns a bounded pg pool and Prisma client, a shared operational Redis client and a separate BullMQ node-redis connection. BullMQ 6 accepts the existing native Redis client, avoiding a new optional ioredis dependency. Storage uses generated keys, signed SDK operations and streams without ACLs or public URLs. Email verifies SMTP without sending, requires production TLS and disables file/URL content loading. No packages, lockfile, real credentials or existing tests changed.
- Added secret-safe Zod configuration validation, explicit production credentials, network/statement deadlines, capped Redis reconnect backoff, coordinated startup rollback and bounded signal shutdown. API liveness/readiness expose only operational states; worker writes an atomic private heartbeat checked by a compiled standalone probe, without HTTP. Production Compose probes readiness/heartbeat and allows 30s shutdown grace. Development restarts allow the application's configured shutdown deadline before forced termination.
- Added seven focused offline cases: three configuration cases, two Nest lifecycle/readiness cases, one S3/SMTP round-trip using real SDKs against controlled local protocol fixtures, and one worker heartbeat case. Added separate `npm run test:infrastructure` with explicit loopback test services and a randomized Redis namespace; it exercises real PostgreSQL/Redis/BullMQ plus controlled local S3/SMTP. CI's database job now supplies Redis 8 and runs this suite after migrations and schema tests. It never falls back to `.env` credentials, flushes Redis globally or operates on product queues.
- Updated README setup/operations, environment examples, architecture/technology/schema notes and current-state rule/skill references. OpenAPI and generated declarations now describe the two health routes only. Prisma client generation is included in backend build/typecheck/test/development commands for clean checkouts and Docker builds. Marked item 10 complete. Preserved the user's pre-existing AGENTS.md Testing edits outside the task commit.

### Verification and limitations

- Verification passed: full `npm run check`, including formatting, zero-warning ESLint and six lint-configuration checks, workspace typechecks, 98 frontend tests, eight backend unit tests and eight backend integrations (114 offline cases), Prisma validation, generated-contract drift and all production builds. Real DatabaseService/Prisma queries and pool closure passed against the owned temporary PostgreSQL 18.6 cluster; that server was stopped afterward. Compiled worker probe passed missing/ready/stopping/stale marker checks; both compiled entry points failed bounded startup safely against unavailable local test services without echoing synthetic credentials. YAML syntax, updated skill metadata and relative documentation links passed local Node checks; the Python skill validator is unavailable in this environment.
- Local Docker/Redis are unavailable, so container execution and the combined real Redis/BullMQ live suite were not run here; hosted CI results are not claimed. S3/SMTP protocol fixtures do not verify production-provider behavior or bucket policy. Deployment still requires a private pre-provisioned bucket, scoped credentials, TLS SMTP/sender setup, an explicit migration release step and real-provider smoke checks. No frontend behavior changed, so browser/E2E checks were not repeated. Applied the Build Web Apps Postgres connection-management guidance and Context7 documentation for Nest lifecycle, Prisma pool ownership and Nodemailer transport configuration.

## 2026-11-01 — Persistence schema (plan item 9)

### Changes

- Added eight PostgreSQL/Prisma models: User, UserSettings, VerificationToken, ApiKey, GuestSession, File, Conversion and BackgroundTask. Native UUIDs, timestamp-with-time-zone columns, unique/FK constraints and workload-based indexes support the documented domain. An initial schema migration and a separate transactional SQL-invariants migration preserve checks, partial indexes and guards that Prisma 7 cannot fully express.
- Database guards enforce exactly one account/guest owner, source/result owner-purpose-format matching, immutable acceptance/retention identities, terminal publication integrity, one active API key, one active and one successful conversion per guest, consistent reservation/deletion/lease shapes, irreversible consumed-trial updates and durable-intent deduplication. Future services must still authorize callers, conditionally reserve/consume trials, snapshot settings, fence worker attempts, enforce expiry on reads and reconcile object storage/queues; schema fields and constraints alone do not implement these use cases. No NestJS provider or product API was introduced.
- Added 13 real PostgreSQL integration cases under `tests/database`, root `npm run test:database`, and a separate CI job with disposable PostgreSQL 18 and explicit Prisma migration deployment. Tests execute the committed migrations in a unique schema, check supported lifecycle directions and invalid writes, race independent API-key/guest-job inserts, and clean up only their own schema. The test target must be an explicit loopback converter_test database; it never loads environment files or falls back to DATABASE_URL. Existing offline suites remain unchanged and require no database.
- Added `docs/db-schema.md` with relationships, indexes, SQL-only invariants, migration/deployment commands, default auto-save=false, Prisma BigInt serialization and transaction responsibilities. Marked item 9 complete and synchronized README, architecture, technology inventory and current-state rule/skill notes. No dependencies, lockfile, global tools, production configuration, credentials or user data changed. Read-only subagent review found no remaining material schema issues and identified a direct guest-success uniqueness assertion, which was added.

### Verification and limitations

- Local database verification used PostgreSQL 18.6 binaries downloaded only into ignored `.cache` because Docker/PostgreSQL were unavailable. Both migrations applied through Prisma Migrate; reapplying reported no pending migration, Prisma diff detected no schema difference, client generation passed, and all 13 database cases passed. The temporary server is stopped after verification; cached binaries/data remain ignored. CI YAML and documentation/skill references are checked locally; hosted CI execution and application-level integration remain future work.
- `npm run check` passed: formatting, zero-warning ESLint and 6 lint-configuration checks, all workspace typechecks, 98 frontend tests, 5 backend unit tests and 4 backend integrations (107 offline cases), Prisma validation, contract drift checks and all production builds. The final database-test assertion also passed scoped ESLint. No rendered UI behavior changed, so browser E2E was not repeated.

## 2026-11-01 — Repository database-review skill

### Changes

- Added one canonical `.agents/skills/database-review/` with a concise `SKILL.md` and an on-demand `references/review-checklist.md`. The read-only workflow covers schema integrity, migrations, SQL/ORM queries, workload-based indexes, transactions/concurrency, ownership/security and evidence-based performance findings. Monetary correctness applies only when financial values are actually persisted; File Converter is not treated as a finance application.
- Added a concise `$database-review` trigger to AGENTS.md while preserving the user's existing Testing section. No generic database rule file was added: the repository configures PostgreSQL 18 and Prisma 7.10.1 tooling, but its Prisma schema has no models, migrations are absent and neither API nor worker registers a runtime database provider. Future reviews must rediscover engine/version and distinguish configured tooling from live integration.

### Verification and limitations

- Applied the new workflow to the available Prisma schema/configuration, manifests, deployment definitions, backend entry points/modules and bootstrap tests. No material issue was established within this intentionally deferred foundation. Domain constraints, migration safety on real records, ownership enforcement, query plans and runtime behavior remain unavailable; no database connection or migration command was executed and no secret environment values were read.
- Validation passed: YAML front matter, naming/description limits, absence of scaffold placeholders, all 22 relative references across the new skill/checklist and AGENTS.md, a single canonical skill, no duplicate or empty skill folders, Markdown formatting and staged whitespace. Python is unavailable, so the bundled Python validator could not run; equivalent structural checks used existing Node.js and js-yaml. Application tests/builds were unnecessary for instruction-only changes. No application, schema, dependency or production configuration files changed.

## 2026-10-28 — Guest-result behavior after authentication

### Changes

- Added two focused Playwright cases for the currently executable part of the future security/reliability list. An available guest result remains downloadable after sign-in but is not represented as saved account data; an expired guest result remains unavailable and is not revived or transferred by authentication.
- The tests use the combined converter/auth fixture, make no new conversion submission, verify the PNG download signature for the available result, and confirm zero downloads for the expired result. Production behavior, dependencies and package scripts are unchanged.

### Verification and limitations

- Verification passed: the focused 2-test Chromium suite, all 42 Chromium E2E tests, root/workspace typechecks, zero-warning ESLint and all 6 lint-configuration tests.
- True multi-tab guest accounting, cross-owner authorization, BullMQ duplicate/crash recovery and API-key conversion remain intentionally deferred until their backend boundaries exist; controlled UI fixtures cannot prove those guarantees.

## 2026-10-27 — Invalid-file recovery E2E

### Changes

- Added three focused Playwright cases for unsupported extensions, files above the 20 MB client limit and corrupted content rejected by the controlled server gateway. Each case checks the exact Ukrainian error copy and proves that the file picker remains usable; the corrupted-file case replaces the input and completes a new conversion successfully.
- Local extension and size failures make zero submissions. The new `rejected-once` fixture outcome models authoritative server content validation without consuming the guest attempt, then permits a distinct retry. Production validation, API contracts, dependencies and package scripts are unchanged.

### Verification and limitations

- Verification passed: the focused 3-test Chromium suite, all 40 Chromium E2E tests, root/workspace typechecks, zero-warning ESLint with all 6 lint-configuration tests, and the frontend production build.
- These are browser integration checks with synthetic owned inputs. Real byte/structure validation and converter-engine rejection remain part of the future live API/worker acceptance suite.

## 2026-10-26 — Critical conversion browser journeys

### Changes

- Added five Playwright cases across three critical converter journeys. The free guest happy path now runs for every MVP direction—JPG → PNG, PNG → JPG and DOCX → PDF—and verifies the selected target, result name, binary signature and browser download. The remaining cases verify that a guest is blocked after the first success, signs in and completes a second account conversion, and that a terminal failure leaves processing, shows actionable feedback, restores the guest attempt and succeeds after a manual retry. Assertions also cover request counts, runtime errors and the absence of a Vite overlay.
- Extended only the development test fixture. Converter and authentication routes now share an in-memory session without browser storage; authenticated access is read through the existing gateway boundary. Repeated submissions reset fixture state and receive distinct job IDs, while the new `failed-once` scenario fails the first job and completes the retry. The first guest result remains temporary after login; only the following account result is marked saved. Production code, API contracts, dependencies and package scripts are unchanged. Playwright 1.64.1 and `npm run test:e2e` were already configured.

### Verification and limitations

- Verification passed: root typecheck; zero-warning ESLint and all 6 lint-configuration tests; all 98 frontend Vitest tests; frontend production build; the focused 5-test Chromium suite; and all 37 Chromium E2E tests. The restricted Windows sandbox initially returned `spawn EPERM` for Vite/Vitest/Chromium subprocesses, so the same commands were rerun with approved process execution. Context7 supplied current Playwright guidance for file inputs, downloads, route control and web-first assertions.
- These are browser integration E2E tests with controlled gateway responses and owned synthetic files. A full live E2E through the API, BullMQ worker, Sharp/LibreOffice and object storage remains tracked by implementation-plan item 17 and is blocked until those product components exist.

## 2026-10-26 — Essential regression tests and unified test command

### Changes

- Added 17 focused cases in six new test files; existing test files and product implementations are unchanged. Unit tests cover duplicate request admission before rerender, safe feedback/retry, StrictMode lifecycle, ignored completion after unmount, sanitized download names, empty-result rejection and Blob URL cleanup even after a failed click. Component tests cover dialog naming, safe initial focus, Tab wrapping, opener restoration and pending cancellation. The dialog shim is local and restores original property descriptors.
- Frontend integration cases use real AuthProvider/AutoSaveSetting components, hooks and QueryClient instances with controlled gateway responses. They verify cancellation/removal of old private queries, late-response isolation, fail-closed session refresh, reconciliation of a committed setting after a lost response and cancellation of stale settings reads. Backend integrations compile the real API and worker modules and resolve validated configuration through Nest dependency injection. These are offline frontend integrations and backend bootstrap/configuration checks, not proof of real account APIs, PostgreSQL/Redis/storage or conversion engines.
- Added root `npm run test:all` to run workspace unit/component/frontend-integration suites followed by backend integrations. `npm run check` reuses this command, so existing CI executes it without another test pass. E2E remains separate. All required libraries were already installed and `npm ls` confirmed them; no dependencies, versions or lockfile changes were needed. Expanded the Testing inventory in TECH-STACK.md and documented commands/boundaries in README. Context7 provided current Vitest timer, Testing Library hook and Nest testing guidance. The user's pre-existing AGENTS.md change is preserved and excluded from the implementation commit.

### Verification and limitations

- `npm run check` passed, including the new `test:all` command: 98 frontend tests, 5 backend unit tests and 4 backend integration tests (107 total), plus formatting, zero-warning ESLint, 6 lint-config cases, all workspace typechecks, Prisma validation, generated-contract drift checks and all production builds. Changed-document formatting and staged whitespace checks passed. No UI/runtime behavior changed, so browser/E2E checks were not repeated; native modal/browser coverage remains in the existing Playwright suite.

## 2026-10-22 — Saved-file interfaces (plan item 6)

### Changes

- Added session-gated “My files” with debounced filename search, output-format filtering, date ordering, cursor pagination, metadata details, Blob downloads, empty/no-match states and confirmed deletion. Pages compose the existing shared auto-save setting; both locations use one account-scoped query/mutation and changing it leaves saved files intact. Production has no files gateway and explicitly reports unavailable private data. No backend, schema, HTTP contracts, dependencies or retention rules changed.
- `FilesGateway` defines frontend view models, not guessed HTTP DTOs. Filter changes reset the cursor; repeated cursors stop pagination and IDs are deduplicated. Abortable reads and owner-scoped keys isolate lists. Loaded rows remain visible after a next-page failure. Confirmed deletion cancels stale reads, removes the record from all cached lists for the scope, refreshes them and focuses the page heading. Failed deletion preserves the file/dialog; stale errors are cleared before another confirmation. Download denial removes the action and refreshes metadata without changing guest/conversion state. Account/files routes now load on demand; the main production JS chunk is about 478 kB.

### Verification and limitations

- Extended the development-only account fixture with five synthetic rows, actual tiny PNG/JPG/PDF assets and empty/read/next-page/download/delete failure scenarios. Browser checks validate downloaded signatures/names, metadata, search/filter/order, pagination, retry, denial, cancellation, focus restoration, shared settings and anonymous/production gates. PDF Git attributes preserve binary bytes and cross-reference offsets across platforms. Fixture assets/ports remain outside the production graph. Read-only subagent review found no remaining substantive blocker; no subagent edited or committed code.
- Image Gen files concept `exec-00a17dd4-9fd2-440b-b7dd-1f56bbd83040.png`, state board `exec-96cb8859-42c5-4880-baf5-ebb4bbce53e1.png` and final desktop/mobile/dialog screenshots were inspected with `view_image`. Kept the open row layout, flat semantic colors, Onest typography and outlined actions; intentional differences follow established header/footer, DESIGN spacing, shared auto-save control and per-row metadata for mobile reading. Synthetic sizes/dates reflect actual fixture bytes. No raster design assets ship. Chrome DevTools confirmed page identity, content, no overlay/console errors, 390px reflow and cancel/focus behavior. Browser plugin not available; existing Playwright supplies automated Chromium coverage at 320/390/768/1366/1505px. Browser testing found/fixed implicit select labels including option text; integration tests preload lazy page modules so cold transforms occur before assertion deadlines. Server-backed storage/ownership/expiry/deletion, Firefox and Safari remain unverified.
- `npm run check` passed: formatting, zero-warning ESLint, 6 lint-config tests, all workspace typechecks, 83 frontend/5 backend tests, 2 backend bootstrap integration tests, Prisma validation, contract drift and all builds. All 32 Chromium E2E tests passed against the final build plus development fixtures (4 account and 5 files cases). A final test-only fix queries the live navigation after header replacement and asserts both route headings; its focused recheck and all 83 frontend tests passed without the earlier jsdom navigation warning. Production asset inspection found no fixture class, secret marker, synthetic filename or fixture entry. Final desktop viewports matched native concept dimensions: account 1520×1034 and files 1521×1034; full-page captures include the longer content required by existing DESIGN spacing and the fixture banner/counters. Above-the-fold copy follows the approved workflow; helper/fixture text and established navigation are intentional differences. PDF size/object/xref offsets and Git index/working-file hash equality passed. README/plan/current-state notes are synchronized. Context7 supplied TanStack Query and React Hook Form guidance.

## 2026-10-22 — Account interfaces (plan item 5)

### Changes

- Added session-gated profile/name/email editing, current-password confirmation, password change, a My Files link, shared pessimistic auto-save settings and one-time API-key creation/copy/hiding/rotation. Frontend ports remain separate from future HTTP DTOs and server enforcement. Production account data is explicitly unavailable; no backend, schema, contract or dependencies changed. Item 6 follows in a separate commit.
- Shared settings use one query/mutation key and global pending count, cancel stale reads and reconcile network ambiguity. Sensitive operations use a shared closure-based request hook extracted from existing auth behavior; neither passwords nor full keys enter Query/Mutation caches/storage. API metadata is cached separately; lost rotation responses block replay until explicit metadata refresh. Profile/key success cancels stale reads before cache updates. Confirmed password changes preserve success through session-read failure and return to sign-in; email changes acknowledge verification without claiming activation.

### Verification and limitations

- Read-only review found/fixed copied feedback surviving rotation, stale metadata overwrites and misleading auto-save rollback copy. Browser tests found/fixed an implicit textarea label including the one-time value; explicit labeling now works. Checked confirmation, errors/retry, duplicate submit, guest gating, clipboard/manual fallback, cancel/Escape/focus restoration, one-time hiding and layouts from 320–1505px. Chrome DevTools inspected DOM and desktop/dialog screenshots; Browser plugin not available, so existing Playwright ran 4 passing account E2E cases. Frontend typecheck/build and zero-warning scoped ESLint passed; all 76 frontend tests passed, with focused account/auth rechecks after final fixes.
- Image Gen concepts `exec-df685c41-950c-455d-8b4e-7231e0503af7.png` and `exec-96cb8859-42c5-4880-baf5-ebb4bbce53e1.png` plus latest browser screenshots were inspected with `view_image`. Preserved open sections, flat semantic palette, Onest type, 48px controls, pill actions and native dialogs. Intentional differences follow existing header/footer, DESIGN spacing, optional-name helper and password confirmation inside the rotation dialog; fixture notice/counters stay outside product UI. No raster assets ship. Real identity confirmation, mail delivery, session/key revocation, persistence, Firefox and Safari remain unverified. README/plan/current-state notes are synchronized.

## 2026-10-22 — Email authentication interfaces (plan item 4)

### Changes

- Completed item 4's frontend scope: registration, explicit email verification/resend, sign-in/sign-out, recovery and password reset at the agreed five routes. Pages compose `features/auth`; React Hook Form and Zod own validation, while shared Field/Button and a feature-local password reveal control preserve DESIGN.md. Existing account/files previews remain unchanged. New-password limits of 8–128 characters are provisional UI validation; passwords are never transformed and sign-in does not enforce the new-password minimum.
- Added `AuthGateway` as frontend view models, with session reads in TanStack Query. Confirmed identity mutations cancel/remove other cached queries and read the session again; failed sign-out keeps authenticated controls. Passwords and link credentials are request closures/component state, never query/mutation data or browser storage. Read failures have explicit retries; submit uses a synchronous duplicate guard, no automatic replay, static errors and unmount-safe callbacks. Production has no auth transport and explicitly reports that credentials are not sent. Real endpoints/generated DTO mapping, cookie/CSRF handling, email delivery and server security remain items 8, 10 and 11; backend, schema, dependencies and contracts were not changed.
- Recovery/resend acknowledgements do not reveal account existence. Return targets allow only converter/account/files paths and a validated conversion ID. Verification/reset remove parsed token parameters from the URL, including encoded parameter names, retain the credential only in memory, and handle another email link on an already mounted route. Consumed reset credentials/fields are cleared before a separate session refresh; refresh failure cannot undo a confirmed password change. Reload requires reopening the email link. Existing guest quota/result ownership is not edited by auth UI.
- Added a labeled development-only auth HTML entry with controlled session/mail outcomes, hash routing for reloads, counters without credentials, and synthetic tokens. It does not send mail or authenticate real accounts. README documents scenarios and boundaries; architecture/current-state rules and plan status are synchronized. Production bundle inspection found no auth fixture class, IDs, tokens or entries.

### Verification and limitations

- Read-only subagent review identified encoded-token scrubbing and post-reset synchronization issues; both were fixed with regression coverage, and repeat review found no new substantive issues. Browser QA reproduced/fixed blur-time error reflow swallowing submit clicks (validate on submit, then edits), and a new token link on the same mounted page losing its action. Chromium exercised registration → verification → sign-in → sign-out, recovery → reset, invalid/missing links, neutral acknowledgements, duplicate submits, session/logout/network/rate-limit/credential errors, password reveal, URL cleanup and responsive reflow at 320/390/768/1366/1505px. Ordinary production forms made no product requests or browser-storage writes. Chrome DevTools inspected the DOM/network/console and rechecked the affected click flow; Browser plugin not available, so existing Playwright provides automated coverage.
- `npm run check` passed: formatting, zero-warning lint, 6 lint-config tests, all TypeScript checks, 67 frontend/5 backend tests, 2 backend bootstrap integration tests, Prisma validation, contract drift and all builds. All 23 Chromium E2E tests passed on the final production build plus development fixtures, including all 6 new authentication scenarios. Context7 provided React Hook Form, Zod and TanStack Query documentation. Final changed-document formatting and `git diff --check` passed.
- Image Gen references: `exec-73867213-0d23-4961-8d33-884eb0cc2a9d.png` (full sign-in page) and `exec-c0c019ec-301d-4124-91f0-1a566d6028aa.png` (registration, verification, recovery and reset states). Both concepts and final desktop/mobile screenshots were inspected with `view_image`. Compared copy/order, flat palette, Onest typography, open 460px form, outlined actions/eye icons and mobile/error reflow. Intentional differences preserve the established wordmark/header/footer, DESIGN.md pill actions and real 48/32px heading scale, semantic tokens, existing spacing and native accessible labels instead of generated font/placeholder/border variations. No raster assets ship in the product; screenshots remain outside the repository. Real server authentication/mail/revocation, Firefox and Safari remain unverified.

## 2026-10-22 — Download expiry browser regression

### Changes

- Added the development-only `download-expired` scenario: available result metadata is followed by an expiry denial when downloading. Production behavior, API contracts, and dependencies are unchanged. README documents the scenario URL.
- Added a Chromium regression verifying that the download action disappears, completion remains visible, no file is downloaded or upload repeated, and the next guest conversion still requires authentication. Existing component coverage already tested expiry denial; this adds browser coverage without reopening plan item 3.

### Verification and limitations

- Passed changed-file Prettier and zero-warning ESLint, web and root TypeScript checks, `git diff --check`, and all 17 Chromium E2E tests. Browser plugin not available; used the existing Playwright workflow. Real server expiry enforcement remains pending backend implementation.

## 2026-10-22 — Conversion frontend states (plan item 3)

### Changes

- Completed item 3's frontend scope: access preflight, measured/indeterminate upload, acceptance wait, queued/processing/completed/failed views, download feedback, expiry, and the next-conversion auth dialog. Production still has no conversion gateway and keeps submission explicitly unavailable. No product endpoints, domain schema, conversion engines, new dependencies, or guessed guest/auth HTTP DTOs were implemented. The finalized/generated API transport belongs to item 8; real guest accounting/ownership/conversion remain backend work. Other plan statuses are unchanged.
- Added a feature-local `ConversionGateway` port with frontend view models. TanStack Query owns access/jobs and invalidates eligibility after terminal results (and the files list for saved results); React owns selection, byte progress, dialogs, and transient feedback. Submission rechecks access before bytes, never retries automatically, rejects duplicate clicks/late progress callbacks, and leaves ambiguous acceptance blocked unless a known job can be recovered. Active jobs poll every 2 seconds, back off to 30 seconds on connectivity errors, stop after terminal states, and retain a validated non-secret ID in query state. A failed status request retains the previous job rather than marking it failed.
- Guest trial state is always read from the gateway, never consumed/reset/persisted in browser storage. Known reserved jobs resume; a consumed trial opens auth before another submission without removing the prior result. Selection survives pending/rejected/modal states in memory, while route navigation may require reselection. Server expiry or download denial hides the action without changing completion or renewing a trial. Accepted result retention remains separate from current settings/login; guest results are never presented as automatically saved.
- Downloads use independent result Blobs, sanitized names, released object URLs, duplicate-click guards, and checks before/after the request. Network download errors permit an explicit retry. The native dialog supports Tab/Shift+Tab wrapping, Escape, initial focus, and focus restoration. Browser QA found/fixed focus escaping to the document and a fixture basename losing its trailing slash on reload. Read-only subagent review found/fixed missing visible access retry after completion and a dead end for inaccessible job URLs; regression tests cover both. The subagent made no edits or commits.
- Added a visibly labeled, development-only HTML fixture using controlled responses on a separate Vite entry; ordinary production routes have no mock toggle. Its one known synthetic PNG is independent from input bytes, and its displayed size matches the Blob. The fixture exercises UI transitions for JPG → PNG without performing real conversion or proving durable server policy. Build inspection confirmed its entry, gateway class, and fixture IDs are absent from production assets. README, architecture current-state notes, and project rules describe this boundary. ESLint/TSConfig now include the fixture source; existing layer restrictions stay enabled.

### Verification and limitations

- Validation passed: `npm run check` (formatting, zero-warning lint and 6 lint-config tests, all workspace typechecks, 43 frontend/5 backend tests, 2 backend bootstrap integration tests, Prisma validation, contract drift, all builds) and all 16 Chromium E2E tests. Tests cover measured 48%/100% before acceptance, unknown totals, no duplicate/replayed upload, server reservation/quota races, stale progress, terminal failure, reconnect/reload by ID, saved policy, mounted expiry, download denial/retry, actual PNG Blob bytes, and dialog keyboard behavior. Context7 supplied TanStack Query/React Router references. Chrome DevTools reproduced and rechecked focus/reload, inspected DOM/network/console; Browser plugin was absent, so existing Playwright provided E2E and screenshots. Final checks at 320/390/768/1024/1366/1505px found no page overflow, framework overlays, runtime errors, or product API calls.
- Visual specification: built-in Image Gen preview briefs covered the completed homepage (`exec-4d493f5b-cbb2-4ac8-86c4-74dee9d0d712.png`) and upload/processing/reconnect/dialog states (`exec-6d28c203-cd6c-46b3-906c-8f89dc772172.png`). No raster assets are referenced by the product. Both concepts and the latest rendered screenshots were inspected with `view_image`, including native 1505×1045 and mobile 390×844. Compared (1) above-fold copy/nav/order, (2) flat palette, (3) Onest/mono type and hierarchy, (4) two-column workspace/spacing, (5) outlined actions/icons/progress, and (6) mobile/dialog reflow. Intentional differences retain existing DESIGN tokens/header/instruction copy, left-aligned 32px headings and small 24px icons, outlined dialog actions instead of Image Gen's filled variants, real fixture byte counts/timestamps, native focus/expiry guidance, and a fixture-only diagnostic notice. No unresolved clipping/overflow in reviewed states; temporary screenshots remain outside the repository.
- Live API/auth integration, durable guest reservation/consumption, real worker output, and server-enforced ownership/expiry are unverified and pending implementation. Firefox/Safari remain unverified.

## 2026-10-21 — Lint research and safeguards

### Changes

- Reviewed architecture/stack documents, installed tooling, CI, and existing lint coverage. Context7 successfully returned typescript-eslint, ESLint, and JSX accessibility documentation; official sources and npm registry metadata were checked. Findings and source links are recorded in the README's Lint safeguards section.
- Enabled scoped `recommendedTypeChecked` with `projectService`, preserving JavaScript tooling and generated-file exclusions. Added frontend type-import consistency, strict equality with nullable-check support, `no-var`, and errors for stale suppressions. Prettier remains responsible for formatting; existing Hooks/Fast Refresh rules remain active.
- Static import/re-export restrictions now enforce web/backend/contracts separation and downward frontend layers, reject Node/server imports in portable code, and reject Node globals in browser source. Import-string checks do not resolve dynamic imports/aliases or detect cycles/provider composition; those remain review concerns. No architecture, public API, schema, production dependency, or plan-status changes.
- Fixed findings rather than disabling rules: added browser DOM libraries to the root E2E TSConfig, explicitly typed the Nest test HTTP application/server, removed three redundant non-null assertions, and wrapped the clipboard click in a synchronous handler; the existing async function still catches failures and updates feedback. Backend decorator imports/metadata are unchanged.
- Added six ESLint configuration regression tests covering invalid promises/unsafe JSON, rejected and allowed layer imports, frontend type imports/globals, valid Nest DI, browser callbacks/CommonJS tooling, generated-file exclusions, and stale suppressions. `npm run lint` runs them automatically, including in the existing CI pipeline.
- No packages installed. Current stable `eslint-plugin-jsx-a11y` 6.10.2 declares ESLint peers only through v9, so it was deferred for this ESLint 10 project without overrides/downgrades. Revisit compatible accessibility linting later; query-specific linting belongs with real API hooks. Other speculative graph/style/test plugins were not added.

### Verification and limitations

- Passed `npm run check`: formatting, zero-warning lint, six lint-config tests, all workspace typechecks, 5 backend/20 frontend tests, 2 backend bootstrap integration tests, Prisma validation, contract drift check, and all production builds. All 9 Chromium E2E tests passed, including clipboard success/denial, deep-link reload, selection, and responsive navigation. Documentation links and manifest/lockfile dependency inventories match. Typed linting adds a TypeScript analysis pass; it is not a substitute for server validation or browser accessibility review.

## 2026-10-20 — API documentation (plan item 7)

### Changes

- Completed item 7 only: `/api-docs` now has six article sections, contents navigation, all seven agreed public operations, cURL/JSON examples, API-key rules, async states/polling, ownership/retention, limits, and 12 HTTP error statuses. Other unfinished plan items remain open.
- The page explicitly describes a planned API. Examples use a reserved example domain and placeholder key; no endpoints are called or credentials collected. OpenAPI remains empty and unchanged. File-list schemas/pagination and numerical quotas are identified as pending rather than invented. Content is centralized in the page's `api-reference.ts` until the real backend contract exists.
- Added reusable accessible `CodeBlock` with exact-text copying, success/pending/error feedback, manual-copy fallback, and internally scrollable keyboard-focusable code. Tables and endpoint paths reflow on mobile. Existing navigation now renders the actual docs page instead of its preview.

### Verification and limitations

- Verification passed: frontend TypeScript/build, scoped ESLint/Prettier, 20 Vitest tests, and all 9 production Playwright tests. Copy tests verify actual clipboard content, normalizing only Windows CRLF in the browser assertion. E2E found intermittent fragment restoration after reload; the page now restores its known target after fonts/layout readiness with cancellation on unmount. The regression passed five additional repeated runs.
- Chrome DevTools verified the live title, DOM, six sections/seven operations, and clean console. Browser plugin was absent; existing Playwright Chromium verified clipboard success/denial, deep-link reload, code scrolling, and widths 320–1505px. No product API requests, overlays, console errors, or document-level horizontal overflow were observed. Context7 rejected its key; official React and MDN references were used. No dependencies, backend, schema, or API-contract changes.
- Built-in Image Gen briefs covered the docs introduction/quick-start and lower limits/errors reference. Concepts `exec-e318649c-34f8-4352-aba7-531cc712d4ed.png` and `exec-e6b00c68-ff2b-4ad7-9e1f-a5c1a532aaf5.png` were compared with final desktop/mobile screenshots using `view_image`, including native 1505×1045. Reviewed copy/order, palette, typography, contents/article layout, code/copy controls, and tables. Intentional differences retain the established header, 1280px bound, DESIGN.md type scale/pills, plain code, complete source-required content, and responsive native elements rather than mockup variations. No unresolved visual clipping or overflow in checked states; screenshots stay outside the repository.
- Live API integration and generated-contract synchronization await backend implementation; Firefox/Safari remain unverified. README and the project/architecture current-state notes were synchronized.

## 2026-10-20 — Local file selection (plan item 2)

### Changes

- Completed item 2: a converter feature with native keyboard-accessible picker, drag-and-drop/highlight, source metadata, remove/replace actions, and source-specific JPG/JPEG → PNG, PNG → JPG, DOCX → PDF choices. The page composes the feature; selection policy stays in its local helper.
- Validation rejects empty, unsupported, multiple, directory, and oversized selections; invalid replacements preserve the previous file/target. Input reset permits reselecting the same file, cancellation preserves the selection, removal restores picker focus, and outside file drops cannot navigate away. Status/error messages are accessible and long names wrap on mobile.
- Local UX limit: exactly 20,000,000 bytes is accepted, one byte more is rejected. The future backend/capabilities contract remains authoritative. No contents are decoded/validated, uploaded, logged, or persisted. Conversion is disabled with an availability explanation; progress, results, downloads, guest accounting, and server security validation remain later work. No dependencies/backend/API/schema changes.

### Verification and limitations

- Passed scoped ESLint, frontend TypeScript/build, all 16 Vitest tests, and all 6 production Playwright tests. Browser cases include a real keyboard-triggered file chooser, actual DataTransfer objects, boundary/invalid inputs, retained selections, re-selection, and zero API requests. Runtime checks found no console errors/overlays or horizontal overflow at 320/390/768/1024/1366/1505 px; the primary action ends at approximately 660px in the required 1366×768 viewport.
- Tools: Context7 rejected its key; official React input/MDN drag-and-drop docs informed implementation. Chrome DevTools verified the real DOM, PNG → JPG selection, disabled conversion, and clean console. Browser plugin was unavailable; existing Playwright Chromium provided responsive/screenshot verification without installing tools. Screenshots remain outside the repository and use synthetic files only.
- Built-in Image Gen brief: preserve the existing DESIGN.md shell, replace the static format panel with a dashed picker/target workspace, move format labels to the intro, and explicitly show unavailable conversion. Concept `exec-2d9d6c11-0a6a-4359-87d5-3437ce033755.png` and latest empty/selected/mobile/error screenshots were inspected via `view_image` at native desktop dimensions and mobile. Compared copy/order, palette/flat surfaces, Onest/mono typography, panel/dropzone geometry, button/icon styling, and mobile reflow. Intentional differences follow DESIGN.md's tokens, native select rendering, and real font/spacing metrics; there is no invented progress or active service action. No unresolved clipping, overflow, or runtime errors in checked states; Firefox/Safari and live conversion remain unverified.

## 2026-10-20 — Frontend layout and routing (plan item 1)

### Changes

- Completed item 1 only: responsive dark shell, header/footer/mobile navigation, nine specified routes and a 404 recovery view, semantic tokens, local fonts, and shared Button/ActionLink/Field/Surface components. The homepage presents the intended formats and instructions; future workflows are explicitly unavailable rather than simulated.
- Added skip-to-content, visible keyboard focus, route titles/content focus, Escape handling, labeled fields/error descriptions, reduced-motion styles, and mobile reflow. Updated README, the architecture's current-state note, and the project rule; product requirements, backend, and dependencies are unchanged.
- Downloaded Onest 400/500/600/700 and IBM Plex Mono 400 Latin/Cyrillic WOFF2 assets plus SIL OFL licenses from Fontsource's font-files repository. No font CDN is called at runtime.

### Verification and limitations

- Verification passed: frontend TypeScript/build, scoped ESLint, 5 Vitest tests, and all 3 production Playwright E2E tests. E2E caught `/api` proxy matching `/api-docs` on reload; changing the prefix to `/api/` resolved it. Checks cover direct routes, skip link, focus recovery, mobile menu, and overflow at 320/390/768/1024/1366 px.
- Browser path: Browser plugin absent; Chrome DevTools initially confirmed the desktop DOM/console/fonts, then stopped responding after mobile emulation. Existing Playwright Chromium completed verification and captured desktop/mobile screenshots outside the repository. No relevant runtime errors were observed. Context7 rejected its key; official React Router/Vite docs were used. Vite/Vitest/browser subprocesses required execution outside the restricted sandbox after EPERM.
- Visual comparison used the built-in Image Gen concept `exec-9e672c64-9b9a-409a-910f-499ab3c9a79c.png` and rendered screenshots via `view_image` at the concept's native 1505×1045 plus 390×844 and 320×768. The brief followed DESIGN.md: quiet dark shell, exact Ukrainian headings/navigation, one format panel, open numbered steps, no live upload/auth controls.
- Fidelity review: preserved copy/order; verified canvas/surface/cream/lime tokens; confirmed real Onest/IBM Plex Mono loading; checked the two-column panel and mobile stacking; checked outlined actions/Lucide arrows and separators. Kept DESIGN.md's 1280px content bound, real font metrics/natural wrapping, flat backgrounds, and an accessible active-link underline where the generated concept differed. No unresolved clipping, overflow, overlay, or console errors remain in checked views. Firefox/Safari, live authentication, conversion, and API integration remain untested/unimplemented.

## 2026-10-20 — Implementation plan

### Changes

- Added `docs/implementation-plan.md`: a short ordered list based on the technical task, with frontend work first, then database/backend work and final verification/deployment.
- Preserved the guest trial and MVP scope; no application code or requirements changed.

### Verification and limitations

- Verification: checked Markdown formatting and task order/coverage against the technical task; no application tests were needed.

## 2026-10-19 — Reduce instruction loading

### Changes

- Shortened `AGENTS.md` and all eight `.codex/rules/` topics. The index contains the universal safety baseline; detailed rules are read only for affected concerns. Formatting/typo fixes need only the index unless requirements or security are affected.
- Removed unconditional project/security reads, broad topic bundles, and recursive reading language. Document links are references; read relevant sections and reuse unchanged instructions already in context.
- Updated both project skills to read three audit-specific topics, adding backend/API/conversion guidance only when needed. Audit procedures, report requirements, and safety constraints remain intact.
- Local rule text: startup 821 → 260 words (68% reduction); index plus all eight topics 2,210 → 1,508 words (32% reduction). Counts use whitespace-delimited text including Markdown; these are not measured session tokens or latency.

### Verification and limitations

- Verification: explicit Prettier checks, Markdown parsing for 12 instruction/log files, 30 relative links, both YAML skill manifests, and removal of obsolete routing language passed. Routing review: typo → index; styling → UI/design sections; conversion/access changes → applicable conversion/backend/security topics.
- SHA-256 comparison confirms 82 source, dependency, infrastructure, and source-document files unchanged. No application tests/builds, live audits, dependency installs, or global configuration changes were needed. Future feature work remains separate.

## 2026-10-17 — Local instructions, skills, and requirement reconciliation

### Changes

- Added the root rule index and eight selectively loaded topics in `.codex/rules/`.
- Added instruction-only `api-audit` and `conversion-test` under `.agents/skills/`; no audit execution, fabricated findings, or helper scripts.
- Restored the agreed guest trial in `docs/technical-task.md`: one successful free conversion, login for subsequent conversions, durable reservation/ownership, and temporary result access.
- Moved `docs/DESIGN.md` to the root, repaired document links/tree, removed the obsolete discrepancy note from README, and ignored future generated audit reports.
- Application code, domain schema, dependencies/lockfile, infrastructure, and global Codex configuration are outside this change and remain unchanged.

### Verification and limitations

- Passed Markdown parsing for all 17 project documentation/instruction files and resolution of 56 relative links, including linked heading anchors. New instructions, skills, README, TECH-STACK, and this log pass explicit Prettier formatting checks; existing source-document formatting is preserved.
- Passed two skill manifests using existing Node.js and `js-yaml`: required YAML fields, allowed keys, names/descriptions, workflow sections, placeholders, references, and no duplicate skill directory. Python is unavailable, so the Python skill-creator validator was not run.
- Checked all eight rules, referenced npm scripts, absence of inherited Finance Panel instructions, and consistency of the restored guest trial across the technical task, architecture, design, and local instructions.
- Verified ignore behavior for environment secrets and future audit reports, while example configurations, rules, and skills remain trackable. SHA-256 comparison confirms all 85 protected application, dependency, test, and infrastructure files are unchanged; no new files were added within those protected areas.
- Application tests/builds and live API/conversion audits were not run for this documentation/instructions change. Runtime skill verification remains blocked by the missing product implementations.

#### Tool assessment

| Capability                      | Observed state                                                                  | Use / limitation                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Shell, filesystem, Node.js, npm | Available; used                                                                 | Local editing and validation with installed tooling                                                                  |
| Codex CLI/configuration         | CLI 0.160.1; user config inspected by section/key names only; no project config | Launch from this project directory to discover its instructions/skills; global configuration unchanged               |
| Context7 MCP                    | Exposed; resolve call rejected configured API key                               | Use official primary docs until credentials are repaired outside this task                                           |
| Chrome DevTools MCP             | Browser/console/network tools exposed; not exercised here                       | Runtime UI inspection when application work needs it                                                                 |
| GitHub MCP                      | Repository/review tools exposed; account/repository access not tested           | Future PR/source workflows; no external writes in this task                                                          |
| Web documentation               | Used successfully                                                               | Official OpenAI documentation for instruction/skill discovery                                                        |
| Security checks                 | Existing npm audit tooling; no live product audit performed                     | Focused source review and scoped audits when requested                                                               |
| Docker / Python                 | No Docker command; Python command is a Store alias without a working runtime    | Container execution and the Python skill validator were not run; use existing Node tooling for local manifest checks |

#### Next steps

- Begin product implementation only with the next authorized task; current shells are not a working converter or authentication system.
- Fix Context7 credentials and provide Docker separately when needed; neither is required for reading these rules/skills.
- No new plugins, tools, user credentials, or model/permission configuration were installed or changed. Existing development dependency audit notes remain in README.
