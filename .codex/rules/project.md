# Product Scope

Reference: [technical task](../../docs/technical-task.md), for the behavior being changed.

- MVP: JPG ↔ PNG and DOCX → PDF, one file up to 20 MB.
- One successful free guest conversion; subsequent conversions require login/registration. Validation/terminal failures do not consume the trial; concurrent requests cannot reserve two jobs.
- Guest results expire one hour after completion. Login does not automatically save or transfer them.
- PDF → DOCX, Telegram login, billing, batch upload, and additional formats are outside the MVP.
- Current state: responsive React shell with routing/shared UI, local file/target selection, and pre-launch API docs; API bootstrap, idle worker, no domain models/converters/product endpoints, empty OpenAPI paths. Check actual code as implementation progresses; local selection/docs do not prove live API or conversion support.
- Do not repeat initialization or expand feature/dependency scope during unrelated work or audits.
