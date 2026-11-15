# F08 — Bounded saved-file cursor query

## 1. Implementation and verification

Base: refreshed `origin/main`, `63d01f2afe38679dacbbb177b6ac0e264fbf024b`. Branch: `perf/f08-cursor-bound`, isolated worktree `E:/VSCode Folders/Converter-f08`. The main Converter checkout remains at `b8fc71e` on `ci/complete-actions-pipeline`; its unmerged CI work was not edited or integrated.

### Change and equivalence

The only production change adds an inclusive `createdAt` condition to the cursor boundary in `FilesService.list`. Newest uses `lte`; oldest uses `gte`. The existing strict date/ID OR, ordering, ID tie-break, ownership/lifecycle/search/format filters, page limit and cursor validation remain unchanged. No other production query, API contract, schema, migration, index, advisory lock or quota changed.

For newest, `(t < T) OR (t = T AND id < I)` already implies `t <= T`. AND-ing that inclusive bound is logically redundant but exposes an index range to PostgreSQL. For oldest, the same proof uses `>` and `>=`. At the cursor itself, both strict OR branches remain false: the inclusive bound cannot reintroduce that record. Timestamp storage and cursor precision remain unchanged.

### Before/after benchmark

Actual compiled baseline and updated `FilesService.list` use the same Prisma client, pg pool and immutable synthetic rows. The benchmark captures ORM-emitted parameterized SQL and runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` with the actual parameters. It does not substitute hand-written approximations of the production read.

- PostgreSQL 18.6, Prisma 7.10.1, pg 8.23.1, Node 24.11.1; Windows host to Docker Desktop Linux over loopback TCP.
- Dedicated disposable container: 2 CPU, 1 GiB, tmpfs database storage; no existing database/volume used. Benchmark and regression databases are separate. No regression workload ran during the final benchmark.
- One owner, 100000 saved outputs, 100000 temporary inputs split before/after the outputs' dates. Saved dates have ties of up to ten files per millisecond. PNG/PDF alternate; one-third of names contain literal `Needle%_`.
- Deep midpoint cursor uses an actual saved-file ID/date. Eight cases: newest/oldest × no filter, PNG, literal filename search, PDF plus search. Default page size 20, fetch 21.
- Each variant/case has three repetitions × 40 timed actual service calls: **1920 timed calls**. Variant order rotates between repetitions; both variants are warmed before timing. Every measured page, metadata and nextCursor must equal the baseline, and the cursor ID must be absent.
- Reported latencies are warm synthetic service/ORM round trips, not HTTP/browser or production percentiles. p99 at 120 samples is exploratory. EXPLAIN execution times are individual plan observations, not latency percentiles.

| Sort   | Filters      | Before p50/p95/p99 ms    | After p50/p95/p99 ms |
| ------ | ------------ | ------------------------ | -------------------- |
| newest | none         | 54.57 / 62.26 / 66.83    | 3.39 / 4.31 / 5.15   |
| newest | PNG          | 49.88 / 55.51 / 108.65   | 3.23 / 4.10 / 4.74   |
| newest | search       | 134.40 / 167.86 / 192.48 | 3.42 / 3.92 / 4.67   |
| newest | PDF + search | 31.02 / 33.63 / 35.23    | 3.46 / 3.98 / 4.46   |
| oldest | none         | 55.43 / 62.73 / 65.34    | 3.13 / 3.86 / 4.57   |
| oldest | PNG          | 50.36 / 58.00 / 74.62    | 3.20 / 3.89 / 4.19   |
| oldest | search       | 136.62 / 158.78 / 204.98 | 3.39 / 4.12 / 4.78   |
| oldest | PDF + search | 31.69 / 32.81 / 34.98    | 3.41 / 3.88 / 4.30   |

For unfiltered newest, the original plan uses `File_userId_createdAt_id_idx` with only userId in Index Cond, removing 100000 rows by Filter. The updated plan adds `createdAt <= cursorDate` to Index Cond and removes nine rows. Single-plan execution: 49.899 → 0.335 ms. Oldest adds `>=`, removes 100001 → 2 rows, execution 57.440 → 0.177 ms. Format cases retain `File_userId_format_createdAt_id_idx` and gain the date bound. No index was added or changed. Improvements in this deliberately deep synthetic dataset do not establish an equivalent production-wide percentage.

The first full measurement run completed but its one-shot 200000-row fixture DELETE exceeded the unchanged 10-second statement timeout. Benchmark teardown was changed to owner-scoped batches of 250. The abandoned fixture was removed with the same scoped batches, and a fresh full benchmark then passed including teardown. Only the final run supplies the table; the earlier measurements/log are retained separately for provenance.

### Regression and checks

New `files-cursor.live.ts` adds 11 real-PostgreSQL cases. Existing protected test files are unchanged; the files Jest configuration additionally includes the new suite.

- Complete traversal in both directions, seven records per page, 321 eligible files, timestamp ties spanning pages and adjacent timestamps one millisecond apart. The unfiltered case reaches page 46. IDs match an independent in-memory order/filter oracle with no duplicates, missing eligible files or repeated cursor records.
- PNG filter, literal case-insensitive search containing `%_`, combined PDF/search, and excluded foreign-owner/input/temporary/deleted files.
- Deletion of the cursor record and a future record between pages, both directions: the cursor remains usable, the future deleted record disappears, and surviving unread files occur exactly once. Already-read items are not retroactively removed from prior responses.
- Cursor filter/sort mismatch and malformed cursor rejection; continuation stays owner-scoped. Existing HTTP tests retain anonymous/guest/explicit-key/ownership/CSRF coverage.

| Check                                       | Result                                                       |
| ------------------------------------------- | ------------------------------------------------------------ |
| Database constraint/migration tests         | 15 PASS                                                      |
| Security body-parser regression             | 1 PASS                                                       |
| My Files existing + new cursor regressions  | 20 PASS (9 existing + 11 new)                                |
| Admission/concurrency                       | 10 PASS                                                      |
| Auth / guest / account                      | 10 / 11 / 6 PASS                                             |
| Processing / dependency-failure reliability | 6 / 3 PASS                                                   |
| Offline integration / backend unit          | 17 / 98 PASS                                                 |
| Total application/database tests above      | **197 PASS**                                                 |
| Workspace typecheck                         | PASS                                                         |
| Changed-file ESLint                         | PASS                                                         |
| API TypeScript build                        | PASS                                                         |
| Workspace lint + lint configuration tests   | PASS; 6 configuration tests                                  |
| Prisma schema validation                    | PASS                                                         |
| Contract checker on exact HEAD LF blobs     | PASS; Windows checkout command fails on CRLF-only difference |

Initial workspace typecheck could not resolve a frontend dependency because the new worktree lacked the established apps/web/node_modules junction; adding that local junction allowed the unchanged full command to pass. No dependency/package-lock change was made. The unmodified `npm run contracts:check` command failed because the tracked generated declaration was checked out as CRLF, while the generator emits LF. Running the exact unchanged HEAD checker, OpenAPI and declaration blobs in an isolated LF scratch layout passed; a separate byte-normalization comparison confirms CRLF is the only worktree difference. No contract file, checker, Git configuration or assertion was changed. This Windows checkout limitation remains disclosed; it is not API drift caused by F08. Changed source/config/test/report formatting passed.

The change preserves SQL result sets rather than introducing a new UI flow. Real database service tests plus existing HTTP authorization tests provide direct evidence; browser/E2E and Linux conversion-engine/provider runs were not repeated. Pagination is not a cross-request snapshot: arbitrary concurrent insertions or metadata changes can alter membership under the pre-existing contract. The tested fixed-population and deletion scenarios do not add a stronger snapshot guarantee.

### Reproduction and artifacts

Maintained benchmark: `apps/backend/test/files-cursor.bench.mjs`. Build baseline `63d01f2` with the locked dependencies and Prisma generation, preserve its compiled `files.service.js` as `files.service.before.js` beside the updated compiled service, then build the updated API. The preserved baseline module must reside beside the updated module so relative imports resolve against the identical unchanged infrastructure. Do not replace maintained source to benchmark it.

Create and migrate only a fresh disposable loopback database named `converter_test_f08_bench`. Set `TEST_DATABASE_URL` to that explicit target; the script never loads dotenv or DATABASE_URL. From apps/backend run:

```powershell
node test/files-cursor.bench.mjs dist/api/modules/files/files.service.before.js <report-path>
```

For live regressions use a separate disposable `converter_test_*` database plus isolated loopback Redis via TEST_DATABASE_URL and TEST_REDIS_URL. Run the existing npm database, security, files, conversions, auth, guest, account, processing, reliability and integration scripts; backend unit, workspace typecheck/lint, Prisma validation and contract checks use the existing tooling. Keep benchmarks separate from check workloads.

Raw final benchmark, ORM SQL/plans, baseline compiled module, logs, check results and cleanup manifests are preserved under `E:/VSCode Folders/Converter-artifacts/f08-implementation-20261114`. Earlier F08 admission/count/search analysis remains under `Converter-artifacts/f08-20261114`; its initial 93.34 → 2.74 ms SQL experiment used a different dataset/query harness and must not be pooled with this service benchmark.

Context7 consulted for current Prisma filter/parameterization and Windows read-only handle APIs. Sources: [Prisma 7.10.1 query filters](https://github.com/prisma/orm/blob/7.10.1/README.md), [PostgreSQL 18 EXPLAIN](https://www.postgresql.org/docs/18/using-explain.html). No lock, quota, connection-pool or substring-index optimization is included. The earlier admission-serialization and sparse-substring scaling findings remain separate follow-ups.

## 2. Workspace cleanup

No complete worktree or branch was deleted. Converter, Converter-artifacts and Converter-release-gate remain preserved. No push, PR, merge, deployment or history rewrite was performed.

292 files (22111334 bytes) of task-owned benchmark/security evidence were copied from f01-avif, f02, f04/f04-pr and release-gate task directories to the designated artifact directory. A SHA-256 manifest verifies byte-identical copies; no files were skipped by the credential/key/config screening. Originals remain intact. Existing f03/f05 and f06/f07 reports/artifact directories remain preserved; shared main .cache targets were not duplicated or removed. These metadata checks are not a general secret-audit certification.

The seven older merged task branches are ancestors of current origin/main; GitHub confirms PRs #1, #2 and #4–#8 merged. Release-gate PR #3 is still open, and its branch has a unique commit. Main has 13 commits absent from main's remote target; these are retained. The F08 branch contains the new focused implementation and must also remain.

Read-only handle enumeration used a positive control (an intentionally open candidate AGENTS.md). In the recorded snapshot, 114899 handles were enumerated, 49058 duplicated, and 2788 disk handles examined. No direct file/directory handles in the seven old worktree roots were observed; accessible application handles reference main and F08. The editor watches shared main .git/worktrees metadata, which is not treated as an active old-worktree build. Protected/system processes could not all be inspected; 16622 duplications failed and four disk paths could not be resolved. This is bounded point-in-time evidence, not a guarantee against all protected OS handles or future activity. No processes were stopped to make a candidate appear idle.

The final artifact inventory records clean status, merge reachability, ignored/untracked paths, exclusive sizes, shared junctions and Docker mount dependencies. No existing Docker container binds one of the seven candidate worktrees. Candidate removal remains approval-gated and requires an immediate fresh safety check. Shared node_modules/browser/.cache junction targets must survive any later Git-managed removal; do not recursively delete through them.

Conditional worktree removal list for separate explicit approval:

1. `E:/VSCode Folders/Converter-ci-database` — `ci/fix-disposable-database-name`.
2. `E:/VSCode Folders/Converter-f01-avif` — `perf/f01-avif`.
3. `E:/VSCode Folders/Converter-f02` — `feat/f02-network-compression`.
4. `E:/VSCode Folders/Converter-f03-f05` — `perf/f03-f05`.
5. `E:/VSCode Folders/Converter-f04` — `perf/f04-document-validation`.
6. `E:/VSCode Folders/Converter-f06-f07` — `perf/f06-f07`.
7. `E:/VSCode Folders/Converter-sandbox-dispatch-stub` — `ci/sandbox-dispatch-stub`.

Use only `git worktree remove` without force after approval and revalidation. Branch deletion is a separate action requiring explicit approval, even when fully merged. Do not remove Converter-release-gate, main, artifacts or F08. No historical disk space has been reclaimed: **0 bytes**. Evidence archiving intentionally adds approximately 21.09 MiB. F08-owned disposable containers can be torn down after preserving results; historical images/containers/volumes/build caches remain untouched.

Future tasks should use a dedicated branch and create a worktree only when concurrent isolation is necessary, keep evidence in Converter-artifacts, reuse dependencies without duplicating them, and request cleanup after verified merge and artifact/process checks. No global instructions were changed.
