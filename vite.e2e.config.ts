import { defineConfig, type Connect } from 'vite';
import base from './apps/web/vite.config.js';

// Tests override these baseline protocol responses with their own browser routes.
// Never proxy a missing fixture to a developer's API.
const baseline: Connect.NextHandleFunction = (request, response, next) => {
  const path = request.url?.split('?')[0];
  if (!path?.startsWith('/api/')) return next();
  const body =
    request.method === 'GET' && path === '/api/v1/auth/session'
      ? { kind: 'anonymous' }
      : request.method === 'GET' && path === '/api/v1/auth/csrf'
        ? { csrfToken: 'synthetic-e2e-only' }
        : request.method === 'POST' && path === '/api/v1/guest-session'
          ? { trialState: 'available', activeConversionId: null }
          : undefined;
  response.statusCode = body ? 200 : 503;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.end(
    JSON.stringify(
      body ?? { error: { code: 'E2E_UNMOCKED_REQUEST', message: 'Missing test fixture.' } },
    ),
  );
};

export default defineConfig({
  ...base,
  plugins: [
    ...(base.plugins ?? []),
    {
      name: 'e2e-isolated-api',
      configureServer(server) {
        server.middlewares.use(baseline);
      },
      configurePreviewServer(server) {
        server.middlewares.use(baseline);
      },
    },
  ],
  server: { ...base.server, proxy: {} },
  preview: { ...base.preview, proxy: {} },
});
