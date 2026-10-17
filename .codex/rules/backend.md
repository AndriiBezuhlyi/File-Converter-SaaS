# Backend

Read the backend boundaries, persistence, authentication, and lifecycle sections of [architecture](../../docs/architecture.md); [TECH-STACK](../../docs/TECH-STACK.md) owns dependency choices.

- Keep NestJS modules explicit. API and worker share services/policies but register their own producers/consumers.
- Validate inputs server-side through DTOs and configured validation; controllers must not contain conversion-engine or storage policy.
- Use Prisma transactions/constraints for atomic ownership, guest reservation, state transitions, and result publication. Do not treat Redis state as the durable record.
- Preserve owner isolation across account, API-key, and guest principals. Account/password/key management cannot be authorized by a guest credential or public API key.
- Do not implement session storage in process memory or cache key validity in a way that delays revocation. Use documented verification/recovery/CSRF requirements.
- Keep worker attempts idempotent, conditionally publish results, bound retries to transient failures, and reconcile crashes. Invalid input must not be retried indefinitely.
- Update OpenAPI and generated contract types when actual HTTP operations change; an empty foundation artifact is not an implemented API.
- Domain models/migrations, consumers, and integration adapters are absent today. Introduce them only for an authorized feature, with relevant tests and database documentation.
