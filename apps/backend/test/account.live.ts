import 'reflect-metadata';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { ApiModule } from '../src/api.module.js';
import { ApiKeysModule } from '../src/modules/api-keys/api-keys.module.js';
import { ApiKeysService } from '../src/modules/api-keys/api-keys.service.js';
import { ApiKeyGuard, type ApiRequest } from '../src/modules/api-keys/api-key.guard.js';
import { AccountRepository } from '../src/modules/auth/account.repository.js';
import { AuthSecurityModule } from '../src/modules/auth/auth-security.module.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { AUTH_CONFIG, validateAuthConfig } from '../src/modules/auth/auth-config.js';
import {
  NOTIFICATION_CONFIG,
  validateNotificationConfig,
} from '../src/modules/notifications/notification-config.js';
import {
  INFRA_CONFIG,
  validateInfrastructureEnvironment,
} from '../src/infrastructure/config/infrastructure-config.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { RedisService } from '../src/infrastructure/redis/redis.service.js';
import { configureAuthApi } from '../src/modules/auth/configure-auth-api.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';

// A test-only operation proves the integration boundary without introducing a product endpoint.
@Controller('test-api-principal')
@UseGuards(ApiKeyGuard)
class PrincipalProbe {
  @Get()
  read(@Req() req: ApiRequest) {
    return req.apiPrincipal;
  }
}
const database = process.env.TEST_DATABASE_URL;
const redis = process.env.TEST_REDIS_URL;
for (const [value, db] of [
  [database, true],
  [redis, false],
] as const) {
  let valid = false;
  try {
    const url = new URL(value ?? '');
    valid =
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.search &&
      (db
        ? ['postgres:', 'postgresql:'].includes(url.protocol) &&
          /^\/converter_test(?:_[a-z0-9_]+)?$/.test(url.pathname)
        : url.protocol === 'redis:');
  } catch {
    /* Never include rejected connection values in diagnostics. */
  }
  if (!valid)
    throw new Error(
      'Account tests require explicit dedicated loopback TEST_DATABASE_URL and TEST_REDIS_URL.',
    );
}
const issued = (
  value: unknown,
): { metadata: { prefix: string; createdAt: string }; secret: string } => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('secret' in value) ||
    typeof value.secret !== 'string' ||
    !('metadata' in value) ||
    !value.metadata ||
    typeof value.metadata !== 'object' ||
    !('prefix' in value.metadata) ||
    typeof value.metadata.prefix !== 'string' ||
    !('createdAt' in value.metadata) ||
    typeof value.metadata.createdAt !== 'string'
  )
    throw new Error('Expected issued synthetic key.');
  return {
    secret: value.secret,
    metadata: { prefix: value.metadata.prefix, createdAt: value.metadata.createdAt },
  };
};
const csrfValue = (value: unknown) => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('csrfToken' in value) ||
    typeof value.csrfToken !== 'string'
  )
    throw new Error('Expected CSRF handshake.');
  return value.csrfToken;
};

