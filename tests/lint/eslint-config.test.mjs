import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../..', import.meta.url)) });
const shared = 'apps/web/src/shared/ui/Surface.tsx';
const feature = 'apps/web/src/features/converter/lib/file-selection.ts';
const page = 'apps/web/src/pages/api-docs/api-reference.ts';
const backend = 'apps/backend/src/worker.module.ts';
const contracts = 'packages/contracts/src/index.ts';

async function lint(code, filePath = shared) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.ok(result);
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result.messages;
}

test('typed linting catches unhandled promises, async conditions, and unsafe JSON', async () => {
  const cases = [
    [
      'export function submit() { Promise.resolve(42); }',
      '@typescript-eslint/no-floating-promises',
    ],
    [
      'export function ready() { if (Promise.resolve(true)) return 1; return 0; }',
      '@typescript-eslint/no-misused-promises',
    ],
    ["export const name = JSON.parse('{}').name;", '@typescript-eslint/no-unsafe-member-access'],
  ];
  for (const [code, rule] of cases) {
    assert.ok(
      (await lint(code)).some((message) => message.ruleId === rule),
      rule,
    );
  }
  assert.deepEqual(await lint('export async function submit() { await Promise.resolve(); }'), []);
});

test('static imports and re-exports respect workspace and frontend layer boundaries', async () => {
  const cases = [
    [shared, "import '@prisma/client';"],
    [feature, "import '@converter/backend';"],
    [page, "import '../../../../backend/src/worker.module.js';"],
    [shared, "import 'node:fs';"],
    [page, "import 'fs/promises';"],
    [feature, "import '@nestjs/common';"],
    [shared, "export { FileSelector } from '../../features/converter/components/FileSelector';"],
    [shared, "import '../../app/routes';"],
    [shared, "import '../../pages/api-docs/api-reference';"],
    [feature, "import '../../../app/routes';"],
    [feature, "import '../../../pages/api-docs/api-reference';"],
    [page, "import '../../app/routes';"],
    [backend, "import '../../web/src/app/routes.js';"],
    [contracts, "import '../../../apps/backend/src/worker.module.js';"],
    [contracts, "import '@converter/web';"],
    [contracts, "import '@prisma/client';"],
    [contracts, "import 'node:fs';"],
  ];
  for (const [filePath, code] of cases) {
    assert.ok(
      (await lint(code, filePath)).some((message) => message.ruleId === 'no-restricted-imports'),
      `${filePath}: ${code}`,
    );
  }
});

test('allowed downward imports, contract types, and backend Node APIs stay valid', async () => {
  for (const [filePath, code] of [
    [shared, "import './Surface.module.scss';"],
    [feature, "import '../../../shared/ui/Surface';"],
    [page, "import '../../features/converter/components/FileSelector';"],
    [shared, "export type { paths } from '@converter/contracts';"],
    [contracts, "export type { paths } from './generated/api.js';"],
    [backend, "import 'node:fs';"],
  ]) {
    assert.deepEqual(await lint(code, filePath), [], `${filePath}: ${code}`);
  }
});

test('frontend type imports and Node globals are checked without changing Nest DI metadata', async () => {
  assert.ok(
    (await lint("import { MouseEvent } from 'react'; export type Click = MouseEvent;")).some(
      (message) => message.ruleId === '@typescript-eslint/consistent-type-imports',
    ),
  );
  assert.ok(
    (await lint('export const env = process.env;')).some(
      (message) => message.ruleId === 'no-restricted-globals',
    ),
  );
  assert.deepEqual(
    await lint(
      "import { Injectable } from '@nestjs/common'; import { ConfigService } from '@nestjs/config'; @Injectable() export class Service { constructor(readonly config: ConfigService) {} }",
      backend,
    ),
    [],
  );
});

test('E2E browser callbacks have DOM types and JavaScript tooling does not need a TS project', async () => {
  assert.deepEqual(
    await lint(
      'export const transfer = new DataTransfer(); export const viewport = document.documentElement.clientWidth;',
      'tests/e2e/api-docs.spec.ts',
    ),
    [],
  );
  assert.deepEqual(
    await lint('export const runtime = process.version;', 'scripts/dev-backend.mjs'),
    [],
  );
  assert.deepEqual(await lint('module.exports = {};', 'apps/backend/jest.config.cjs'), []);
});

test('generated contracts remain ignored and unused suppressions are errors', async () => {
  assert.equal(await eslint.isPathIgnored('packages/contracts/src/generated/api.d.ts'), true);
  const messages = await lint('// eslint-disable-next-line no-debugger\nexport const value = 1;');
  assert.ok(
    messages.some(
      (message) => message.severity === 2 && /Unused eslint-disable/.test(message.message),
    ),
  );
});
