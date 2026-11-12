import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { test } from 'node:test';

test('Nest body parsers survive malformed compressed bodies and remain usable', async () => {
  // Both the server and adversarial loopback requests live only in this child.
  const child = fork(new URL('./fixtures/body-parser-child.mjs', import.meta.url), [], {
    env: {
      NODE_ENV: 'test',
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    },
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
    timeout: 15_000,
    killSignal: 'SIGKILL',
  });
  let verified = false;
  child.on('message', (message) => {
    if (message === 'parser-regression-passed') verified = true;
  });
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0 && signal === null && verified) resolve();
        else reject(new Error(`Parser subprocess failed (exit=${code}, signal=${signal}).`));
      });
    });
    assert.equal(verified, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});