describe('account settings and API permissions with real PostgreSQL/Redis', () => {
  let app: NestExpressApplication<Server>;
  let db: DatabaseService;
  let cache: RedisService;
  let servers: Awaited<ReturnType<typeof infrastructureServers>>;
  const run = randomUUID();
  const ids: string[] = [];
  const namespace = 'account-test-' + run;
  const origin = 'http://127.0.0.1:5173';
  const password = 'owned-synthetic-password';
  let ip = 1;
  beforeAll(async () => {
    servers = await infrastructureServers();
    const module = await Test.createTestingModule({
      imports: [ApiModule.withAuthentication(), ApiKeysModule, AuthSecurityModule],
      controllers: [PrincipalProbe],
    })
      .overrideProvider(INFRA_CONFIG)
      .useValue(
        validateInfrastructureEnvironment({
          NODE_ENV: 'test',
          DATABASE_URL: database,
          REDIS_URL: redis,
          REDIS_NAMESPACE: namespace,
          S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
          SMTP_PORT: servers.smtpPort,
        }),
      )
      .overrideProvider(AUTH_CONFIG)
      .useValue(
        validateAuthConfig({
          SESSION_SECRET: randomBytes(32).toString('hex'),
          AUTH_TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
        }),
      )
      .overrideProvider(NOTIFICATION_CONFIG)
      .useValue(
        validateNotificationConfig({
          NODE_ENV: 'test',
          APP_ORIGIN: origin,
          NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        }),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    configureAuthApi(app);
    await app.init();
    db = app.get(DatabaseService);
    cache = app.get(RedisService);
  });
  afterAll(async () => {
    if (db) await db.client.user.deleteMany({ where: { id: { in: ids } } });
    if (cache)
      for await (const keys of cache.client.scanIterator({ MATCH: namespace + ':*', COUNT: 100 }))
        if (keys.length) await cache.client.del(keys);
    await app?.close();
    await servers?.close();
  });
  async function account() {
    const user = await db.client.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        passwordHash: await app.get(PasswordService).hash(password),
        emailVerifiedAt: new Date(),
      },
    });
    ids.push(user.id);
    const agent = request.agent(app.getHttpServer());
    const address = `198.51.100.${ip++}`;
    const csrf = async () =>
      csrfValue(
        (await agent.get('/api/v1/auth/csrf').set('X-Forwarded-For', address).expect(200))
          .body as unknown,
      );
    const initialCsrf = await csrf();
    await agent
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', address)
      .set('Origin', origin)
      .set('X-CSRF-Token', initialCsrf)
      .send({ email: user.email, password })
      .expect(200);
    const token = await csrf();
    const mutation = (method: 'post' | 'patch' | 'delete', path: string) =>
      agent[method]('/api/v1' + path)
        .set('X-Forwarded-For', address)
        .set('Origin', origin)
        .set('X-CSRF-Token', token);
    const issue = async () =>
      issued(
        (
          await mutation('post', '/users/me/api-key')
            .send({ currentPassword: password })
            .expect(201)
        ).body as unknown,
      );
    return { user, agent, mutation, issue };
  }
  const probe = (secret?: string) => {
    const query = request(app.getHttpServer()).get('/api/v1/test-api-principal');
    return secret === undefined ? query : query.set('X-API-Key', secret);
  };
  it('persists one shared settings value across sessions and isolates accounts; validates strict booleans', async () => {
    const a = await account();
    const b = await account();
    await a.agent.get('/api/v1/users/me/settings').expect(200, { autoSave: false });
    await a
      .mutation('patch', '/users/me/settings')
      .send({ autoSave: true })
      .expect(200, { autoSave: true })
      .expect('Cache-Control', 'no-store');
    await a.agent.get('/api/v1/users/me/settings').expect(200, { autoSave: true });
    const second = request.agent(app.getHttpServer());
    const token = csrfValue((await second.get('/api/v1/auth/csrf').expect(200)).body as unknown);
    await second
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({ email: a.user.email, password })
      .expect(200);
    await second.get('/api/v1/users/me/settings').expect(200, { autoSave: true });
    await b.agent.get('/api/v1/users/me/settings').expect(200, { autoSave: false });
    for (const body of [{ autoSave: 'false' }, {}, { autoSave: false, userId: b.user.id }])
      await a.mutation('patch', '/users/me/settings').send(body).expect(400);
    await a
      .mutation('patch', '/users/me/settings')
      .send({ autoSave: false })
      .expect(200, { autoSave: false });
  });
  it('requires account sessions, exact Origin, CSRF and current password; keys and guest cookies cannot manage accounts', async () => {
    const a = await account();
    const key = await a.issue();
    for (const path of ['/users/me/settings', '/users/me/api-key']) {
      await request(app.getHttpServer())
        .get('/api/v1' + path)
        .set('Cookie', 'converter.dev.guest=synthetic')
        .expect(401);
      await a.agent
        .get('/api/v1' + path)
        .set('X-API-Key', key.secret)
        .expect(401);
    }
    await a.agent.patch('/api/v1/users/me/settings').send({ autoSave: true }).expect(403);
    await a
      .mutation('patch', '/users/me/settings')
      .set('Origin', 'https://other.example.test')
      .send({ autoSave: true })
      .expect(403);
    await a
      .mutation('post', '/users/me/api-key/rotate')
      .send({ currentPassword: 'wrong' })
      .expect(403);
    await probe().expect(401);
    await a.agent.get('/api/v1/test-api-principal').expect(401);
    await a.agent.get('/api/v1/test-api-principal').set('X-API-Key', 'invalid').expect(401);
    await a.agent
      .post('/api/v1/users/me/password')
      .set('X-API-Key', key.secret)
      .send({})
      .expect(401);
  });
  it('stores only a hash, returns metadata only, rejects duplicates, rotates and revokes immediately', async () => {
    const a = await account();
    const key = await a.issue();
    const stored = await db.client.apiKey.findUniqueOrThrow({
      where: { prefix: key.metadata.prefix },
    });
    expect(stored.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.secretHash).not.toBe(key.secret);
    await a.agent
      .get('/api/v1/users/me/api-key')
      .expect(200, { key: key.metadata })
      .expect('Cache-Control', 'no-store');
    await probe(key.secret).expect(200, { kind: 'api', userId: a.user.id });
    const separator = key.secret.indexOf('.') + 1;
    const altered =
      key.secret.slice(0, separator) +
      (key.secret[separator] === 'A' ? 'B' : 'A') +
      key.secret.slice(separator + 1);
    await probe(altered).expect(401);
    const other = await account();
    await other.agent.get('/api/v1/users/me/api-key').expect(200, { key: null });
    await a.mutation('post', '/users/me/api-key').send({ currentPassword: password }).expect(409);
    const next = issued(
      (
        await a
          .mutation('post', '/users/me/api-key/rotate')
          .send({ currentPassword: password })
          .expect(200)
      ).body as unknown,
    );
    await probe(key.secret).expect(401);
    await probe(next.secret).expect(200);
    await a.mutation('delete', '/users/me/api-key').send({ currentPassword: password }).expect(204);
    await probe(next.secret).expect(401);
    await a.agent.get('/api/v1/users/me/api-key').expect(200, { key: null });
  });
  it('serializes parallel create and rotation; exactly one credential remains active', async () => {
    const a = await account();
    const keys = app.get(ApiKeysService);
    const created = await Promise.allSettled([
      keys.change(a.user, password, 'create'),
      keys.change(a.user, password, 'create'),
    ]);
    expect(created.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rotated = await Promise.all([
      keys.change(a.user, password, 'rotate'),
      keys.change(a.user, password, 'rotate'),
    ]);
    const results = await Promise.all(
      rotated.map(async (key) => {
        if (!key) throw new Error('Expected synthetic rotation.');
        return (await probe(key.secret)).status;
      }),
    );
    expect(results.sort()).toEqual([200, 401]);
    expect(await db.client.apiKey.count({ where: { userId: a.user.id, revokedAt: null } })).toBe(1);
  });
  it('rolls back credential replacement on failure and rejects stale session snapshots', async () => {
    const a = await account();
    const key = await a.issue();
    const accounts = app.get(AccountRepository);
    await expect(
      accounts.transaction(async (tx) => {
        await accounts.confirmed(tx, a.user);
        await tx.apiKey.updateMany({
          where: { userId: a.user.id },
          data: { revokedAt: new Date() },
        });
        throw new Error('Controlled rollback.');
      }),
    ).rejects.toThrow('Controlled rollback.');
    await probe(key.secret).expect(200);
    await db.client.user.update({
      where: { id: a.user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    await expect(app.get(ApiKeysService).change(a.user, password, 'rotate')).rejects.toMatchObject({
      status: 401,
    });
    await a.agent.get('/api/v1/users/me/api-key').expect(401);
    await probe(key.secret).expect(200);
  });
  it('shares the sensitive-operation limit across create, rotate and revoke', async () => {
    const a = await account();
    for (let n = 0; n < 5; n++)
      await a
        .mutation('delete', '/users/me/api-key')
        .send({ currentPassword: 'wrong' })
        .expect(403);
    await a
      .mutation('post', '/users/me/api-key')
      .send({ currentPassword: password })
      .expect(429)
      .expect('Retry-After', /\d+/);
  });
});
