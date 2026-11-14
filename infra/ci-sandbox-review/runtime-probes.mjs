// Additional synthetic probes; the four existing sandbox tests remain unchanged.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readlinkSync,
  statfsSync,
  rmSync,
} from 'node:fs';
import { sandboxArguments } from './dist/worker/modules/conversions/conversion-engine.js';

const profile = 'flux-ci-bwrap-review (enforce)';
const version = spawnSync('/usr/bin/bwrap', ['--version'], { encoding: 'utf8' });
assert.ifError(version.error);
assert.equal(version.status, 0);
assert.match(version.stdout, /^bubblewrap 0\.8\.0\s/);
console.log(`Runtime: Node ${process.version}; ${version.stdout.trim()}`);
const status = readFileSync('/proc/self/status', 'utf8');
assert.equal(process.getuid(), 1000);
assert.equal(readFileSync('/proc/self/attr/current', 'utf8').trim(), profile);
for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
  assert.match(status, new RegExp(`^${field}:\\s+0+$`, 'm'));
}
assert.match(status, /^NoNewPrivs:\s+1$/m);
assert.match(status, /^Seccomp:\s+2$/m);
assert.equal(readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim(), '1073741824');
assert.equal(readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim(), '128');
const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8')
  .trim()
  .split(/\s+/)
  .map(Number);
assert.equal(quota / period, 1);
const scratch = statfsSync('/tmp');
assert.ok(scratch.bsize * scratch.blocks <= 268435456);
const namespaces = Object.fromEntries(
  ['user', 'mnt', 'pid', 'net', 'ipc', 'uts'].map((name) => [
    name,
    readlinkSync(`/proc/self/ns/${name}`),
  ]),
);
const directory = mkdtempSync('/tmp/flux-probe-');
const input = `${directory}/input`;
writeFileSync(input, 'owned synthetic isolation input');
function probe(code) {
  const args = sandboxArguments(input, 'jpg', 'png');
  args.splice(-3, 3, '-e', code);
  const result = spawnSync('/usr/bin/prlimit', args, {
    env: { SYNTHETIC_SERVICE_SECRET: 'owned-probe-sentinel' },
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1_000_000,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Probe failed. Stop; do not widen policy.');
}
try {
  probe(`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const net = require('node:net');
    const outer = ${JSON.stringify(namespaces)};
    for (const [name, id] of Object.entries(outer)) {
      assert.notEqual(fs.readlinkSync('/proc/self/ns/' + name), id);
    }
    assert.equal(fs.readFileSync('/proc/self/attr/current', 'utf8').trim(), ${JSON.stringify(profile)});
    const state = fs.readFileSync('/proc/self/status', 'utf8');
    for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
      assert.match(state, new RegExp('^' + field + ':\\\\s+0+$', 'm'));
    }
    assert.match(state, /^NoNewPrivs:\\s+1$/m);
    assert.match(state, /^Seccomp:\\s+2$/m);
    const uidMap = fs.readFileSync('/proc/self/uid_map', 'utf8').trim().split(/\\s+/).map(Number);
    assert.equal(uidMap.length, 3);
    assert.equal(uidMap[2], 1);
    assert.equal(process.env.SYNTHETIC_SERVICE_SECRET, undefined);
    assert.equal(fs.existsSync(${JSON.stringify(directory)}), false);
    assert.equal(fs.existsSync('/app/apps/backend'), false);
    assert.equal(fs.readFileSync('/input', 'utf8'), 'owned synthetic isolation input');
    fs.writeFileSync('/work/positive', 'synthetic');
    for (const path of ['/escape', '/dev/escape', '/usr/escape', '/input']) {
      assert.throws(() => fs.writeFileSync(path, 'synthetic'));
    }
    assert.ok(fs.readFileSync('/proc/self/net/route', 'utf8').trim().split('\\n').length <= 1);
    const work = fs.statfsSync('/work');
    assert.ok(work.bsize * work.blocks <= 134217728);
    const socket = net.connect({host: '192.0.2.1', port: 9});
    socket.setTimeout(2000, () => { socket.destroy(); process.exitCode = 1; });
    socket.on('connect', () => { socket.destroy(); process.exitCode = 1; });
    socket.on('error', (error) => {
      assert.ok(['EACCES', 'EPERM', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error.code));
      console.log('PASS: positive namespace/filesystem and negative credential/write/network probes.');
    });
  `);
  probe(`
    const assert = require('node:assert/strict');
    const {spawnSync} = require('node:child_process');
    // A new nested namespace obtains namespace-local mount capabilities.
    // The marker distinguishes a mount denial from an earlier unshare failure.
    const result = spawnSync('/usr/bin/unshare', [
      '--user', '--map-root-user', '--mount', '--propagation', 'unchanged', '/usr/bin/sh', '-ec',
      'printf "namespace-ready\\n"; /usr/bin/mount -t tmpfs tmpfs /work'
    ], {encoding: 'utf8', timeout: 5000});
    assert.ifError(result.error);
    assert.match(result.stdout, /namespace-ready/);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /permission denied|not permitted/i);
    console.log('PASS: mount outside the approved staging paths is denied after namespace setup.');
  `);
  // ADDR_NO_RANDOMIZE (0x40000) is absent from the seccomp personality allowlist.
  // AppArmor permits executing setarch, so failure cannot be an exec denial.
  probe(`
    const assert = require('node:assert/strict');
    const {spawnSync} = require('node:child_process');
    const result = spawnSync('/usr/bin/setarch', ['linux64', '-R', '/usr/local/bin/node', '--version'],
      {encoding: 'utf8', timeout: 5000});
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /permission denied|not permitted/i);
    console.log('PASS: seccomp denies ADDR_NO_RANDOMIZE personality change.');
  `);
  console.log('PASS: outer security settings and isolated runtime probes.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
