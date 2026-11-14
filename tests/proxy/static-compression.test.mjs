import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import http from 'node:http';
import { resolve, extname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

// Run against an isolated proxy serving this checkout's production build.
// F02_PROXY_URL=http://127.0.0.1:4186 node --test tests/proxy/*.test.mjs
const origin = process.env.F02_PROXY_URL;
assert.ok(origin, 'Set F02_PROXY_URL to the isolated nginx under test');
const dist = resolve('apps/web/dist');

function request(path, encoding, extra = {}) {
  return new Promise((resolveResponse, reject) => {
    const headers = {
      ...extra,
      ...(encoding === undefined ? {} : { 'Accept-Encoding': encoding }),
    };
    http
      .get(new URL(path, origin), { headers }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolveResponse({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on('error', reject);
      })
      .on('error', reject);
  });
}

test('public HTML/CSS/JS negotiate gzip without changing bytes, types or caching', async () => {
  const assets = (await readdir(resolve(dist, 'assets'))).filter((file) =>
    /\.(css|js)$/.test(file),
  );
  for (const path of ['/index.html', ...assets.map((file) => `/assets/${file}`)]) {
    const source = await readFile(resolve(dist, path.slice(1)));
    const plain = await request(path, 'identity');
    const zipped = await request(path, 'gzip');
    assert.equal(plain.status, 200, path);
    assert.equal(zipped.status, 200, path);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.deepEqual(plain.body, source, path);
    const eligible = source.length >= 1024;
    assert.equal(zipped.headers['content-encoding'], eligible ? 'gzip' : undefined, path);
    assert.deepEqual(eligible ? gunzipSync(zipped.body) : zipped.body, source, path);
    if (eligible) {
      assert.ok(zipped.body.length < source.length, path);
      assert.match(zipped.headers.vary, /\bAccept-Encoding\b/i);
      assert.match(plain.headers.vary, /\bAccept-Encoding\b/i);
    }
    const expectedType = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
    }[extname(path)];
    assert.equal(plain.headers['content-type'].split(';')[0], expectedType);
    assert.equal(zipped.headers['content-type'], plain.headers['content-type']);
    const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    assert.equal(plain.headers['cache-control'], cache);
    assert.equal(zipped.headers['cache-control'], cache);
    for (const header of ['last-modified', 'referrer-policy', 'x-content-type-options']) {
      assert.equal(zipped.headers[header], plain.headers[header]);
    }
  }
});

test('missing/disabled gzip, ingress Via, SPA fallback and revalidation', async () => {
  const html = await readFile(resolve(dist, 'index.html'));
  for (const encoding of [undefined, 'gzip;q=0', 'br', 'identity']) {
    const response = await request('/', encoding);
    assert.equal(response.headers['content-encoding'], undefined);
    assert.deepEqual(response.body, html);
  }
  for (const path of ['/', '/login', '/api-docs', '/files']) {
    const response = await request(path, 'gzip', { Via: '1.1 f02-ingress' });
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], 'gzip');
    assert.equal(response.headers['cache-control'], 'no-cache');
    assert.deepEqual(gunzipSync(response.body), html);
  }
  const plain = await request('/', 'identity');
  const revalidated = await request('/', 'gzip', { 'If-None-Match': plain.headers.etag });
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.body.length, 0);
  assert.match(revalidated.headers.vary, /Accept-Encoding/i);
  assert.equal((await request('/assets/f02-missing.js', 'gzip')).status, 404);
});

test('already compressed public fonts stay byte-identical without gzip', async () => {
  const fonts = await readdir(resolve(dist, 'fonts'), { recursive: true });
  for (const file of fonts.filter((name) => name.endsWith('.woff2'))) {
    const response = await request(`/fonts/${file.replaceAll('\\', '/')}`, 'gzip');
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-encoding'], undefined);
    assert.deepEqual(response.body, await readFile(resolve(dist, 'fonts', file)));
  }
});

test(
  'API, auth and downloads bypass compression, including pre-encoded upstream bytes',
  {
    skip: process.env.F02_FIXTURE_API !== '1' && 'Requires synthetic F02 API fixture',
  },
  async () => {
    for (const path of [
      '/api/v1/auth/session',
      '/api/v1/auth/csrf',
      '/api/v1/fixture',
      '/api/v1/download',
      '/api/v1/encoded',
    ]) {
      const plain = await request(path, 'identity');
      const response = await request(path, 'gzip', { Via: '1.1 f02-ingress' });
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(
        response.headers['content-encoding'],
        path.endsWith('/encoded') ? 'gzip' : undefined,
      );
      assert.deepEqual(response.body, plain.body);
      if (path.endsWith('/encoded'))
        assert.equal(JSON.parse(gunzipSync(response.body)).method, 'GET');
    }
  },
);
