# Mandatory sandbox release gate

**Release status: BLOCKED. The mandatory sandbox gate has not passed in a qualified production-representative environment.** Ordinary CI success, image builds, local Docker Desktop results and failed experiments cannot authorize deployment. No further hosted AppArmor experiments are authorized. The manual experiment files remain preserved for investigation, not for normal CI or releases.

## Mandatory sandbox release gate

Before any release, a release owner must approve a dedicated disposable Linux VM matching the target production kernel, Docker/runtime, cgroup v2, user-namespace restrictions and enforcing LSM policy. Current Compose uses Docker's default AppArmor profile; the gate requires `docker-default (enforce)` and the production worker seccomp file. No suitable passing environment has been established. If this combination cannot run bubblewrap safely, release remains blocked until a separately reviewed security solution and real test evidence exist. Do not disable AppArmor or choose a weaker host merely to obtain a pass.

Use only a reviewed commit, an empty clean checkout, synthetic fixtures and public dependency downloads. No production credentials, databases, storage, unrelated host mounts, uploaded documents or untrusted PRs. The gate builds the unchanged production worker Dockerfile and tests that exact immutable image ID. Environment approval must record kernel/Docker versions, active policy versions or hashes, user-namespace settings and the comparison with production; an environment identifier alone is not proof of equivalence.

On that already approved VM, from the repository root:

```bash
export RELEASE_SHA="<full-40-character-reviewed-release-commit>"
export RELEASE_ENVIRONMENT_ID="<approved-environment-review-id>"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
bash scripts/ci-sandbox-release-gate.sh
```

The script never changes or loads host policies. It keeps the image ENTRYPOINT, `--init`, read-only rootfs, no network, all capabilities dropped, NoNewPrivs, production seccomp, 1 CPU/1 GiB RAM/128 PIDs and bounded staging tmpfs. A container prerequisite check verifies enforcement and resource settings. It then runs these **unchanged original files**, serially, with the TAP reporter:

```bash
node --test --test-reporter=tap --test-concurrency=1 \
  test/conversion-engine.linux.mjs test/engine-crash.linux.mjs
```

These four tests cover real JPG/PNG/DOCX conversion and malformed input, credential/filesystem/network isolation and resource bounds, wall-clock process-tree termination, and crash/orphan cleanup. Require process exit zero and exactly `tests 4`, `pass 4`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`. Missing runtime/dependencies, prerequisite failure, timeout, skipped/blocked tests, absent evidence or failed cleanup all block release. No fallback, automatic retry, test modification or experimental profile is permitted.

Only after actual execution, exact TAP totals and successful container cleanup does the script write `.cache/tasks/ci-sandbox-release/<unique-run>/PASSED`. Retain the entire evidence directory: reviewed source SHA, source/seccomp checksums, image ID/metadata, environment review ID, kernel/Docker versions, build/security logs and TAP. The release owner must verify the receipt, complete logs and approved environment review belong to the exact commit/image being released; stale, copied or manually authored receipts do not satisfy the gate. Destroy the disposable VM afterward, retain the evidence in the controlled release record, and record VM teardown confirmation. Do not delete unrelated resources or local volumes.

**Deployment rule:** stop before any migration/publish/deploy command unless ordinary required CI and this sandbox gate both have valid evidence and explicit release approval. No automated deployment workflow currently exists, so this is a mandatory operator procedure, not a claim of platform-enforced deployment protection. Any future deployment automation must require a verified matching gate result and fail on every other state; implementing that integration needs separate approval. The four-test gate does not replace full 26-direction acceptance, real-provider checks or other release prerequisites.

## Hosted results and remaining gaps

| Run                                                                                           | Reviewed SHA                               | Observed result                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [43593004971](https://github.com/AndriiBezuhlyi/File-Converter-SaaS/actions/runs/43593004971) | `0ff984c6d1301d83f393a799d7fd4ffd6bc7f44d` | FAIL before probes: tini could not exec the image's docker-entrypoint.sh, exit 126. The candidate lacks execute permission for that wrapper. No matching kernel audit record was collected.                   |
| [43594083270](https://github.com/AndriiBezuhlyi/File-Converter-SaaS/actions/runs/43594083270) | `b484ee3dc42055d317a976e65ca51e4c38226514` | Empty experiment-only ENTRYPOINT allowed Node/bwrap to start. Outer security assertions passed, then peer setup failed mounting proc on /newroot/proc with EPERM. Exact kernel/LSM cause remains unconfirmed. |

Both runs used Ubuntu 24.04, exact reviewed commits, synthetic fixtures and the unchanged profile SHA-256 `928cc9e35fd24192dea3920afc974bdcf98789a9d974a22bbb5babafc01eb79c`. Profile parsing/loading in enforcing mode succeeded. Both docker-default controls and host root/mount-namespace invariants passed; owned container/profile cleanup and job cleanup succeeded. GitHub's disposable VM lifecycle is the final boundary, not an independently obtained physical destruction receipt. Neither run completed per-attempt probes or any of the four original tests. Successful outer checks do not prove proc mounts, namespace escape resistance, conversion behavior, deadline/crash behavior or production compatibility.

Native Actions logs remain at the linked runs, subject to GitHub retention. Downloaded full logs are preserved in the original investigation worktree (Converter on ci/complete-actions-pipeline), in ignored `.cache/tasks/ci-linux-sandbox/experiment-43593004971.log` and `experiment-43594083270.log`; they are not committed or published. Preserve copies in a controlled evidence store before Actions retention expires. No retention guarantee beyond the existing local copies is claimed.

The existing main CI workflow remains unchanged and continues to run its quality, database and image-build checks. Those checks do not execute this manual release gate or prove sandbox compatibility. This PR does not import the comprehensive CI branch or its experimental workflow/profile. Archive configuration remains on the investigation branch; the two linked failed runs are historical evidence only.
