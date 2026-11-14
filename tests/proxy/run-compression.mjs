import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

// Requires Docker and npm run build --workspace=@converter/web. No production services.
const root = process.cwd();
await access(resolve(root, 'apps/web/dist/index.html'));
const name = `flux-compression-${randomUUID()}`;
const api = `${name}-api`;
const proxy = `${name}-proxy`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const mount = (source, target) =>
  `type=bind,source=${resolve(root, source)},target=${target},readonly`;
const fixture = `
  const http = require('node:http');
  const { gzipSync } = require('node:zlib');
  http.createServer((req, res) => {
    const path = new URL(req.url, 'http://api').pathname;
    const body = Buffer.from(JSON.stringify({ method: req.method, fixture: 'synthetic '.repeat(300) }));
    const encoded = path.endsWith('/encoded');
    res.writeHead(200, {
      'Content-Type': path.endsWith('/download') ? 'application/octet-stream' : 'application/json',
      'Cache-Control': 'no-store', ...(encoded ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(encoded ? gzipSync(body) : body);
  }).listen(3000, '0.0.0.0');
`;
const created = [];
let networkCreated = false;
try {
  docker('network', 'create', name);
  networkCreated = true;
  docker(
    'run',
    '-d',
    '--name',
    api,
    '--network',
    name,
    '--network-alias',
    'api',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--entrypoint',
    'node',
    process.env.F02_API_IMAGE || 'node:24-bookworm-slim',
    '-e',
    fixture,
  );
  created.push(api);
  docker(
    'run',
    '-d',
    '--name',
    proxy,
    '--network',
    name,
    '-p',
    '127.0.0.1::8080',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--mount',
    mount('infra/proxy/default.conf', '/etc/nginx/conf.d/default.conf'),
    '--mount',
    mount('apps/web/dist', '/usr/share/nginx/html'),
    process.env.F02_PROXY_IMAGE || 'nginxinc/nginx-unprivileged:stable-alpine',
  );
  created.push(proxy);
  const port = docker('port', proxy, '8080/tcp').split(':').at(-1);
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`${origin}/api/v1/fixture`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* The disposable containers may still be starting. */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  if (!ready) throw new Error('Isolated compression fixture did not become ready');
  docker('exec', proxy, 'nginx', '-t');
  const result = spawnSync(
    process.execPath,
    ['--test', 'tests/proxy/static-compression.test.mjs'],
    {
      stdio: 'inherit',
      env: { ...process.env, F02_PROXY_URL: origin, F02_FIXTURE_API: '1' },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  for (const container of created.reverse()) {
    docker('stop', container);
    docker('rm', container);
  }
  if (networkCreated) docker('network', 'rm', name);
}
