# File Converter

The React frontend has a responsive layout, navigation, design tokens, accessible shared components, local file/target selection, conversion workflow UI, and an API documentation page. NestJS starts an API shell and an independent idle worker. Server-backed conversion, authentication, account/file workflows, domain models, storage adapters, and queue consumers are not implemented yet.

## Requirements and documentation

- [Technical task](docs/technical-task.md)
- [Architecture](docs/architecture.md)
- [Design system](DESIGN.md)
- [Technology inventory and compatibility notes](docs/TECH-STACK.md)

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

The application shells deliberately do not connect to these services yet. Infrastructure connections, credentials validation for integrations, and application health/readiness checks will be added with the corresponding modules.

## Development

Run each process in its own terminal:

```sh
npm run dev:web
npm run dev:api
npm run dev:worker
```

- Web: http://127.0.0.1:5173, with `/api/` proxied to the API; `/api-docs` remains a frontend route.
- API: http://127.0.0.1:3000; `/api/v1` is the future prefix. Requests currently return 404.
- Worker: no HTTP listener and no registered processors. An idle timer keeps the foundation process alive until consumers own live connections.

Backend development builds preserve TypeScript decorator metadata, then restart the selected process when its source changes. Separate output directories prevent the API and worker from overwriting each other. No global Nest CLI is needed.

The backend uses native ESM for NestJS 12. Relative TypeScript imports use `.js` extensions for the emitted Node.js files. Jest runs with VM modules and ts-jest ESM compilation; the resulting Node experimental warning is limited to test execution.

Frontend layout, providers, and routing live in `apps/web/src/app`; pages compose shared components from `shared/ui`. All nine documented routes exist; future feature pages clearly indicate that their workflows are not available yet. Onest and IBM Plex Mono are self-hosted with Latin/Ukrainian glyphs and SIL OFL licenses in `apps/web/public/fonts`. Implement the remaining features in the order recorded in [the implementation plan](docs/implementation-plan.md).

The converter feature supports one local JPG/JPEG, PNG, or DOCX file via picker or drag-and-drop. It shows filename/size, selects only JPG ↔ PNG or DOCX → PDF targets, and rejects empty, unsupported, multiple, directory, and oversized inputs without discarding a previous valid selection. The local limit is 20,000,000 bytes (decimal MB), centralized in `features/converter/lib/file-selection.ts`; future server capabilities must supply the authoritative limit. These metadata checks do not inspect file contents. Files stay in component memory. The production entry has no conversion gateway, so it performs no upload, persistence, conversion, or quota consumption and explicitly disables submission.

The conversion UI is prepared behind a feature-local `ConversionGateway` port. Its types are frontend view models, not invented HTTP DTOs: plan item 8 must map the finalized/generated API contract to this port, including authenticated guest/session access and CSRF. TanStack Query owns access/job data; local state owns selection, measured upload bytes, dialogs, and transient feedback. The flow rechecks access before submission, blocks duplicate clicks, distinguishes upload/acceptance/queued/processing/completed/failed, polls active jobs every 2 seconds with a 30-second interval after connectivity errors, stops terminal polling, and preserves a non-secret `conversion` ID in the URL. Ambiguous POST outcomes are never replayed automatically; without a discoverable accepted ID they remain blocked pending contract-backed recovery. Trial state is read from the gateway, never counted or stored in the browser. Downloads use returned Blobs, sanitized filenames, and short-lived object URLs, not arbitrary redirect URLs. Expiry/denial removes the download action without turning success into conversion failure or renewing a trial. The native auth dialog gates the next guest conversion, keeps selection in memory while open, and restores focus on close. Navigating to the future auth pages may require file reselection.

