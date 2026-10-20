# Conversion and Storage

Reference: affected conversion, guest-trial, isolation, and retention sections in [architecture](../../docs/architecture.md).

- JPG ↔ PNG and DOCX → PDF; one input, up to 20 MB. Derive exact byte limits and targets from server configuration/contracts.
- Validate real content and resource expansion. Security rules apply to upload/engine changes; client MIME/extensions are untrusted.
- Keep Sharp/LibreOffice behind worker adapters; no expensive conversion on the API event loop.
- A LibreOffice install or container limit does not prove per-conversion isolation; verify the subprocess sandbox and absence of inherited credentials/network access.
- Atomically reserve one guest job, consume on successful publication, release only on terminal failure. Retries/duplicate delivery cannot release early or publish twice.
- Guest outputs are temporary; account retention uses the acceptance-time auto-save snapshot. Login/toggle changes do not retroactively save guest results.
- Enforce ownership, deletion, and expiry on reads before cleanup. Remove inputs, unpublished/expired outputs, orphan objects, and attempt files idempotently.
- Check transparency/orientation and document/font fidelity with controlled fixtures; lossy output need not be byte-identical.
