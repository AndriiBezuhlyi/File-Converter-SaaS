import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, readlinkSync } from 'node:fs';

assert.equal(process.platform, 'linux', 'Only the approved disposable Linux VM is supported.');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
assert.equal(process.env.LOAD_APPROVED, 'true');
assert.equal(process.env.REVIEWED_SHA, process.env.GITHUB_SHA);
assert.match(process.env.REVIEWED_SHA ?? '', /^[0-9a-f]{40}$/);
assert.match(process.env.GITHUB_RUN_ID ?? '', /^\d+$/);
assert.match(process.env.GITHUB_RUN_ATTEMPT ?? '', /^\d+$/);
const mode = process.argv[2];
assert.ok(['control', 'verify'].includes(mode));
const label = `flux.sandbox-experiment=${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const hostMountNamespace = readlinkSync('/proc/self/ns/mnt');
const hostRootMount = () =>
  readFileSync('/proc/self/mountinfo', 'utf8')
    .split('\n')
    .find((line) => line.split(' ')[4] === '/');
const originalRootMount = hostRootMount();
assert.ok(originalRootMount);
const args = [
  'run',
  '--rm',
  '--init',
  '--read-only',
  '--network',
  'none',
  '--cpus',
  '1',
  '--memory',
  '1g',
  '--pids-limit',
  '128',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges:true',
  '--security-opt',
  `seccomp=${resolve('infra/security/worker-seccomp.json')}`,
  '--security-opt',
  `apparmor=${mode === 'control' ? 'docker-default' : 'flux-ci-bwrap-review'}`,
  '--tmpfs',
  '/tmp:rw,nosuid,nodev,size=256m,mode=1777',
  '--label',
  label,
  '--env',
  `EXPECTED_HOST_MOUNT_NS=${hostMountNamespace}`,
  '--mount',
  `type=bind,source=${resolve('apps/backend/test')},target=/app/apps/backend/test,readonly`,
  '--mount',
  `type=bind,source=${resolve('infra/ci-sandbox-review/runtime-probes.mjs')},target=/app/apps/backend/runtime-probes.mjs,readonly`,
  'flux-ci-worker:experiment',
];
function run(command, timeout) {
  const result = spawnSync('docker', [...args, ...command], {
    encoding: 'utf8',
    timeout,
    maxBuffer: 2_000_000,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  return result;
}
if (mode === 'control') {
  const result = run(
    [
      'bwrap',
      '--unshare-all',
      '--die-with-parent',
      '--cap-drop',
      'ALL',
      '--ro-bind',
      '/',
      '/',
      '/bin/true',
    ],
    15_000,
  );
  assert.notEqual(result.status, 0, 'Default-profile mount must remain denied.');
  assert.match(result.stderr, /Failed to make \/ slave: Permission denied/);
  console.log('PASS: docker-default still denies the control mount.');
} else {
  assert.equal(
    run(['node', 'runtime-probes.mjs'], 60_000).status,
    0,
    'Isolation probes failed. Stop; do not widen policy.',
  );
  const result = run(
    [
      'node',
      '--test',
      '--test-reporter=tap',
      '--test-concurrency=1',
      'test/conversion-engine.linux.mjs',
      'test/engine-crash.linux.mjs',
    ],
    120_000,
  );
  assert.equal(result.status, 0, 'Original tests failed. Stop; do not widen policy.');
  for (const line of ['# tests 4', '# pass 4', '# fail 0', '# skipped 0']) {
    assert.ok(result.stdout.split(/\r?\n/).includes(line), `Missing required TAP result: ${line}`);
  }
  console.log('PASS: all four unchanged original tests passed without skips.');
}
assert.equal(readlinkSync('/proc/self/ns/mnt'), hostMountNamespace);
assert.equal(hostRootMount(), originalRootMount, 'Host root mount changed during the experiment.');
console.log('PASS: controller mount namespace and host root mount are unchanged.');
