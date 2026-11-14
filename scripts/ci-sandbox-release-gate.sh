#!/usr/bin/env bash
# Mandatory manual release verification; never loads or modifies host policies.
set -euo pipefail

cd "$(dirname "$0")/.."
test "$(uname -s)" = Linux
: "${RELEASE_SHA:?Set the full reviewed release commit SHA}"
: "${RELEASE_ENVIRONMENT_ID:?Set the approved disposable environment review identifier}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$RELEASE_ENVIRONMENT_ID" =~ ^[A-Za-z0-9._-]{1,100}$ ]]
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
checkout_status=$(git status --porcelain)
test -z "$checkout_status"
test ! -e .env
test "$(stat -fc %T /sys/fs/cgroup)" = cgroup2fs
test "$(cat /sys/module/apparmor/parameters/enabled)" = Y
docker info --format '{{json .SecurityOptions}}' | grep -q 'name=apparmor'

mkdir -p .cache/tasks/ci-sandbox-release
evidence=$(mktemp -d "$PWD/.cache/tasks/ci-sandbox-release/${RELEASE_SHA:0:12}-XXXXXXXX")
name="flux-sandbox-release-$(basename "$evidence")"
cleanup() {
  local ids remaining
  ids=$(docker ps -aq --filter "name=^/${name}$") || return 1
  if test -n "$ids"; then
    docker rm -f "$ids" >/dev/null || return 1
  fi
  remaining=$(docker ps -aq --filter "name=^/${name}$") || return 1
  test -z "$remaining"
}
trap cleanup EXIT
printf '%s\n' "$RELEASE_SHA" > "$evidence/commit.sha"
printf '%s\n' "$RELEASE_ENVIRONMENT_ID" > "$evidence/environment-review.txt"
uname -a > "$evidence/kernel.txt"
docker version > "$evidence/docker-version.txt"
sha256sum infra/security/worker-seccomp.json apps/backend/test/{conversion-engine,engine-crash}.linux.mjs > "$evidence/source.sha256"

# No credentials, host services, caches, uploaded data or experimental profile.
docker build --iidfile "$evidence/image.id" -f infra/docker/worker.Dockerfile . 2>&1 | tee "$evidence/build.log"
image=$(cat "$evidence/image.id")
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]]
docker image inspect "$image" > "$evidence/image.json"
args=(--name "$name" --init --read-only --network none
  --cpus 1 --memory 1g --pids-limit 128 --cap-drop ALL
  --security-opt no-new-privileges:true
  --security-opt "seccomp=$PWD/infra/security/worker-seccomp.json"
  --security-opt apparmor=docker-default
  --tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777
  --mount "type=bind,source=$PWD/apps/backend/test,target=/app/apps/backend/test,readonly")

timeout --kill-after=10s 30s docker run "${args[@]}" "$image" node -e '
  const assert=require("node:assert/strict"), fs=require("node:fs");
  const status=fs.readFileSync("/proc/self/status","utf8");
  assert.equal(process.getuid(),1000);
  assert.equal(fs.readFileSync("/proc/self/attr/current","utf8").trim(),"docker-default (enforce)");
  for(const field of ["CapInh","CapPrm","CapEff","CapBnd","CapAmb"])
    assert.match(status,new RegExp("^"+field+":[ "+String.fromCharCode(9)+"]+0+$","m"));
  assert.match(status,/^NoNewPrivs:\s+1$/m);
  assert.match(status,/^Seccomp:\s+2$/m);
  assert.equal(fs.readFileSync("/sys/fs/cgroup/memory.max","utf8").trim(),"1073741824");
  assert.equal(fs.readFileSync("/sys/fs/cgroup/pids.max","utf8").trim(),"128");
  const [quota,period]=fs.readFileSync("/sys/fs/cgroup/cpu.max","utf8").trim().split(/\s+/).map(Number);
  assert.equal(quota/period,1);
  assert.throws(()=>fs.writeFileSync("/escape","synthetic"));
  assert.ok(!fs.existsSync("/sys/class/net/eth0"));
  console.log("PASS: release container security prerequisites");
' 2>&1 | tee "$evidence/security.log"
cleanup

timeout --kill-after=10s 300s docker run "${args[@]}" "$image" \
  node --test --test-reporter=tap --test-concurrency=1 \
  test/conversion-engine.linux.mjs test/engine-crash.linux.mjs \
  2>&1 | tee "$evidence/tests.tap"
for summary in '# tests 4' '# pass 4' '# fail 0' '# cancelled 0' '# skipped 0' '# todo 0'; do
  test "$(grep -Fxc "$summary" "$evidence/tests.tap")" = 1
done
cleanup
trap - EXIT
# Receipt exists only after real tests, exact TAP totals and cleanup all succeed.
printf 'PASS\ncommit=%s\nimage=%s\nenvironment=%s\n' \
  "$RELEASE_SHA" "$image" "$RELEASE_ENVIRONMENT_ID" > "$evidence/PASSED"
printf 'Sandbox gate passed for this commit/image/environment only: %s\n' "$evidence"
