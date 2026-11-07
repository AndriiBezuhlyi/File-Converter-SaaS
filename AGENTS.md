# File Converter — Working Rules

npm workspaces: React web, NestJS API and separate worker. Product features are scaffolded; verify implementation before claiming support. Communicate in Ukrainian; use English for code and developer documentation.

## Always

- Protect secrets and personal data, including logs/reports. `VITE_*` values are public. Treat uploads as untrusted and enforce backend ownership.
- Stay within the authorized task; preserve agreed behavior. Report only observed verification results.
- Verify proportionately. Update [progress](docs/progress.md) after meaningful changes; document domain schema changes in `docs/db-schema.md` when introduced.

## Read by scope

For formatting/typo fixes, this index is sufficient unless requirements or security are affected. For other changes, read rules for the affected concerns below; add topics only as scope expands.

Links are references, not recursive reading commands. Read relevant document sections; reuse unchanged instructions already in context. Refresh them when missing, changed, or uncertain.

| Affected concern                                                      | Rule                                               |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| Product behavior, MVP, guest policy                                   | [project](.codex/rules/project.md)                 |
| Secrets, authentication, access, uploads/storage, audits              | [security](.codex/rules/security.md)               |
| Module boundaries, dependencies, build, infrastructure                | [architecture](.codex/rules/architecture.md)       |
| React, styling, forms, accessibility                                  | [react-ui](.codex/rules/react-ui.md)               |
| NestJS, Prisma, backend/worker implementation                         | [backend](.codex/rules/backend.md)                 |
| HTTP contracts, clients, server state                                 | [api-state](.codex/rules/api-state.md)             |
| Conversion engines, quotas, retention, cleanup                        | [file-conversion](.codex/rules/file-conversion.md) |
| Verification strategy, test configuration, substantial implementation | [verification](.codex/rules/verification.md)       |

Sources: [requirements](docs/technical-task.md), [boundaries](docs/architecture.md), [technologies](docs/TECH-STACK.md), [visual design](DESIGN.md). Resolve conflicts from explicit user decisions; clarify material unresolved ones.

Use [api-audit](.agents/skills/api-audit/SKILL.md) or [conversion-test](.agents/skills/conversion-test/SKILL.md) for requested audits/tests. These instruction-only skills do not authorize feature implementation; missing functionality is BLOCKED/SKIPPED.

## Database Review

Use [$database-review](.agents/skills/database-review/SKILL.md) for schema, migration, SQL/ORM query, index, constraint, transaction/concurrency, database security, ownership/tenant isolation, or database performance changes and reviews.

## Workspace Hygiene

- Group disposable local scripts, logs and screenshots in `.cache/tasks/<task>/`. If an active skill requires storage outside the repository, use a sibling `<repo-name>-artifacts/<task>/` directory. Keep maintained source, test fixtures and product assets in their intended locations; do not scatter loose task files in the workspace root.
- Create additional worktrees when isolation is needed; read-only reviews normally use the existing checkout. At handoff, report retained task worktrees and artifact directories, including whether they contain unique work.
- Within authorized cleanup, inspect tracked changes, untracked/ignored files and commits absent from the target branch before removing a worktree. Use `git worktree remove` without force, then delete only a fully merged disposable task branch. Preserve unique work and existing integration/removal approval requirements.

## Testing

When implementing new functionality, create only the most essential unit, integration, and component tests.
When modifying existing functionality, do not modify the existing tests.
