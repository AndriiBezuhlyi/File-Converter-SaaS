# File Converter — Codex Instructions

These instructions apply to this project and its descendants. The application currently has a monorepo foundation; product features are not implemented.

## Read at the start of every task

Open [project.md](.codex/rules/project.md) and [security.md](.codex/rules/security.md). Then open every matching topic below; load additional topics when scope changes. Files in `.codex/rules/` are not implicitly loaded by their directory name: reading them means opening their contents. Report missing required files rather than inventing rules.

Communicate with the user in Ukrainian. Use English for code and developer documentation unless preserving an existing document's language. Follow the current user request; if source documents conflict, resolve from explicit decisions or clarify the unresolved part while continuing independent work.

## Sources of truth

[Technical task](docs/technical-task.md) defines behavior; [architecture](docs/architecture.md) defines boundaries; [TECH-STACK](docs/TECH-STACK.md) owns technology choices; [DESIGN](DESIGN.md) owns visual rules. Read the relevant sections before changing their subject. Keep detailed requirements there rather than duplicating them in this index.

## Task routing

All rows add to the two mandatory rules above. Apply every matching row.

| Task                                                                | Additional rules                                                                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module boundaries, shared code, dependencies, build, infrastructure | [architecture](.codex/rules/architecture.md), [verification](.codex/rules/verification.md)                                                                                   |
| React, routes, styling, forms, accessibility, visible copy          | [react-ui](.codex/rules/react-ui.md), [verification](.codex/rules/verification.md); architecture when adding structure                                                       |
| NestJS, Prisma, sessions, API keys, workers                         | [backend](.codex/rules/backend.md), [architecture](.codex/rules/architecture.md), [verification](.codex/rules/verification.md)                                               |
| HTTP contracts, API clients, server state, polling, pagination      | [api-state](.codex/rules/api-state.md), [verification](.codex/rules/verification.md); backend/react-ui as affected                                                           |
| Uploads, conversion, storage, quotas, retention, cleanup            | [file-conversion](.codex/rules/file-conversion.md), [backend](.codex/rules/backend.md), [api-state](.codex/rules/api-state.md), [verification](.codex/rules/verification.md) |
| Documentation, rules, skills, task handoff                          | [verification](.codex/rules/verification.md) and any topic being edited                                                                                                      |

## Project skills

Use the relevant skill for an audit/testing request, not automatically for ordinary implementation.

| Skill                                                      | Workflow                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [api-audit](.agents/skills/api-audit/SKILL.md)             | Review REST contracts, access control, responses, and conversion lifecycle; produce a sanitized Markdown report         |
| [conversion-test](.agents/skills/conversion-test/SKILL.md) | Verify conversion behavior and failure/retention scenarios using isolated fixtures; produce a sanitized Markdown report |

Both are instruction-only. Discover them from `.agents/skills/`; do not duplicate them under `.codex/skills/`. Missing product implementations are BLOCKED/SKIPPED evidence, never successful audit results.

Update [progress](docs/progress.md) after meaningful changes. Future database structure changes also require `docs/db-schema.md`, created when domain schema work begins. New application work requires a user task authorizing that scope; an audit or instruction update does not authorize implementing features.
