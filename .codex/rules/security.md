# Security

- Never expose/copy secrets or personal upload data unnecessarily. Inspect configuration names first; keep authorized credentials in memory. No raw headers, tokens, credential URLs, personal filenames, file contents, or sensitive traces in logs/reports.
- `VITE_*` is public. Keep examples harmless and [ignore patterns](../../.gitignore) aligned with secrets and audit output.
- Check ownership and expiry on every status/download path; IDs and object keys do not authorize access. Keep storage private.
- Guest credentials are restricted capabilities. Integrations require API keys; invalid explicit keys cannot fall back to cookies. Only user sessions authorize credential management.
- Preserve Secure/HttpOnly/SameSite cookies, CSRF/origin protection, documented credential hashing/rotation, and timely revocation.
- Validate actual file bytes, structure, size, archive expansion, image dimensions, and output limits server-side.
- Isolate converters with CPU/RAM/disk/process/time limits, no inherited secrets or unrestricted network/filesystem access, macros, external resources, or shell interpolation.
- Use generated object keys, isolated temporary paths, and scoped/idempotent cleanup.
- Audits use owned synthetic data in authorized environments. No arbitrary-host probing, real-key rotation, production mutations, or deletion of unrelated files/buckets without explicit scope.
