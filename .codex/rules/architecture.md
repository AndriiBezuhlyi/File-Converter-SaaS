# Architecture and Boundaries

Follow [docs/architecture.md](../../docs/architecture.md), especially Repository and folder structure. It describes the intended product; [project.md](project.md) identifies what exists now.

- Keep npm workspaces, one root lockfile, `apps/web`, `apps/backend`, and `packages/contracts`. Do not introduce another package manager or duplicate backend projects.
- Frontend pages compose features; features use shared API/UI/helpers. Shared code must not import features or backend internals. Keep business policy authoritative on the server.
- Backend controllers handle transport, services coordinate use cases/transactions, and adapters integrate external systems. Modules use narrow exported providers, with no circular imports.
- API and worker use separate entry points and build directories from the same backend source. Producers must not accidentally start consumers in API replicas; workers have no public HTTP listener.
- PostgreSQL owns durable job/file/trial state, Redis transports queue/session operational state, and object storage holds bytes. No local host paths as cross-process storage contracts.
- Share conversion use cases between web and API-key callers; adapters own format-specific engines. Add abstractions for demonstrated substitution needs, not every class.
- Preserve native backend ESM, `.js` relative imports, and decorator metadata in build/tests. Keep frontend contracts independent of Prisma/runtime backend imports.
- Do not silently change public contracts, persisted ownership, selected production dependencies, or deployment boundaries. Explain necessary changes and follow the user's scope/authorization.
