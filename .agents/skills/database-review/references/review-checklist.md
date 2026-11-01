# Database Review Checklist

Apply only relevant checks to the detected engine/tool versions and workload. These are review questions, not requirements to redesign working code.

## Schema and integrity

- Check primary/foreign keys, relationships, nullability, uniqueness, checks, types, defaults, enums/domains, normalization and intentional denormalization.
- Verify delete/update actions, owner boundaries and compatibility with API/domain models. Identify important invariants enforced only by application code when a database constraint could reasonably enforce them without rejecting valid data.
- Account for engine-specific NULL, collation, uniqueness and constraint semantics before asserting a defect.

## Migrations

- Inspect data loss, destructive operations, unsafe type/column changes, defaults, backfills and new constraints against existing rows.
- Check ordering, deployment compatibility, large-table rewrites/locks where relevant, and migration-history consistency.
- Describe recovery for risky/irreversible changes; reversibility is not mandatory for every migration. Do not apply migrations as part of review.

## Queries and indexes

- Trace result correctness: joins, Cartesian products, owner filters, aggregations, stable ordering and pagination; inspect N+1 patterns, repeated queries and excessive retrieval, including uncontrolled `SELECT *`.
- Check parameters and allowlists for dynamic identifiers/orderings; ORM use does not make interpolated raw SQL safe.
- Tie each proposed index to a query's filters, joins, ordering or uniqueness invariant. Consider composite order, overlap, redundancy, selectivity, write/storage cost and actual read benefit.
- A suspicious query shape is a hypothesis, not proof of slowness. Ask for safe plan/workload evidence before making strong claims.

## Transactions and concurrency

- Identify atomic operations, duplicate creation, lost updates and read-modify-write races; examine isolation assumptions and transaction boundaries.
- Inspect lock scope/duration, external API calls under locks, retry boundaries and idempotency. Select isolation/locking only for a concrete race.
- Where this project's conversion lifecycle is implemented: verify atomic guest reservation/consumption and terminal-failure release; result publication tied to the current attempt lease; durable database-to-queue intent; and database/object-store reconciliation without claiming a cross-system transaction.

## Security and ownership

- Verify parameterization, least privilege, account/guest/API principal boundaries, tenant/business ownership when present, and access to sensitive fields.
- Trace ownership through reads and writes, including alternate status/download/delete paths. Frontend filters and opaque IDs do not enforce isolation.
- Inspect credential handling and log/report redaction. Consider database RLS only if the actual engine and architecture make it appropriate.

## Financial data, only when present

- Read existing financial rules before reviewing persisted amounts, rates, totals or currencies; do not invent accounting requirements.
- For exact monetary amounts, flag binary floating point unless explicitly justified. Verify precision/scale, currency representation, rounding owner/boundaries and consistency with domain rules.

## Runtime evidence, only when authorized

- Relate plans, row counts, sizes, query frequency/timing and locks to the claimed issue. Include representative parameters without personal data or credentials.
- Account for engine/version behavior and total connection budgets across API/worker replicas.
- Report static limitations when a permitted target or representative workload is absent. Avoid expensive diagnostics or executed write plans on production.
