import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';
import { ApiModule } from '../src/api.module.js';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { StorageService } from '../src/infrastructure/storage/storage.service.js';
import {
  INFRA_CONFIG,
  validateInfrastructureEnvironment,
} from '../src/infrastructure/config/infrastructure-config.js';
import { AUTH_CONFIG, validateAuthConfig } from '../src/modules/auth/auth-config.js';
import {
  NOTIFICATION_CONFIG,
  validateNotificationConfig,
} from '../src/modules/notifications/notification-config.js';
import { configureAuthApi } from '../src/modules/auth/configure-auth-api.js';
import { GuestCredentialsService } from '../src/modules/auth/guest/guest-credentials.service.js';
import { GuestTrialService } from '../src/modules/auth/guest/guest-trial.service.js';
import { ConversionProcessingService } from '../src/modules/conversions/conversion-processing.service.js';
import { ConversionEngine, EngineFailure } from '../src/modules/conversions/conversion-engine.js';
import { infrastructureServers } from './fixtures/infrastructure-servers.js';
import { UPLOAD_STAGING_DIRECTORY } from '../src/modules/conversions/upload-staging.js';

jest.setTimeout(30_000);
function testUrl(name: string) {
  try {
    return new URL(process.env[name] ?? 'http://invalid');
  } catch {
    throw new Error('Invalid isolated test service URL.');
  }
}
const database = testUrl('TEST_DATABASE_URL');
const redis = testUrl('TEST_REDIS_URL');
if (
  database.hostname !== '127.0.0.1' ||
  database.protocol !== 'postgresql:' ||
  !/^\/converter_test_[a-z0-9_]+$/.test(database.pathname) ||
  database.search ||
  redis.hostname !== '127.0.0.1' ||
  redis.protocol !== 'redis:' ||
  redis.search
)
  throw new Error('Explicit isolated loopback test services required.');
