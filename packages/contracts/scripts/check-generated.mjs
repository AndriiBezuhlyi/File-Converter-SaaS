import { readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const generated = new URL('../src/generated/api.d.ts', import.meta.url);
const candidate = new URL('../src/generated/api.check.d.ts', import.meta.url);
const cli = fileURLToPath(
  new URL('../../../node_modules/openapi-typescript/bin/cli.js', import.meta.url),
);
try {
  execFileSync(process.execPath, [cli, 'openapi.json', '-o', fileURLToPath(candidate)], {
    stdio: 'inherit',
  });
  if ((await readFile(generated, 'utf8')) !== (await readFile(candidate, 'utf8'))) {
    throw new Error('Contract types are outdated. Run npm run contracts:generate.');
  }
} finally {
  await rm(candidate, { force: true });
}
