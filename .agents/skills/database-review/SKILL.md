---
name: database-review
description: Review database schema design and changes, migrations, SQL and ORM/query-builder queries, indexes, constraints, transactions, concurrency, database security, tenant isolation and performance. Use for database-related code reviews and persistence changes; produce evidence-based findings with engine-aware recommendations. Read-only by default.
---

# Database Review

## Establish the actual boundary

1. Follow [AGENTS.md](../../../AGENTS.md). Read the relevant [backend](../../../.codex/rules/backend.md) and [security](../../../.codex/rules/security.md) sections; consult [architecture](../../../docs/architecture.md) for affected persistence invariants. Links are scoped references, not instructions to load every document.
2. Identify the engine and version from schema/configuration, manifests and deployment definitions. Distinguish configured versions from a verified running server. Identify ORM/query builder, raw SQL, migration tooling and installed versions; inspect schema, migration history, model/query callers and tests.
3. Separate configured tooling, implemented persistence and live integration. When the engine is unknown, review engine-agnostically; do not infer one from this skill or the task. Use engine-specific advice only after confirming applicability and version support.

Repository starting points (refresh before relying on them): `apps/backend/prisma/schema.prisma`, `apps/backend/prisma.config.ts`, `apps/backend/package.json`, API/worker modules, `infra/compose*.yaml`, and [TECH-STACK.md](../../../docs/TECH-STACK.md). PostgreSQL 18 / Prisma 7 models, SQL integrity guards and migrations now exist; [db-schema.md](../../../docs/db-schema.md) describes the implemented boundaries. API/worker share a runtime Prisma/pg infrastructure provider; domain queries and transactions are still deferred. Schema tests do not prove live product integration. The migration location is `apps/backend/prisma/migrations/`.

## Review

Use the relevant sections of [review-checklist.md](references/review-checklist.md); skip unrelated areas. Trace proposed constraints/indexes to business invariants and actual query patterns. Check changed migrations against deployed history and old/new application compatibility when those artifacts exist.

For this File Converter, consult the architecture's persistence, lifecycle and guest-trial sections when reviewing ownership, guest reservations, key rotation, result publication, auto-save snapshots or retention. Treat documented future models as requirements, not implemented database guarantees. Do not invent missing-model defects while that work remains explicitly deferred. Financial checks apply only if monetary data is actually persisted; this project is not assumed to be a financial application.

Distinguish correctness established from code from performance hypotheses. Explain the concrete race before recommending locks or isolation changes. ID types, FK indexes and pagination strategies are workload decisions: do not mandate bigint IDs, reject UUIDs/OFFSET, or index every FK mechanically. PostgreSQL RLS, partial/covering indexes, `timestamptz`, `SKIP LOCKED` and statistics extensions require a confirmed PostgreSQL workload and a specific benefit; they are not universal rules.

When documentation is needed, use Context7 or official engine/tool documentation for the detected versions. Review source files directly without executing configuration that loads secret environments merely to identify tooling.

## Access and diagnostics

- Default to static, read-only review. Do not apply migrations, alter schemas/indexes/permissions, change data or rotate credentials. An authorized fix may be prepared as a patch/migration for review; this skill alone never authorizes applying it to a live database.
- Do not connect to production/shared databases unless explicitly required and clearly authorized. Establish environment, scope and query cost before runtime diagnostics; respect any existing authorization boundaries.
- Prefer schema/migration files, generated types, `.env.example` and configuration structure. Never print database URLs, connection strings, passwords, tokens or sensitive records. Avoid reading secret values unnecessarily.
- Use plans, row counts, index/table sizes, frequency, timing and lock evidence only when safely available. Plain `EXPLAIN` is preferable when execution could have side effects or material cost; it still requires a scoped, permitted target. Never run `EXPLAIN ANALYZE` on writes or expensive production queries merely to inspect them, or run costly production diagnostics without explicit authorization.

## Findings and handoff

Separate confirmed issues, recommendations and items requiring runtime evidence. For each finding include severity, file/line or database object, problem, supporting evidence, impact and recommended fix. Include a short corrected SQL/schema example only when useful.

- `critical`: likely corruption, security breach, isolation failure or severe correctness risk.
- `high`: substantial correctness, integrity, migration or evidenced performance risk.
- `medium`: meaningful issue worth fixing.
- `low`: limited-impact improvement.

Do not inflate severity or invent findings. Say when no material issues were found; identify unavailable coverage and commands actually run. With no implemented models/queries, review the available foundation and mark domain/runtime checks unavailable rather than fabricating a target. Update progress only when maintained project files change, following the repository rules.
