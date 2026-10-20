# Architecture Boundaries

Reference: [architecture](../../docs/architecture.md), especially Repository and folder structure when adding structure.

- Keep npm workspaces, one root lockfile, `apps/web`, `apps/backend`, and `packages/contracts`.
- Frontend pages compose features; features use shared modules. Shared code cannot import features or backend internals; backend owns business policy.
- Backend controllers handle transport, services coordinate use cases/transactions, and adapters integrate external systems. Use narrow module exports without cycles.
- API and worker share backend source with separate entry points/build outputs. API replicas never start consumers; workers expose no public HTTP listener.
- PostgreSQL owns durable job/file/trial state; Redis carries queue/session operational state; object storage holds bytes. No host-local paths as interprocess contracts.
- Reuse conversion use cases for web/API callers. Keep engines behind adapters; add abstractions only for concrete needs.
- Preserve backend native ESM, relative `.js` imports, decorator metadata, and frontend contracts independent of Prisma/backend runtime.
- Material changes to public contracts, persisted ownership, production dependencies, or deployment boundaries require explicit scope/authorization.
