# API Contracts and State

Reference: affected API operations in the [technical task](../../docs/technical-task.md).

- Preserve `/api/v1`, multipart fields, `202`, four public job states, and `{ error: { code, message } }`. HTTP rejection and accepted-job failure differ.
- Integrations require `X-API-Key`; cookie principals retain their restricted scopes. Invalid explicit keys never fall back.
- Import generated frontend contracts, not Prisma/backend runtime types. Server validation remains authoritative.
- TanStack Query owns eligibility, settings, files, and job status; local state owns files selected for upload, dialogs, and upload progress. Share the auto-save query/mutation.
- Poll active jobs at the documented interval; stop on terminal states, back off on connectivity failure, and keep request failures distinct from job failures.
- Prevent duplicate submissions; do not replay ambiguous uploads automatically. Resume by known conversion ID.
- Invalidate affected queries after confirmed mutations. Display acceptance-time retention and server expiry; expired/deleted results remain ownership-protected and unavailable.
