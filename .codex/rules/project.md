# Project Context

File Converter SaaS converts JPG ↔ PNG and DOCX → PDF. Read the source documents linked from [AGENTS.md](../../AGENTS.md) for the area being changed; [TECH-STACK](../../docs/TECH-STACK.md) is the technology inventory.

- Preserve the agreed trial: one successful free conversion without registration; later conversions require login/registration. Failures do not consume the trial, and concurrent guest submissions cannot reserve two jobs.
- Guest results are temporary for one hour after completion. Account saving, guest ownership, API-key access, and retention follow the technical task and architecture.
- PDF → DOCX, Telegram login, billing, batch upload, and other formats are outside the MVP unless explicitly requested.
- Current state: npm workspaces, empty React shell, API bootstrap, independent idle worker, Prisma configuration without domain models, empty OpenAPI paths, and infrastructure/testing configuration.
- Authentication, guest accounting, converters, queue consumers, storage adapters, and product endpoints are planned, not operational. Installed libraries and passing bootstrap tests do not prove those features exist.
- Work in the current requested slice. Do not repeat initialization, implement missing features during audits, or expand dependencies to complete an unrelated future phase.
