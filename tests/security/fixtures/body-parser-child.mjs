import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Controller, Module, Post, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { request } from 'node:http';
import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

if (typeof process.send !== 'function')
  throw new Error('Run only through the isolated security test.');

// No inherited credentials, persistence, application configuration, or external listener.
class ProbeController {
  echo(req) {
    return { ok: req.body.owned === true || req.body.owned === 'true' };
  }
}
Controller('probe')(ProbeController);
Post()(
  ProbeController.prototype,
  'echo',
  Object.getOwnPropertyDescriptor(ProbeController.prototype, 'echo'),
);
Req()(ProbeController.prototype, 'echo', 0);
class ProbeModule {}
Module({ controllers: [ProbeController] })(ProbeModule);

const app = await NestFactory.create(ProbeModule, { logger: false, abortOnError: false });
try {
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address();
  async function send(bytes, contentType, compressed = false) {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/probe',
          method: 'POST',
          headers: {
            'Content-Type': contentType,
            'Content-Length': bytes.length,
            ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
          },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () =>
            resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }),
          );
        },
      );
      req.setTimeout(2000, () => req.destroy(new Error('Loopback request timed out.')));
      req.on('error', reject);
      req.end(bytes);
    });
  }
  for (const [type, text] of [
    ['application/json', '{"owned":true}'],
    ['application/x-www-form-urlencoded', 'owned=true'],
  ]) {
    const bytes = Buffer.from(text);
    for (const compressed of [false, true]) {
      const result = await send(compressed ? gzipSync(bytes) : bytes, type, compressed);
      assert.equal(result.status, 201);
      assert.deepEqual(JSON.parse(result.body), { ok: true });
    }
    const trailing = Buffer.concat([gzipSync(bytes), Buffer.alloc(16, 0xff)]);
    const malformed = await send(trailing, type, true);
    assert.equal(malformed.status, 400);
    await delay(100);
    const healthy = await send(bytes, type);
    assert.equal(healthy.status, 201);
    assert.deepEqual(JSON.parse(healthy.body), { ok: true });
    // A zero after a valid gzip frame lets the decoder finish early. The bounded
    // trailing bytes must not reach it after raw-body removes its error listener.
    // See expressjs/body-parser GHSA-27r3-jxmh-p828 and its upstream regression.
    const streamed = await send(
      Buffer.concat([gzipSync(bytes), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]),
      type,
      true,
    );
    assert.equal(streamed.status, 201);
    await delay(200);
    const afterTrailing = await send(bytes, type);
    assert.equal(afterTrailing.status, 201);
    assert.deepEqual(JSON.parse(afterTrailing.body), { ok: true });
  }
  process.send('parser-regression-passed');
} finally {
  await app.close();
}
