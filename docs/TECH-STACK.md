# Technology Stack

This is the primary technology inventory for the project. Product requirements remain in [technical-task.md](technical-task.md), implementation boundaries in [architecture.md](architecture.md), and visual rules in [DESIGN.md](../DESIGN.md). Exact installed versions are recorded in workspace manifests and the root `package-lock.json`.

## Frontend

- React + TypeScript + Vite — основний frontend.
- React Router — маршрутизація між сторінками.
- SCSS Modules — стилізація компонентів; Sass is the build-time compiler.
- TanStack Query — серверний стан, кешування запитів.
- React Hook Form + Zod — форми та валідація; `@hookform/resolvers` connects them.
- Axios — HTTP-запити та прогрес завантаження файлів.
- Lucide React — іконки.

## Backend

- Node.js + TypeScript.
- NestJS — REST API та модульна структура backend; separate API and worker entry points.
- Cookie-based sessions — авторизація користувачів у вебзастосунку.
- Argon2id — хешування паролів.
- OpenAPI / Swagger — документування API.
- Nest Config, class-validator, and class-transformer — runtime configuration and DTO validation.
- express-session + connect-redis + redis — Redis-backed sessions with finite idle/absolute TTLs, SID rotation and revocation tombstones; PostgreSQL session versions revoke credentials across API replicas.
- Helmet — security headers. Distributed auth limits use atomic Redis Lua counters; Nest Throttler remains installed but is not used for in-memory enforcement.
- Node.js crypto — random CSRF/link/opaque guest tokens, SHA-256 token hashes, HMAC-protected rate-limit identities and authenticated AES-256-GCM email-outbox encryption; no additional cryptography package. Guest credentials and durable trial accounting use PostgreSQL with short Prisma row-locked transactions, independently of Redis account sessions.
- Nodemailer — pooled SMTP adapter with TLS, connectivity verification and bounded network operations; verification/recovery and pending email-change notifications use committed durable intents. No production provider is selected.

## Database

- PostgreSQL — основна база даних.
- Prisma ORM — доступ до бази даних.
- Prisma PostgreSQL adapter + pg — runtime database driver for Prisma 7, with a bounded per-process pool and explicit shutdown ownership.

## File Conversion

- Sharp — JPG ↔ PNG.
- LibreOffice у headless-режимі — DOCX → PDF.
- Окремий conversion worker для виконання задач.
- Конвертація документів в ізольованому середовищі з обмеженням CPU, RAM, часу виконання, файлової системи та мережевого доступу.
- LibreOffice and fonts are system packages in the worker image, not npm dependencies. The sandbox boundary must be implemented before processing untrusted files.

## Storage

