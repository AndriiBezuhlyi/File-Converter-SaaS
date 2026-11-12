import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import type { components } from '@converter/contracts';
import { documentFixtures } from '../../apps/backend/test/fixtures/documents.mjs';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

const directions = {
  jpg: ['png', 'webp', 'avif'],
  png: ['jpg', 'webp', 'avif'],
  webp: ['jpg', 'png', 'avif'],
  avif: ['jpg', 'png', 'webp'],
  gif: ['jpg', 'png', 'webp', 'avif'],
  svg: ['jpg', 'png', 'webp', 'avif'],
  docx: ['pdf'],
  odt: ['pdf'],
  xlsx: ['pdf'],
  pptx: ['pdf'],
  csv: ['pdf'],
  txt: ['pdf'],
} as const;
type Source = keyof typeof directions;
const mime: Record<Source, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
};

async function download(page: Page, button: ReturnType<Page['getByRole']>) {
  const pending = page.waitForEvent('download');
  await button.click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  return readFile(await file.path());
}

test('live matrix covers every direction declared in OpenAPI', async () => {
  const contract = JSON.parse(
    await readFile(new URL('../../packages/contracts/openapi.json', import.meta.url), 'utf8'),
  ) as {
    components: {
      schemas: {
        ConversionCapabilities: {
          properties: { directions: { properties: Record<string, { items: { enum: string[] } }> } };
        };
      };
    };
  };
  const declared = Object.fromEntries(
    Object.entries(
      contract.components.schemas.ConversionCapabilities.properties.directions.properties,
    ).map(([source, schema]) => [source, schema.items.enum]),
  );
  expect(directions).toEqual(declared);
  expect(Object.values(directions).flat()).toHaveLength(26);
});

