# API Contracts and Server State

Use the API contract in [technical-task.md](../../docs/technical-task.md) and its ownership/guest clarifications in [architecture.md](../../docs/architecture.md).

- Preserve `/api/v1`, multipart fields, `202` acceptance, documented job states, and `{ error: { code, message } }`. Distinguish an HTTP rejection from a later accepted job failure.
- Third-party clients require `X-API-Key`. First-party user/guest cookies have their documented scopes; an invalid explicit key must not fall back to cookies.
- Frontend imports generated contracts rather than Prisma types or independently invented response shapes. Runtime server validation remains authoritative.
- TanStack Query owns user/guest eligibility, settings, file lists, and job status; local state owns chosen files, dialogs, and upload progress. Keep auto-save views on one query/mutation.
- Poll active conversions at the documented interval, stop on terminal states, and back off after connectivity failures. Do not mark a job failed because polling failed.
- Prevent duplicate submissions. After an ambiguous upload response, do not automatically replay it; resume by known conversion ID when available.
- Invalidate affected queries after confirmed mutations/completion. Reflect accepted-job retention rather than the user's subsequently changed setting.
- Treat expired/deleted downloads as unavailable, with actionable copy. Keep authenticated/guest download authorization intact; never turn a storage location into a public link.
