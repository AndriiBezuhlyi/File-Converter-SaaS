---
name: conversion-test
description: Verify this File Converter project's JPG/PNG and DOCX/PDF conversion workflows, resource failures, and result retention using isolated fixtures, then write a sanitized Markdown report. Use for conversion testing or reliability review, not implementation.
---

# Conversion Test

Follow [AGENTS.md](../../../AGENTS.md). For these tests, read [security](../../../.codex/rules/security.md), [file-conversion](../../../.codex/rules/file-conversion.md), and [verification](../../../.codex/rules/verification.md); add backend/API rules when those boundaries are tested. Repository paths below are relative to the project root.

## Preconditions and scope

Inspect actual converter adapters, worker registration, tests, infrastructure, and fixture availability against the technical task and architecture. Verify the authorized environment and identities; inspect existing scripts before execution.

The foundation currently has an idle worker, no converters/queue consumers, and no product endpoints. If still absent, mark end-to-end conversion verification BLOCKED. Installing Sharp/LibreOffice or passing bootstrap tests is not a successful conversion-engine test. Do not add product functionality or fictitious executable helpers to complete the report.

## Procedure

1. Use owned synthetic fixtures for JPG to PNG, PNG to JPG, and DOCX to PDF. Do not imply PDF to DOCX or batch support. Inspect output type/readability and relevant dimensions, orientation/transparency, metadata, and document/font behavior; lossy conversions are not byte-equality checks.
2. Exercise bounded invalid, mismatched-extension/content, corrupt, and over-limit inputs, deriving exact limits from current server configuration/contract. Do not create destructive decompression bombs or unbounded stress payloads.
3. Verify queue/processing/completed/failed transitions, task deadlines, resource isolation, terminal versus transient failures, bounded retries, duplicate delivery, and worker-crash recovery. Assert one published result and no accidental reservation release during retries.
4. Cover guest eligibility and parallel submissions, failure quota restoration, account auto-save snapshots, one-hour temporary expiry, authenticated/guest owner-only access, deletion denial, and cleanup/orphan reconciliation. Use controlled clocks/configuration where available rather than waiting an hour.
5. Prefer existing focused unit/integration/E2E commands and disposable dependencies. Measure performance only in a documented environment and separate queue wait, upload, and processing; do not generalize the specification's benchmark into a universal claim.
6. Clean only artifacts created by this test scope. Write a new Markdown report under `reports/conversion-tests/`, uniquely named `conversion-test-YYYY-MM-DD-HHmmss.md` using Europe/Paris time. Create the directory as needed; preserve previous reports.

## Safety

Follow the upload/sandbox requirements in the source documents. No macros, inherited secrets, unrestricted converter network access, shell interpolation, global bucket cleanup, or production/user-file deletion. Use isolated temporary directories and test object prefixes. Do not save real documents, credentials, raw engine output, or sensitive traces in reports. No tool installation or infrastructure reconfiguration is authorized by merely invoking this skill.

## Report and handoff

Include scope/environment, synthetic fixture identifiers and directions, a PASS/FAIL/BLOCKED/SKIPPED matrix with evidence, failure/resource/access/retention coverage, commands and timings actually observed, findings and recommendations, cleanup status, and unavailable coverage.

Report only observed outcomes. Distinguish mocked/offline checks, real engine execution, and complete application flows; do not label one as another. Summarize the report path and limitations in Ukrainian. Update project progress only if work also changes maintained code, configuration, or documentation.