// No route interception: these checks require the real API, Linux worker and private providers.
// Both opt-ins attest that loopback ports 5173/58025 belong to disposable test services.
test('authenticated live conversion matrix, real polling and saved downloads', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.CONVERTER_LIVE_E2E !== '1' || process.env.CONVERTER_ITEM17_ISOLATED !== '1',
    'Requires explicitly provisioned isolated API/Linux worker/storage/Mailpit services.',
  );
  test.setTimeout(10 * 60_000);
  const origin = 'http://127.0.0.1:5173';
  const mail = 'http://127.0.0.1:58025';
  const email = `item17-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
  const runtimeErrors: string[] = [];
  page.on('pageerror', () => runtimeErrors.push('Application runtime error'));
  const capabilitiesResponse = await request.get(origin + '/api/v1/capabilities');
  expect(capabilitiesResponse.status()).toBe(200);
  const capabilities =
    (await capabilitiesResponse.json()) as components['schemas']['ConversionCapabilities'];
  expect(capabilities.directions).toEqual(directions);

  const fixtures: Record<Source, Buffer> = {
    ...documentFixtures(),
    jpg: Buffer.alloc(0),
    png: Buffer.alloc(0),
    webp: Buffer.alloc(0),
    avif: Buffer.alloc(0),
    gif: Buffer.alloc(0),
    svg: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="#208c5a"/></svg>',
    ),
  };
  for (const format of ['jpg', 'png', 'webp', 'avif', 'gif'] as const) {
    fixtures[format] = await sharp({
      create: { width: 48, height: 32, channels: 3, background: '#208c5a' },
    })
      .toFormat(format === 'jpg' ? 'jpeg' : format)
      .toBuffer();
  }

  await page.goto(origin + '/register');
  await page.getByLabel('Електронна пошта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByLabel('Повторіть пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Створити акаунт', exact: true }).click();
  await expect(page).toHaveURL(/\/verify-email/);
  let messageId: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(mail + '/api/v1/messages');
        expect(response.status()).toBe(200);
        const data = (await response.json()) as {
          messages: { ID: string; To: { Address: string }[] }[];
        };
        messageId = data.messages.find((message) =>
          message.To.some((to) => to.Address === email),
        )?.ID;
        return Boolean(messageId);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const message = (await (await request.get(mail + '/api/v1/message/' + messageId)).json()) as {
    Text: string;
  };
  const link = message.Text.match(/http:\/\/127\.0\.0\.1:5173\/verify-email[^\s<>]+/)?.[0];
  expect(Boolean(link)).toBe(true);
  await page.goto(link!);
  await page.getByRole('button', { name: 'Підтвердити пошту', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Пошту підтверджено' })).toBeVisible();
  await page.goto(origin + '/login');
  await page.getByLabel('Електронна пошта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Увійти', exact: true }).click();
  await expect(page).toHaveURL(origin + '/');
  await page.goto(origin + '/files');
  const autoSave = page.getByRole('switch');
  await expect(autoSave).toBeEnabled();
  if (!(await autoSave.isChecked())) await autoSave.click();
  await expect(autoSave).toBeChecked();
  await expect(autoSave).toBeEnabled();

  let nextAdmissionAt = 0;
  for (const source of Object.keys(directions) as Source[]) {
    for (const target of directions[source]) {
      await test.step(`${source} -> ${target}`, async () => {
        const name = `item17-${source}-${target}`;
        await page.goto(origin);
        const input = page.getByLabel('Файл для конвертації');
        await expect(input).toBeEnabled();
        await input.setInputFiles({
          name: `${name}.${source}`,
          mimeType: mime[source],
          buffer: fixtures[source],
        });
        await page.getByLabel('Конвертувати у').selectOption(target);
        // Respect the real 10 uploads/minute principal limit without changing server policy.
        await delay(Math.max(0, nextAdmissionAt - performance.now()));
        nextAdmissionAt = performance.now() + 6_100;
        const acceptedResponse = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/v1/conversions' &&
            response.request().method() === 'POST',
        );
        // Observe the frontend's own GET polling, not a separate test-side polling client.
        // Register before submission so even an immediately completed job is observed.
        const completedResponse = page.waitForResponse(
          async (response) => {
            if (
              !/^\/api\/v1\/conversions\/[a-f0-9-]{36}$/.test(new URL(response.url()).pathname) ||
              response.request().method() !== 'GET' ||
              response.status() !== 200
            )
              return false;
            const status = (await response.json()) as components['schemas']['ConversionStatus'];
            return (
              status.sourceFormat === source &&
              status.targetFormat === target &&
              (status.status === 'completed' || status.status === 'failed')
            );
          },
          { timeout: 90_000 },
        );
        await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
        const accepted = await acceptedResponse;
        expect(accepted.status()).toBe(202);
        const admission = (await accepted.json()) as components['schemas']['ConversionAccepted'];
        expect(admission.sourceFormat).toBe(source);
        expect(admission.targetFormat).toBe(target);
        expect(admission.saveResult).toBe(true);
        const completed = await completedResponse;
        const job = (await completed.json()) as components['schemas']['ConversionStatus'];
        expect(job.id).toBe(admission.id);
        expect(job.status).toBe('completed');
        expect(job.result?.format).toBe(target);
        expect(job.result?.availability).toBe('available');
        expect(job.result?.owner).toBe('account');
        expect(job.result?.retention).toBe('saved');
        await expect(page.getByText('Збережено в «Мої файли»', { exact: true })).toBeVisible();
        const bytes = await download(
          page,
          page.getByRole('button', { name: 'Завантажити', exact: true }),
        );
        expect(bytes.length).toBe(job.result?.sizeBytes);
        if (target === 'pdf') {
          expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
          expect(bytes.subarray(-1024).toString()).toContain('%%EOF');
        } else {
          const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
          expect(decoded.info.width).toBe(48);
          expect(decoded.info.height).toBe(32);
          const metadata = await sharp(bytes).metadata();
          expect(metadata.format).toBe(
            target === 'jpg' ? 'jpeg' : target === 'avif' ? 'heif' : target,
          );
        }
        await page.goto(origin + '/files');
        await page.getByLabel('Пошук за назвою').fill(name);
        const row = page.getByRole('article', { name: `${name}.${target}`, exact: true });
        await expect(row).toBeVisible();
        expect(
          await download(page, row.getByRole('button', { name: 'Завантажити', exact: true })),
        ).toEqual(bytes);
        await row.getByRole('button', { name: 'Видалити', exact: true }).click();
        await page.getByRole('button', { name: 'Видалити файл', exact: true }).click();
        await expect(row).toHaveCount(0);
      });
    }
  }
  expect(runtimeErrors).toEqual([]);
});
