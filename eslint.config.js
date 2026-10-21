import js from '@eslint/js';
import { builtinModules } from 'node:module';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

const typescriptFiles = ['**/*.{ts,tsx}'];
const webFiles = ['apps/web/src/**/*.{ts,tsx}'];
const nodeImports = {
  group: ['node:*', ...builtinModules],
  message: 'Keep Node.js APIs in the backend or tooling, outside portable browser/contracts code.',
};
const serverImports = {
  group: [
    '@converter/backend',
    '@converter/backend/**',
    '**/backend/**',
    '@nestjs/**',
    '@prisma/**',
    'prisma',
    'sharp',
    'bullmq',
  ],
  message: 'Use @converter/contracts and the HTTP API instead of backend runtime code.',
};
const webImports = {
  group: ['@converter/web', '@converter/web/**', '**/web/**'],
  message: 'Backend and contracts must not depend on the web application.',
};
const layerImports = (layers) => ({
  group: layers.flatMap((layer) => [`**/${layer}`, `**/${layer}/**`]),
  message: 'Pages compose features; features depend on shared code, never on app or pages.',
});
const restrictImports = (...patterns) => ['error', { patterns }];

export default defineConfig([
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '.cache/**',
      'playwright-report/**',
      'test-results/**',
      '**/generated/**',
    ],
  },
  js.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { eqeqeq: ['error', 'always', { null: 'ignore' }], 'no-var': 'error' },
  },
  {
    files: typescriptFiles,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}', 'apps/backend/**/*.ts', 'tests/**/*.ts', '*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: webFiles,
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      'no-restricted-imports': restrictImports(nodeImports, serverImports),
      'no-restricted-globals': ['error', 'process', 'Buffer', 'require', '__dirname', '__filename'],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['apps/web/src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports(
        nodeImports,
        serverImports,
        layerImports(['app', 'pages', 'features']),
      ),
    },
  },
  {
    files: ['apps/web/src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports(
        nodeImports,
        serverImports,
        layerImports(['app', 'pages']),
      ),
    },
  },
  {
    files: ['apps/web/src/pages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictImports(nodeImports, serverImports, layerImports(['app'])),
    },
  },
  {
    files: ['apps/backend/**/*.ts'],
    rules: { 'no-restricted-imports': restrictImports(webImports) },
  },
  {
    files: ['packages/contracts/src/**/*.ts'],
    rules: { 'no-restricted-imports': restrictImports(nodeImports, serverImports, webImports) },
  },
  prettier,
]);
