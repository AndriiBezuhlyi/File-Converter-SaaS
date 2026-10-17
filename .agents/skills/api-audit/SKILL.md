---
name: api-audit
description: Audit this File Converter project's REST API contracts, access control, and conversion lifecycle, producing a sanitized Markdown report. Use for an API audit or contract/security review, not ordinary feature implementation.
---

# API Audit

Read [AGENTS.md](../../../AGENTS.md), the mandatory rules it names, and its backend, api-state, file-conversion, and verification topics. Repository paths below are relative to the project root.

## Preconditions and scope

Inspect `packages/contracts/openapi.json`, actual controllers/tests, the technical task's API contract, and the architecture's ownership/guest policy. Inspect npm scripts before running them. Establish the authorized target and available test identities without printing credentials.

The current foundation has empty OpenAPI paths and no product endpoints. If those remain absent, report implementation coverage as BLOCKED, distinguish planned contract review from runtime verification, and do not call placeholder endpoints or implement the API to make an audit pass.

## Procedure

1. Compare implemented operations with the documented contract and generated types: methods/paths, multipart fields, acceptance response, DTO validation, content types, error envelope, and status codes. Separate documented proposals from implemented operations.
2. When a real authorized test target exists, use isolated synthetic records and bounded requests/timeouts. Check missing/invalid/revoked API keys, key rotation when within the test scope, ownership isolation, guest capability restrictions, and CSRF on cookie mutations. Do not use arbitrary external hosts or production mutations.
3. Check the conversion lifecycle: `202` then polling, four job states, accepted-job failures versus HTTP errors, not-ready/expired downloads, saved-file visibility, and deletion denial on every download route.
4. Include one free guest success, consumed-trial login requirement, parallel guest submissions, terminal-failure quota release, retained result access, and continued API-key requirements for integrations. Account/API/guest boundaries must not silently fall back after an invalid explicit key.
5. Use existing relevant tests and `npm run contracts:check` where applicable. Record what was actually executed, its outcome, and what could not be verified. Bootstrap 404 responses and empty contracts are not evidence of product functionality.
6. Write a new Markdown report in `reports/api-audit/`, with a unique `api-audit-YYYY-MM-DD-HHmmss.md` name using Europe/Paris time. Create the output directory when needed; never overwrite a prior report.

## Safety

Keep keys/cookies in memory or authorized secret storage, never URLs, screenshots, traces, command text, or reports. Do not follow credential-bearing redirects to another origin. Reuse scoped fixtures; creation/deletion is allowed only within the user's authorized test scope. Never rotate existing user keys or delete non-test data as an audit shortcut. No new dependencies, scripts, or API implementation are implied.

## Report and handoff

Include scope and sanitized target, contract/source revision when available, checks with PASS/FAIL/BLOCKED/SKIPPED and evidence, prioritized findings with expected/actual behavior and recommendations, commands actually run, and limitations/cleanup.

Do not dump headers, raw responses, personal filenames, or file contents. Identify minimal sanitized field-level evidence. Report unsupported coverage honestly; no invented findings or passes. Summarize the report path and significant issues in Ukrainian. A report-only audit does not require a progress entry unless it changes project state beyond the report.
