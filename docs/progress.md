# Development Progress

## 2026-10-17 — Local instructions, skills, and requirement reconciliation

- Added the root rule index and eight selectively loaded topics in `.codex/rules/`.
- Added instruction-only `api-audit` and `conversion-test` under `.agents/skills/`; no audit execution, fabricated findings, or helper scripts.
- Restored the agreed guest trial in `docs/technical-task.md`: one successful free conversion, login for subsequent conversions, durable reservation/ownership, and temporary result access.
- Moved `docs/DESIGN.md` to the root, repaired document links/tree, removed the obsolete discrepancy note from README, and ignored future generated audit reports.
- Application code, domain schema, dependencies/lockfile, infrastructure, and global Codex configuration are outside this change and remain unchanged.

### Verification

- Passed Markdown parsing for all 17 project documentation/instruction files and resolution of 56 relative links, including linked heading anchors. New instructions, skills, README, TECH-STACK, and this log pass explicit Prettier formatting checks; existing source-document formatting is preserved.
- Passed two skill manifests using existing Node.js and `js-yaml`: required YAML fields, allowed keys, names/descriptions, workflow sections, placeholders, references, and no duplicate skill directory. Python is unavailable, so the Python skill-creator validator was not run.
- Checked all eight rules, referenced npm scripts, absence of inherited Finance Panel instructions, and consistency of the restored guest trial across the technical task, architecture, design, and local instructions.
- Verified ignore behavior for environment secrets and future audit reports, while example configurations, rules, and skills remain trackable. SHA-256 comparison confirms all 85 protected application, dependency, test, and infrastructure files are unchanged; no new files were added within those protected areas.
- Application tests/builds and live API/conversion audits were not run for this documentation/instructions change. Runtime skill verification remains blocked by the missing product implementations.

### Tool assessment

| Capability                      | Observed state                                                                  | Use / limitation                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Shell, filesystem, Node.js, npm | Available; used                                                                 | Local editing and validation with installed tooling                                                                  |
| Codex CLI/configuration         | CLI 0.160.1; user config inspected by section/key names only; no project config | Launch from this project directory to discover its instructions/skills; global configuration unchanged               |
| Context7 MCP                    | Exposed; resolve call rejected configured API key                               | Use official primary docs until credentials are repaired outside this task                                           |
| Chrome DevTools MCP             | Browser/console/network tools exposed; not exercised here                       | Runtime UI inspection when application work needs it                                                                 |
| GitHub MCP                      | Repository/review tools exposed; account/repository access not tested           | Future PR/source workflows; no external writes in this task                                                          |
| Web documentation               | Used successfully                                                               | Official OpenAI documentation for instruction/skill discovery                                                        |
| Security checks                 | Existing npm audit tooling; no live product audit performed                     | Focused source review and scoped audits when requested                                                               |
| Docker / Python                 | No Docker command; Python command is a Store alias without a working runtime    | Container execution and the Python skill validator were not run; use existing Node tooling for local manifest checks |

### Next steps

- Begin product implementation only with the next authorized task; current shells are not a working converter or authentication system.
- Fix Context7 credentials and provide Docker separately when needed; neither is required for reading these rules/skills.
- No new plugins, tools, user credentials, or model/permission configuration were installed or changed. Existing development dependency audit notes remain in README.
