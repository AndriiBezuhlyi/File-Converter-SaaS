1. [x] Frontend: build the responsive layout, routing, design tokens, and accessible shared components according to DESIGN.md. Completed 2026-10-20.
2. [x] Frontend: build the converter with drag-and-drop, file selection, supported targets, and the 20 MB limit. Completed 2026-10-20.
3. [x] Frontend: add upload progress, processing/result/error states, downloads, and the guest flow: one successful free conversion, then sign-in before another upload. Completed 2026-10-22 for frontend states/orchestration with a test-injected gateway; live API transport and server enforcement remain in items 8 and 12–17.
4. Frontend: build registration, email verification, sign-in/sign-out, and password recovery interfaces with form validation.
5. Frontend: build the profile, personal data/password changes, auto-save settings, and API-key creation/copy/masking/rotation controls.
6. Frontend: build “My files” with date sorting, type filtering, name search, details, download/delete actions, empty states, and synchronized auto-save settings.
7. [x] Frontend: build the API documentation page with API-key authentication, operations, examples, limits, and errors. Completed 2026-10-20.
8. Frontend: prepare typed API clients and TanStack Query hooks against the agreed contract, including polling, cache updates, connection failures, and focused UI tests; verify live integration once the backend is available.
9. Database: add PostgreSQL/Prisma models, constraints, indexes, and migrations for users, settings, credentials, guest trials, API keys, files, and conversions; document the schema.
10. Backend: connect PostgreSQL, Redis/BullMQ, private object storage, and email delivery using the existing API/worker infrastructure.
11. Backend: implement email authentication, verification/recovery, secure sessions, confirmed profile/password changes, CSRF protection, and rate limiting.
12. Backend: implement protected guest credentials and durable, atomic trial accounting: reserve one active job, consume on success, release on terminal failure, and retain result access after login.
13. Backend: implement synchronized account settings and hashed API keys with one active key, immediate rotation/revocation, and separate account/guest/API permissions.
14. Backend: implement validated uploads and the shared REST conversion lifecycle, ownership checks, status polling endpoints, and consistent errors; synchronize OpenAPI and generated types.
15. Backend: implement the independent BullMQ worker with Sharp JPG ↔ PNG and LibreOffice DOCX → PDF adapters, process isolation, resource limits, timeouts, bounded retries, and idempotent result publication.
16. Backend: implement saved-file search/filter/sort, protected downloads/deletion, acceptance-time auto-save policy, one-hour temporary results, and repeatable cleanup of expired/failed/orphan files without resetting guest quotas or transferring guest results to accounts.
17. Verification: validate live frontend/API integration and run focused unit, integration, and E2E tests for conversion, guest concurrency, authorization, key rotation, saving, expiry, deletion, and failure recovery; check security, accessibility, and performance.
18. Deployment: verify Docker images and server configuration, HTTPS, secrets, migrations, health checks, backups, and independent API/worker scaling; update API documentation and run lint, typecheck, build, and acceptance checks.
