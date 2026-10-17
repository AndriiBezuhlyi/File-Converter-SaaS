# Verification and Handoff

Inspect the root/workspace `package.json` and relevant configs before choosing commands. Run from the project root with npm; execute only checks justified by the change.

| Change                        | Appropriate checks                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Documentation/rules/skills    | Changed Markdown formatting, relative links/paths, referenced scripts, skill frontmatter, policy consistency      |
| Frontend behavior/UI          | Relevant Vitest cases, lint, typecheck/build; affected browser flow and responsive states                         |
| Backend/API/worker            | Relevant Jest/Supertest cases, lint, typecheck/build; real dependency integration when the behavior needs it      |
| Schema/contracts/dependencies | Prisma validation, contract generation/drift, affected tests/build; inspect migrations and lockfile as applicable |

Existing root commands include `format:check`, `lint`, `typecheck`, `test`, `test:integration`, `db:validate`, `contracts:check`, `build`, `test:e2e`, and the aggregate `check`. The current E2E setup needs a web build and project-local Chromium; inspect `playwright.config.ts` and `scripts/playwright.mjs` rather than assuming browser/port behavior.

- For changed instruction Markdown, use the installed Prettier CLI on explicit paths with `--ignore-path .gitignore` so files excluded from normal source formatting can still be checked. Format only changed files.
- Skill validation normally uses the skill-creator validator when its runtime is available. Otherwise validate YAML, required fields, naming, unfinished placeholders, references, and workflow safety with available local tooling, and disclose the fallback.
- Separate environment restrictions from application failures. Do not weaken checks, alter tools, or install extra tools/plugins merely to get a green result.
- For docs-only work, do not run application tests/builds or call live APIs unless necessary to verify a referenced claim. Never describe earlier checks as newly executed.
- Report what changed, actual checks/results, and material limitations. Mark unavailable features/dependencies BLOCKED or SKIPPED, not PASS.
- Update [docs/progress.md](../../docs/progress.md) after meaningful changes, with the date, scope, files, verification, known issues, and next steps. Do not fabricate completed product work.
- When domain database structures change, create/update `docs/db-schema.md`; generator-only configuration does not require invented schema documentation.
- Use Context7 for library/API documentation; if it fails, disclose the limitation and use official primary documentation. Use Chrome DevTools for meaningful browser evidence and existing Playwright as a documented fallback. Do not change global Codex credentials/configuration in a project task.