- PostgreSQL — метадані файлів та їхні власники.
- S3-compatible Object Storage — зберігання файлів.
- MinIO — локальна розробка.
- The local MinIO image builds fixed official source commits because Community distribution is now source-only; see the [upstream repository](https://github.com/minio/minio). This does not change the selected S3 storage interface.
- Amazon S3 або Cloudflare R2 — можливі production-сховища; provider selection remains open.
- AWS SDK S3 client — private S3-compatible transport behind StoragePort, generated keys, streamed object operations and bucket availability checks.

## Infrastructure

- Redis + BullMQ — explicit Nest infrastructure modules and a separate worker-only notification queue/consumer with task-ID payloads and PostgreSQL outbox retries. BullMQ 6 uses dedicated node-redis connections; session/rate-limit keys use separate prefixes and a separate shared client. Conversion consumers remain future work.
- Docker Compose — локальна інфраструктура and a separate production deployment definition.
- Nginx — production static frontend and API reverse proxy.
- Mailpit — local SMTP sink for email development.
- GitHub Actions — автоматичні перевірки.

## Testing

- Vitest (`vitest`) — frontend unit tests for validation, request lifecycle and download utilities, plus component and Query/session integration tests.
- React Testing Library (`@testing-library/react`, `@testing-library/dom`) — component rendering, hook harnesses and behavior-based DOM queries. `@testing-library/user-event` models user interactions; `@testing-library/jest-dom` provides accessible DOM assertions.
- jsdom — isolated frontend test DOM. Native dialog top-layer behavior is not implemented; component tests supply a local, restored shim, while existing Playwright tests verify browser behavior.
- Jest + ts-jest — backend unit and integration runners; native ESM and decorator metadata match the NestJS build.
- Nest Testing (`@nestjs/testing`) — integration tests compile real API/worker modules, including infrastructure startup/rollback/shutdown and worker heartbeat. Supertest (`supertest`) exercises HTTP and sanitized dependency readiness responses.
- Node.js HTTP/net fixtures — controlled local S3/SMTP protocol servers exercise real AWS SDK and Nodemailer transports without external providers or additional packages.
- Node.js test runner + the existing `pg` driver — PostgreSQL 18 migration/constraint integration tests in isolated schemas, including concurrent guest/job and API-key inserts. CI provides a disposable PostgreSQL service; no extra test dependency is required.
- Playwright — separate Chromium E2E suite for real browser interactions, responsive layout and controlled frontend workflows.

Test libraries and supporting types are existing `devDependencies`; database tests reuse the backend's existing `pg` dependency and the built-in Node.js runner. No additional package is needed. Frontend integration tests use a real QueryClient with controlled gateway responses. Offline backend integrations use controlled dependency/protocol fixtures; the separate database suite verifies actual migrations and constraints. A dedicated live infrastructure suite checks real Prisma/PostgreSQL, Redis and BullMQ with local S3/SMTP fixtures. Real production-provider delivery/storage and conversion-engine verification remain separate deployment/product checks.

Run `npm run test:all` at the repository root for frontend unit/component/integration tests, backend unit tests and backend integration tests. `npm test` runs workspace suites; `npm run test:integration` runs backend integrations only. `npm run test:e2e` remains separate and requires the existing browser/build preparation. CI's `npm run check` includes `test:all`.

Run `npm run test:database` with the explicit dedicated loopback `TEST_DATABASE_URL` described in [db-schema.md](db-schema.md). Database availability is required only by this separate suite; CI runs it against PostgreSQL 18.

Run `npm run test:infrastructure` with explicit loopback `TEST_DATABASE_URL` and `TEST_REDIS_URL`; apply migrations to the dedicated test database first. CI supplies PostgreSQL 18 and Redis 8. See [runtime integrations](../README.md#runtime-integrations) for isolation, readiness and local setup.

Run `npm run test:auth` with the same explicit dedicated loopback test services after applying migrations. Jest/Supertest verify real auth transactions, Redis sessions/revocation/limits, CSRF/origin checks and worker/BullMQ/SMTP delivery using owned synthetic accounts and a random Redis namespace. Offline DTO/crypto/configuration/HTTP tests remain in `test:all`; no new test packages are required.

Run `npm run test:guest` with the same explicit dedicated loopback PostgreSQL/Redis services and deployed migrations. Jest/Supertest verify guest bootstrap/cookies/CSRF/limits, fixed expiry, concurrent reservation and transaction rollback, lease/version fencing, explicit expired-lease reconciliation, success/failure accounting and retained ownership across login/logout. Local controlled S3/SMTP fixtures satisfy shared infrastructure without external providers. CI runs this separate suite; no new dependency is required. Conversion engines, public conversion/download routes and frontend integration are outside its coverage.

## Development Tools

- npm workspaces — one monorepo and one lockfile.
- ESLint + Prettier — якість коду.
- TypeScript and Vite — build/watch tooling; backend builds preserve Nest decorator metadata without a separate CLI dependency.
- openapi-typescript — generated frontend contract types from OpenAPI.
- Framework/Node type definitions are development dependencies.

## Compatibility baseline

- Node.js 24 LTS (24.11.1 or newer within major 24) and npm 11.
- TypeScript 5.9 is retained because the selected OpenAPI generator and other tooling do not all support the newest TypeScript major.
- Prisma 7 is the stable selected line; CLI, client, and PostgreSQL adapter share the same version. Do not select a release candidate via a moving registry tag.
- jsdom 27 supports the installed Node.js baseline; the newest jsdom line requires a newer Node.js minor.
- Runtime libraries belong to their consuming workspace's `dependencies`; compilers, Sass, test runners, CLI tools, linters, and type definitions belong to `devDependencies`.
- Domain schema, infrastructure adapters, first-party authentication/profile transactions, guest credentials/trial transaction helpers and notification consumers are implemented. Frontend integration, settings/API-key/file/conversion endpoints and conversion consumers remain future work; auth/guest tests do not establish conversion-engine functionality.
