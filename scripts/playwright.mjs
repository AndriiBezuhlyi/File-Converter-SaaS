import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const browsers = fileURLToPath(new URL('../.cache/ms-playwright', import.meta.url));
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
