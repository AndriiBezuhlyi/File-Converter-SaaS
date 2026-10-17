# Security

- Never expose or unnecessarily copy secrets from environment files, cookies, sessions, recovery tokens, API keys, or MCP configuration. Inspect configuration names/structure first; use authorized values in memory only when needed.
- `VITE_*` values are public. Keep examples harmless and [ignore rules](../../.gitignore) aligned with credentials and generated audit output.
- Never log uploaded content, credentials, raw request headers, credential URLs, or personal filenames. Use sanitized codes and opaque IDs; review reports, screenshots, traces, and fixtures before sharing.
- Authenticate/authorize at backend boundaries. Check owner and expiry on every status/download path; a conversion ID or storage key is not proof of access.
- Guest credentials are restricted capabilities, not account sessions. Keep the guest trial durable and atomic; preserve API-key requirements for third-party clients and reject invalid explicit keys without cookie fallback.
- Cookie-based mutations, including guest actions, require CSRF/origin protection. Preserve Secure/HttpOnly/SameSite policy. Follow the documented password/token/key hashing and rotation rules.
- Treat every upload as untrusted: validate actual bytes, type, structure, size, archive expansion, image dimensions, and output limits on the server. Extensions and client checks are insufficient.
- Converters must run without inherited secrets or unrestricted network/filesystem access, with CPU/RAM/disk/process/time limits. No shell interpolation, macros, or external document resources.
- Keep storage private. Use generated keys, safe filenames, isolated temporary paths, and scoped/idempotent cleanup. Never empty buckets or delete unrelated files as a test.
- Audits use owned synthetic data in authorized local/staging environments. Do not probe arbitrary hosts, rotate real credentials, or mutate production data without explicit scope.
