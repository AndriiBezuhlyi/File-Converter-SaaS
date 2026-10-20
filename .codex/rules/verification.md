# Verification and Handoff

Inspect relevant `package.json` scripts/configs before execution; use existing npm tooling and checks proportionate to the change.

| Change                        | Checks                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Docs/rules/skills             | Markdown, links, policy consistency; YAML/workflows for changed skills                  |
| UI behavior                   | Focused Vitest, lint/typecheck/build as affected; browser flow                          |
| API/worker                    | Focused Jest/Supertest, lint/typecheck/build as affected; real integrations when needed |
| Schema/contracts/dependencies | Prisma/migration or contract-drift checks; affected tests/build/lockfile                |

- Docs-only changes do not require application tests/builds or live APIs.
- Format changed instruction Markdown with installed Prettier, explicit paths, and `--ignore-path .gitignore`. Preserve unrelated formatting.
- Validate changed skills with the skill-creator validator; if unavailable, check YAML, names, fields, placeholders, references, and workflow safety locally. Disclose the fallback.
- Inspect `playwright.config.ts` and `scripts/playwright.mjs` before E2E runs; current setup needs a web build and local Chromium.
- Report actual commands/results and limitations; missing implementations are BLOCKED/SKIPPED. Never weaken tooling to pass checks.
- Use Context7 for library/API docs; disclose failures and fall back to official sources. Do not modify global tools/credentials/configuration.