const web = process.env.TEST_WEB_ORIGIN;
if (web !== 'http://127.0.0.1:5173')
  throw new Error('Explicit local TEST_WEB_ORIGIN=http://127.0.0.1:5173 required.');

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('guest recovery across real database transactions and shared browser tabs', () => {
  let app: NestExpressApplication<Server>;
  let db: DatabaseService;
  let servers: Awaited<ReturnType<typeof infrastructureServers>>;
  let browser: Browser;
  let base: string;
  let processing: ConversionProcessingService;
  let jpg: Buffer;
  const engine = new ConversionEngine();
  const convert = jest.spyOn(engine, 'convert');
  const contexts: BrowserContext[] = [];
  const runtimeErrors: string[] = [];
  let nextIp = 10;

  beforeAll(async () => {
    servers = await infrastructureServers();
    const config = validateInfrastructureEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: database.href,
      REDIS_URL: redis.href,
      REDIS_NAMESPACE: `recovery-${randomUUID()}`,
      S3_ENDPOINT: `http://127.0.0.1:${servers.storagePort}`,
      SMTP_PORT: servers.smtpPort,
    });
    const module = await Test.createTestingModule({ imports: [ApiModule.withAuthentication()] })
      .overrideProvider(INFRA_CONFIG)
      .useValue(config)
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
          APP_ORIGIN: web,
          NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        }),
      )
      .compile();
    app = module.createNestApplication<NestExpressApplication<Server>>();
    app.setGlobalPrefix('api/v1');
    configureAuthApi(app);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener.');
    base = `http://127.0.0.1:${address.port}`;
    db = app.get(DatabaseService);
    processing = new ConversionProcessingService(
      db,
      app.get(StorageService),
      app.get(GuestTrialService),
      engine,
      config,
    );
    jpg = await sharp({ create: { width: 3, height: 4, channels: 3, background: '#fff' } })
      .jpeg()
      .toBuffer();
    browser = await chromium.launch({ headless: true });
  });
  beforeEach(() => {
    convert.mockImplementation(async (input) =>
      sharp(await readFile(input))
        .png()
        .toBuffer(),
    );
  });
  afterEach(async () => {
    for (const context of contexts.splice(0)) {
      await Promise.all(context.pages().map((page) => page.goto('about:blank')));
      await context.unrouteAll({ behavior: 'wait' });
      await context.close();
    }
    expect(runtimeErrors.splice(0)).toEqual([]);
  });
  afterAll(async () => {
    await browser?.close();
    await app?.close();
    await servers?.close();
  });

  async function context() {
    const context = await browser.newContext({
      extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${nextIp++}` },
    });
    contexts.push(context);
    // Only the frontend is served by the existing dev server. Every API request uses this isolated fixture.
    await context.route('**/api/v1/**', async (route) => {
      const response = await route.fetch({ url: base + new URL(route.request().url()).pathname });
      await route.fulfill({ response });
    });
    context.on('page', (page) => {
      page.setDefaultTimeout(10_000);
      page.setDefaultNavigationTimeout(10_000);
      page.on('pageerror', () => runtimeErrors.push('Application runtime error'));
    });
    return context;
  }
  async function csrf(context: BrowserContext) {
    const response = await context.request.get(base + '/api/v1/auth/csrf');
    expect(response.status()).toBe(200);
    return ((await response.json()) as { csrfToken: string }).csrfToken;
  }
  async function guest(context: BrowserContext) {
    const response = await context.request.post(base + '/api/v1/guest-session', {
      headers: { Origin: web!, 'X-CSRF-Token': await csrf(context) },
      data: {},
    });
    expect(response.status()).toBe(200);
    const credential = (await context.cookies()).find(
      (cookie) => cookie.name === 'converter.dev.guest',
    );
    if (!credential) throw new Error('Missing owned guest credential.');
    return app.get(GuestCredentialsService).resolve(credential.value);
  }
  async function upload(context: BrowserContext) {
    return context.request.post(base + '/api/v1/conversions', {
      headers: { Origin: web!, 'X-CSRF-Token': await csrf(context) },
      multipart: {
        targetFormat: 'png',
        file: { name: 'owned.jpg', mimeType: 'image/jpeg', buffer: jpg },
      },
    });
  }
  async function start(page: Page) {
    await page.goto(web!);
    await page.locator('input[type=file]:enabled').waitFor({ state: 'attached' });
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'owned.jpg', mimeType: 'image/jpeg', buffer: jpg });
    await page.getByRole('button', { name: 'Конвертувати', exact: true }).waitFor();
  }
  async function row(id: string) {
    return db.client.conversion.findUniqueOrThrow({ where: { id } });
  }

  it.each([false, true])(
    'preserves committed input after lost COMMIT acknowledgement (reconciliation unavailable: %s)',
    async (unavailable) => {
      const ctx = await context();
      const principal = await guest(ctx);
      const transaction = db.client.$transaction.bind(db.client);
      const acknowledgement = jest
        .spyOn(db.client, '$transaction')
        .mockImplementationOnce(async (work, options) => {
          await transaction(work, options);
          throw new Error('Synthetic lost COMMIT acknowledgement.');
        });
      const reconciliation = unavailable
        ? jest
            .spyOn(db.client.conversion, 'findUnique')
            .mockRejectedValueOnce(new Error('Synthetic unavailable reconciliation.'))
        : undefined;
      try {
        const response = await upload(ctx);
        expect(response.status()).toBe(unavailable ? 503 : 202);
      } finally {
        acknowledgement.mockRestore();
        reconciliation?.mockRestore();
      }
      const committed = await db.client.conversion.findFirstOrThrow({
        where: { guestSessionId: principal.guestSessionId },
        include: { source: true },
      });
      expect(servers.objects.has(committed.source.objectKey)).toBe(true);
      expect(
        await db.client.backgroundTask.count({
          where: { resourceId: committed.id, type: 'conversion_dispatch', completedAt: null },
        }),
      ).toBe(1);
      expect(
        (
          await db.client.guestSession.findUniqueOrThrow({
            where: { id: principal.guestSessionId },
          })
        ).reservedConversionId,
      ).toBe(committed.id);
      await processing.process(committed.id);
      expect((await row(committed.id)).status).toBe('completed');
      const download = await ctx.request.get(base + `/api/v1/conversions/${committed.id}/download`);
      expect(download.status()).toBe(200);
      expect((await sharp(await download.body()).metadata()).format).toBe('png');
    },
  );

  it('cleans an interrupted guest upload before admission without reserving quota or creating input objects', async () => {
    const ctx = await context();
    const principal = await guest(ctx);
    const token = await csrf(ctx);
    const before = servers.objects.size;
    const request = httpRequest(base + '/api/v1/conversions', {
      method: 'POST',
      headers: {
        Origin: web,
        'X-CSRF-Token': token,
        Cookie: (await ctx.cookies()).map(({ name, value }) => `${name}=${value}`).join('; '),
        'Content-Type': 'multipart/form-data; boundary=owned-boundary',
      },
    });
    request.on('error', () => undefined);
    const waitForStaging = async (count: number) => {
      const deadline = Date.now() + 5_000;
      while ((await readdir(UPLOAD_STAGING_DIRECTORY)).length !== count) {
        if (Date.now() >= deadline) throw new Error('Staging count did not converge.');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    try {
      request.write(
        '--owned-boundary\r\nContent-Disposition: form-data; name="file"; filename="owned.jpg"\r\nContent-Type: image/jpeg\r\n\r\n',
      );
      request.write(jpg);
      await waitForStaging(1);
    } finally {
      request.destroy();
    }
    await waitForStaging(0);
    expect(
      await db.client.conversion.count({ where: { guestSessionId: principal.guestSessionId } }),
    ).toBe(0);
    expect(
      await db.client.file.count({ where: { guestSessionId: principal.guestSessionId } }),
    ).toBe(0);
    expect(
      (await db.client.guestSession.findUniqueOrThrow({ where: { id: principal.guestSessionId } }))
        .trialState,
    ).toBe('available');
    expect(servers.objects.size).toBe(before);
  });

  it('recovers a lost acceptance response in another tab, publishes once and blocks a second upload', async () => {
    const ctx = await context();
    const principal = await guest(ctx);
    const first = await ctx.newPage();
    await start(first);
    let posts = 0;
    const accepted = deferred();
    let id = '';
    await ctx.route('**/api/v1/conversions', async (route) => {
      posts++;
      const response = await route.fetch({ url: base + '/api/v1/conversions' });
      expect(response.status()).toBe(202);
      id = ((await response.json()) as { id: string }).id;
      await route.abort('failed');
      accepted.resolve();
    });
    await first.getByRole('button', { name: 'Конвертувати', exact: true }).click();
    await accepted.promise;
    const second = await ctx.newPage();
    await second.goto(web);
    await second.waitForURL(/conversion=/);
    expect(new URL(second.url()).searchParams.get('conversion')).toBe(id);
    expect(
      (await db.client.guestSession.findUniqueOrThrow({ where: { id: principal.guestSessionId } }))
        .trialState,
    ).toBe('reserved');
    const deliveries = await Promise.allSettled([processing.process(id), processing.process(id)]);
    expect(deliveries.some((delivery) => delivery.status === 'fulfilled')).toBe(true);
    for (const delivery of deliveries) {
      if (delivery.status === 'rejected')
        expect(delivery.reason).toMatchObject({
          response: { error: { code: 'GUEST_STATE_CONFLICT' } },
        });
    }
    await processing.process(id);
    await second.getByRole('button', { name: 'Завантажити', exact: true }).waitFor();
    const completed = await row(id);
    expect(completed.attempts).toBe(1);
    expect(
      await db.client.file.count({
        where: { guestSessionId: principal.guestSessionId, purpose: 'output' },
      }),
    ).toBe(1);
    const download = await ctx.request.get(base + `/api/v1/conversions/${id}/download`);
    expect(download.status()).toBe(200);
    expect((await sharp(await download.body()).metadata()).format).toBe('png');
    expect(
      (await db.client.guestSession.findUniqueOrThrow({ where: { id: principal.guestSessionId } }))
        .trialState,
    ).toBe('consumed');
    await second.getByRole('button', { name: 'Конвертувати інший файл', exact: true }).click();
    await second.getByRole('dialog').waitFor();
    expect(posts).toBe(1);
    const denied = await upload(ctx);
    expect(denied.status()).toBe(401);
    expect(await denied.json()).toMatchObject({
      error: { code: 'GUEST_CONVERSION_LIMIT_REACHED' },
    });
  });

  it('keeps ambiguous rejection unresolved without automatic upload replay', async () => {
    const ctx = await context();
    await guest(ctx);
    const page = await ctx.newPage();
    await start(page);
    let posts = 0;
    await ctx.route('**/api/v1/conversions', async (route) => {
      posts++;
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
    await page
      .getByText(
        'Не отримали підтвердження прийняття. Перевірте стан, перш ніж надсилати файл знову.',
      )
      .waitFor();
    await page.getByRole('button', { name: 'Перевірити ще раз', exact: true }).click();
    expect(posts).toBe(1);
    expect(await page.getByText('Повторно файл не надсилаємо.').isVisible()).toBe(true);
  });

  it('measures simultaneous first bootstrap without claiming cross-tab issuance deduplication', async () => {
    const ctx = await context();
    const token = await csrf(ctx);
    const pages = await Promise.all([ctx.newPage(), ctx.newPage()]);
    await Promise.all(pages.map((page) => page.goto(web + '/api-docs')));
    const before = await db.client.guestSession.count();
    let arrivals = 0;
    const both = deferred();
    await ctx.route('**/api/v1/guest-session', async (route) => {
      expect((route.request().headers().cookie ?? '').includes('converter.dev.guest=')).toBe(false);
      if (++arrivals === 2) both.resolve();
      await both.promise;
      const response = await route.fetch({ url: base + '/api/v1/guest-session' });
      await route.fulfill({ response });
    });
    const statuses = await Promise.all(
      pages.map((page) =>
        page.evaluate(async (csrfToken) => {
          const response = await fetch('/api/v1/guest-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: '{}',
          });
          return response.status;
        }, token),
      ),
    );
    expect(statuses).toEqual([200, 200]);
    expect(await db.client.guestSession.count()).toBe(before + 2);
    await ctx.unroute('**/api/v1/guest-session');
    const principal = await guest(ctx);
    expect(await db.client.guestSession.count()).toBe(before + 2);
    const responses = await Promise.all([upload(ctx), upload(ctx)]);
    expect(responses.map((response) => response.status()).sort()).toEqual([202, 409]);
    expect(
      await db.client.conversion.count({ where: { guestSessionId: principal.guestSessionId } }),
    ).toBe(1);
  });

  it('releases terminal failure, permits retry and fences delayed failure from the old job', async () => {
    const ctx = await context();
    const principal = await guest(ctx);
    const first = await upload(ctx);
    expect(first.status()).toBe(202);
    const id = ((await first.json()) as { id: string }).id;
    convert.mockRejectedValueOnce(new EngineFailure('Synthetic terminal input failure.'));
    await processing.process(id);
    expect((await row(id)).status).toBe('failed');
    expect(
      (await db.client.guestSession.findUniqueOrThrow({ where: { id: principal.guestSessionId } }))
        .trialState,
    ).toBe('available');
    const retry = await upload(ctx);
    expect(retry.status()).toBe(202);
    const next = ((await retry.json()) as { id: string }).id;
    await processing.process(id);
    expect(
      (await db.client.guestSession.findUniqueOrThrow({ where: { id: principal.guestSessionId } }))
        .reservedConversionId,
    ).toBe(next);
    await processing.process(next);
    expect((await row(next)).status).toBe('completed');
  });
});
