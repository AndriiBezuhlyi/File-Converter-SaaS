# File Conversion and Storage

Follow conversion, guest-trial, isolation, and retention requirements in [architecture](../../docs/architecture.md) and [technical task](../../docs/technical-task.md).

- MVP directions are JPG ↔ PNG and DOCX → PDF, one input per task, up to 20 MB. Derive supported targets and exact byte limits from the server contract/configuration.
- Validate file content and resource expansion before/during processing; client MIME, filenames, and extensions are untrusted. Reuse the safeguards in [security.md](security.md).
- Sharp and LibreOffice belong behind converter adapters. Do not run expensive conversion on the API event loop or expose converter-specific internals in the public contract.
- Installing LibreOffice or setting container limits is not per-conversion isolation. Verify the subprocess sandbox and absence of inherited credentials/network access before accepting untrusted input.
- Reserve the guest trial atomically for one active job, consume it on successful publication, and release it only on terminal failure. Retries and duplicate delivery must not grant a second success.
- Guest outputs are temporary; account outputs follow the acceptance-time auto-save snapshot. Changing the toggle or logging in does not retroactively save guest results.
- Enforce ownership, deletion, and expiry during reads even when physical cleanup is delayed. Clean inputs, failed/unpublished outputs, expired results, and attempt-local files idempotently.
- Test image transparency/orientation and document/font fidelity with controlled fixtures. Do not promise byte equality for lossy formats or exact document layout for every input.
