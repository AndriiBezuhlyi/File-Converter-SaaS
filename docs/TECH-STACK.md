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
- express-session + connect-redis + redis — future Redis-backed sessions.
- Helmet and Nest Throttler — security headers and rate-limit integration foundations.
- Nodemailer — SMTP transport behind the notification adapter; no production provider is selected.

## Database

- PostgreSQL — основна база даних.
- Prisma ORM — доступ до бази даних.
- Prisma PostgreSQL adapter + pg — database driver for Prisma 7.

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
- AWS SDK S3 client — shared S3-compatible transport.

## Infrastructure

- Redis + BullMQ — черга задач конвертації; Nest BullMQ integration.
- Docker Compose — локальна інфраструктура and a separate production deployment definition.
- Nginx — production static frontend and API reverse proxy.
- Mailpit — local SMTP sink for email development.
- GitHub Actions — автоматичні перевірки.

## Testing

- Vitest (`vitest`) — frontend unit tests for validation, request lifecycle and download utilities, plus component and Query/session integration tests.
- React Testing Library (`@testing-library/react`, `@testing-library/dom`) — component rendering, hook harnesses and behavior-based DOM queries. `@testing-library/user-event` models user interactions; `@testing-library/jest-dom` provides accessible DOM assertions.
- jsdom — isolated frontend test DOM. Native dialog top-layer behavior is not implemented; component tests supply a local, restored shim, while existing Playwright tests verify browser behavior.
- Jest + ts-jest — backend unit and integration runners; native ESM and decorator metadata match the NestJS build.
- Nest Testing (`@nestjs/testing`) — integration tests compile real API/worker modules and resolve runtime configuration through dependency injection. Supertest (`supertest`) exercises the HTTP shell.
- Playwright — separate Chromium E2E suite for real browser interactions, responsive layout and controlled frontend workflows.

All test libraries and supporting types are existing `devDependencies`; no additional runner, mocking server or production dependency is needed for the current scope. Frontend integration tests use a real QueryClient with controlled gateway responses. Backend integrations currently cover startup/configuration and the HTTP shell; database, Redis, storage and conversion-engine verification awaits those implementations.

Run `npm run test:all` at the repository root for frontend unit/component/integration tests, backend unit tests and backend integration tests. `npm test` runs workspace suites; `npm run test:integration` runs backend integrations only. `npm run test:e2e` remains separate and requires the existing browser/build preparation. CI's `npm run check` includes `test:all`.

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
- Installed dependencies are preparation only: authentication, queues, storage, converters, domain models, and product endpoints are not enabled in this foundation.
