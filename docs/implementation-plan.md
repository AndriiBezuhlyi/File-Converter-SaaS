1. [x] Frontend: build the responsive layout, routing, design tokens, and accessible shared components according to DESIGN.md. Completed 2026-10-20.

2. [x] Frontend: build the converter with drag-and-drop, file selection, supported targets, and the 20 MB limit. Completed 2026-10-20.

3. [x] Frontend: add upload progress, processing/result/error states, downloads, and the guest flow: one successful free conversion, then sign-in before another upload. Completed 2026-10-22

4. [x] Frontend: build registration, email verification, sign-in/sign-out, and password recovery interfaces with form validation. Completed 2026-10-22

5. [x] Frontend: build the profile, personal data/password changes, auto-save settings, and API-key creation/copy/masking/rotation controls. Completed 2026-10-22

6. [x] Frontend: build “My files” with date sorting, type filtering, name search, details, download/delete actions, empty states, and synchronized auto-save settings. Completed 2026-10-22

7. [x] Frontend: build the API documentation page with API-key authentication, operations, examples, limits, and errors. Completed 2026-10-20.

8. Frontend: prepare typed API clients and TanStack Query hooks against the agreed contract, including polling, cache updates, connection failures, and focused UI tests; verify live integration once the backend is available.

9. [x] Database: add PostgreSQL/Prisma models, constraints, indexes, and migrations for users, settings, credentials, guest trials, API keys, files, and conversions; document the schema. Completed 2026-11-01.

10. [x] Backend: connect PostgreSQL, Redis/BullMQ, private object storage, and email delivery using the existing API/worker infrastructure. Completed 2026-11-01.

11. [x] Backend: implement email authentication, verification/recovery, secure sessions, confirmed profile/password changes, CSRF protection, and rate limiting. Completed 2026-11-02.
    - **Item 8:** Finalize auth/session and CSRF contracts; integrate frontend authentication, recovery, and account/password flows using typed API clients and TanStack Query. Verify session handling and cache cleanup.

12. [x] Backend: implement protected guest credentials and durable, atomic trial accounting: reserve one active job, consume on success, release on terminal failure, and retain result access after login. Completed 2026-11-05.
    - **Item 8:** Integrate guest eligibility and trial-state handling with the frontend. Verify concurrent requests, failure recovery, and result access after login.

13. [x] Backend: implement synchronized account settings and hashed API keys with one active key, immediate rotation/revocation, and separate account/guest/API permissions. Completed 2026-11-05.
    - **Item 8:** Integrate profile settings and API-key management with typed clients, mutations, and cache synchronization. Verify permissions and key rotation.

14. [x] Backend: implement validated uploads and the shared REST conversion lifecycle, ownership checks, status polling endpoints, and consistent errors; synchronize OpenAPI and generated types. Completed 2026-11-05.
    - **Item 8:** Integrate frontend uploads, conversion creation, status polling, error handling, and result metadata using generated types. Verify request cancellation and cache updates.

15. [x] Backend: implement the independent BullMQ worker with Sharp JPG ↔ PNG and LibreOffice DOCX → PDF adapters, process isolation, resource limits, timeouts, bounded retries, and idempotent result publication. Completed 2026-11-05.
    - **Item 8:** Replace simulated conversion results with real processing and downloads. Verify all supported conversion directions and terminal states.

16. [x] Backend: implement saved-file search/filter/sort, protected downloads/deletion, acceptance-time auto-save policy, one-hour temporary results, and repeatable cleanup of expired/failed/orphan files without resetting guest quotas or transferring guest results to accounts. Completed 2026-11-05.
    - **Item 8:** Integrate “My files”, filtering, sorting, cursor pagination, downloads, deletion, auto-save settings, and expiry handling. Verify cache consistency.

17. Verification: validate live frontend/API integration and run focused unit, integration, and E2E tests for conversion, guest concurrency, authorization, key rotation, saving, expiry, deletion, and failure recovery; check security, accessibility, and performance. Add live E2E coverage incrementally as items 8 and 10–16 become available. Explicitly cover an authenticated user completing each supported conversion direction, polling the real job to completion, downloading the result, and seeing it in “My files” when the acceptance-time auto-save setting requires persistence.
    - **Item 8 completion gate:** Confirm all frontend API clients and TanStack Query hooks use agreed contracts, mock product flows are replaced by live integrations, polling/cancellation/cache/error handling work correctly, and relevant integration/E2E tests pass. Mark item 8 complete only after these conditions are verified.

18. Deployment: verify Docker images and server configuration, HTTPS, secrets, migrations, health checks, backups, and independent API/worker scaling; update API documentation and run lint, typecheck, build, and acceptance checks.