For controlled UI verification, run `npm run dev:web` and open [the development-only converter fixture](http://127.0.0.1:5173/test-fixtures/converter/?scenario=success). `scenario` accepts `success`, `failed`, `connection`, `unknown`, `expired`, `saved`, `reserved`, `consumed`, `download-error`, `download-expired`, `unmeasured`, and `rejected`. To check expiry discovered only when downloading, open `?scenario=download-expired&conversion=fixture_job`: the result starts available, then the download is denied while completion and the consumed guest allowance are preserved. The fixture is visibly labeled, accepts JPG → PNG for its one known synthetic PNG output, and never converts the source or calls product endpoints. It is a separate HTML entry under `apps/web/test-fixtures`, absent from the production bundle; no runtime mock switch is exposed by the application. Chromium E2E uses a separate Vite server on 4174 for these scenarios and the existing production preview on 4173 for ordinary routes. These responses do not establish real authentication, durable guest accounting, ownership enforcement, or live conversion. Those remain backend/integration work.

`/api-docs` describes the planned seven-operation REST contract with section navigation, placeholder-only cURL/JSON examples, API-key rules, polling/retention semantics, limits, and errors. Shared `CodeBlock` supports copying, confirmation, clipboard-denial feedback, and keyboard scrolling on narrow screens. This is pre-launch documentation based on the technical task/architecture, not a live API explorer or generated OpenAPI UI; `packages/contracts/openapi.json` still has empty paths. Final file-list schemas, pagination parameters, and numerical request quotas remain for backend contract work. No API requests are made by the page.

## Verification

```sh
npm run check
npm run test:e2e:install
npm run test:e2e
```

`check` runs formatting, ESLint, all workspace typechecks, frontend navigation/component tests, backend bootstrap/integration smoke tests, Prisma schema validation, generated-contract drift checks, and production builds. Playwright additionally verifies keyboard navigation, direct-route reloads, 404 recovery, mobile navigation, and responsive overflow. These checks do not establish that the planned product workflows work.

### Lint safeguards

`npm run lint` checks the repository with zero warnings and runs the configuration regression tests (`npm run lint:config`). It uses the existing ESLint/typescript-eslint packages; no additional plugins are required.

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

The Prisma schema contains only PostgreSQL and generator configuration. Domain models and migrations are deliberately absent. `npm run db:validate` checks this foundation without a running database. After implementing the models, use `npm run db:generate`; migrations are explicit backend workspace commands. Do not run development migration commands in production.

Prisma CLI configuration loads the root `.env`; the runtime application never imports the CLI. The future Prisma client will use the PostgreSQL driver adapter installed in the backend workspace.

`packages/contracts/openapi.json` is an empty, versioned API shell with no product routes. `npm run contracts:generate` generates its TypeScript declarations; `npm run contracts:check` checks for drift without modifying the committed output. When controllers exist, generate the source OpenAPI artifact from Nest Swagger.

## Docker deployment foundation

`infra/compose.yaml` is local infrastructure. `infra/compose.production.yaml` is a standalone production definition, not an overlay that inherits development port bindings.

API, worker, and proxy each have their own multi-stage Dockerfile. The worker image alone installs LibreOffice Writer, fonts, and sandbox tooling. Container limits are prepared; the per-conversion sandbox runner is not implemented, and untrusted files must not be processed until it is.

Copy `.env.production.example` to an untracked `.env.production` and provide real credentials. In production, `DATABASE_URL` must reach `postgres:5432`, and `REDIS_URL` must reach `redis:6379` with the configured password; encode password characters correctly in URLs.

```sh
npm run infra:production:config
docker compose --env-file .env.production -f infra/compose.production.yaml build
```

Only the proxy publishes a host port. This template expects HTTPS termination on the server's ingress/load balancer before port 8080; it does not provision certificates or enable production authentication. Restrict direct HTTP exposure to that ingress. Pin validated image digests at release time. Database backups, application readiness checks, a migration release job, and converter sandbox verification remain prerequisites for deploying the actual product.

`npm run infra:down` stops local infrastructure and retains named volumes. No reset/delete-volume command is included.

## Local development instructions

Open this project directory itself in Codex so its [AGENTS.md](AGENTS.md) and repository skills can be discovered. The index explicitly routes to the applicable local rules; [progress.md](docs/progress.md) records meaningful changes. The documented policy is one successful free guest conversion, followed by login/registration for further conversions; the foundation does not implement this flow yet.
