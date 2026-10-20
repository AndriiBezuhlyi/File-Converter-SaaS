# Backend

Reference: affected persistence, authentication, or lifecycle sections in [architecture](../../docs/architecture.md).

- Use explicit NestJS modules and separate API producers/worker consumers. Keep controllers free of engine/storage policy.
- Validate DTOs server-side and authorize ownership at backend boundaries.
- Use Prisma transactions/constraints for guest reservations, ownership, state transitions, and conditional result publication; Redis is not the durable record.
- Separate account, guest, and API-key scopes. User sessions alone manage credentials; preserve verification/recovery/CSRF requirements.
- No process-memory session store or validity cache that delays credential revocation.
- Make worker attempts idempotent, publish only from the current lease, bound transient retries, and reconcile crashes. Invalid input must not retry indefinitely.
- Synchronize implemented HTTP changes with OpenAPI/generated types. Empty contracts do not prove implementation.
- Introduce models, migrations, consumers, and adapters only within authorized features, with focused tests and domain-schema documentation.
