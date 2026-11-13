import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import type { components } from '@converter/contracts';

// Opt in only against an owned local acceptance stack; never intercept product routes.
test('manual QA regressions with real email, saved files and static GIF conversions', async ({
  page,
  context,
  request,
}) => {
  test.skip(
    process.env.CONVERTER_MANUAL_QA !== '1',
    'Requires an explicitly authorized local API/Linux worker/Mailpit stack.',
  );
  test.setTimeout(6 * 60_000);
  const origin = 'http://127.0.0.1:5173';
  const mail = 'http://127.0.0.1:8025';
  const password = randomUUID() + randomUUID();
  const email = `qa-acceptance-${randomUUID()}@example.test`;
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('Application runtime error'));
  async function mutate(client: APIRequestContext, path: string, data: unknown, method = 'POST') {
    const csrf = await client.get(origin + '/api/v1/auth/csrf');
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    return client.fetch(origin + '/api/v1/' + path, {
      method,
      data,
      headers: { Origin: origin, 'X-CSRF-Token': csrfToken },
    });
  }
  async function verify(client: APIRequestContext, address: string) {
    let id: string | undefined;
    await expect
      .poll(
        async () => {
          const result = await request.get(mail + '/api/v1/search', {
            params: { query: 'to:' + address },
          });
          const messages = (await result.json()) as { messages: { ID: string }[] };
          id = messages.messages[0]?.ID;
          return Boolean(id);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    const message = (await (await request.get(mail + '/api/v1/message/' + id)).json()) as {
      Text: string;
    };
    const link = message.Text.match(/http:\/\/127\.0\.0\.1:5173\/verify-email[^\s<>]+/)?.[0];
    expect(Boolean(link)).toBe(true);
    const token = new URLSearchParams(new URL(link!).hash.slice(1)).get('token');
    expect((await mutate(client, 'auth/verify-email', { token })).status()).toBe(204);
  }
  const registerStart = Date.now();
  await page.goto(origin + '/register');
  await page.getByLabel('Електронна пошта', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByLabel('Повторіть пароль', { exact: true }).fill(password);
  const registered = page.waitForResponse(
    (r) => r.url().endsWith('/auth/register') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Створити акаунт', exact: true }).click();
  expect((await registered).status()).toBe(202);
  await expect(page).toHaveURL(/\/verify-email/);
  await verify(context.request, email);
  console.log(
    JSON.stringify({
      registration: 'first request accepted and email received',
      withinMs: Date.now() - registerStart,
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('status').filter({ hasText: 'Пошту підтверджено' })).toBeVisible({
    timeout: 20_000,
  });
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
  type Job = components['schemas']['ConversionStatus'];
  const jobs: { jobId: string; fileId: string; name: string; format: string; hash: string }[] = [];
  const image = sharp({ create: { width: 48, height: 32, channels: 3, background: '#208c5a' } });
  const gif = await image.clone().gif().toBuffer();
  expect((await sharp(gif).metadata()).pages ?? 1).toBe(1);
  const jpg = await image.clone().jpeg().toBuffer();
  async function convert(name: string, bytes: Buffer, target: string) {
    await page.goto(origin + '/');
    await expect(
      page
        .getByRole('navigation', { name: 'Основна навігація' })
        .getByRole('link', { name: 'Мої файли', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Файл для конвертації').setInputFiles({
      name,
      mimeType: name.endsWith('.gif') ? 'image/gif' : 'image/jpeg',
      buffer: bytes,
    });
    await page.getByRole('combobox', { name: 'Конвертувати у' }).selectOption(target);
    const submitted = page.waitForResponse(
      (r) => r.url().endsWith('/conversions') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
    const response = await submitted;
    expect(response.status()).toBe(202);
    const accepted = (await response.json()) as { id: string };
    await expect(page.getByRole('heading', { name: 'Файл готовий', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const status = (await (
      await context.request.get(origin + '/api/v1/conversions/' + accepted.id)
    ).json()) as Job;
    expect(status.result?.name).toBe(name.replace(/\.[^.]*$/, '.' + target));
    expect(status.result?.retention).toBe('saved');
    const download = await context.request.get(
      origin + '/api/v1/conversions/' + accepted.id + '/download',
    );
    expect(download.status()).toBe(200);
    const data = await download.body();
    const metadata = await sharp(data).metadata();
    expect(metadata.width).toBe(48);
    expect(metadata.height).toBe(32);
    expect(metadata.format).toBe(target === 'jpg' ? 'jpeg' : target === 'avif' ? 'heif' : target);
    if (target === 'avif') expect(metadata.compression).toBe('av1');
    expect(
      decodeURIComponent(download.headers()['content-disposition']!.split("UTF-8''")[1]!),
    ).toBe(status.result!.name);
    jobs.push({
      jobId: accepted.id,
      fileId: status.result!.id,
      name: status.result!.name,
      format: target,
      hash: createHash('sha256').update(data).digest('hex'),
    });
    console.log(`Real conversion ${jobs.length}: output decoded and filename verified.`);
  }
  for (const target of ['jpg', 'png', 'webp', 'avif'])
    await convert('static single frame.gif', gif, target);
  console.log('Static GIF: all four supported real outputs decoded at 48x32.');
  for (const name of [
    'Зображення червень.jpg',
    'café déjà vu.jpg',
    'two spaces image.jpg',
    'Фото été 東京 12.jpg',
  ])
    await convert(name, jpg, 'png');
  // Preserve production limits: do not reset counters or create replacement identities to evade them.
  console.log(
    'Eight conversions complete; waiting for the existing rate-limit window before more mutations.',
  );
  await new Promise((resolve) => setTimeout(resolve, 61_000));
  for (let i = 0; i < 4; i++) await convert(`synthetic pagination ${i}.jpg`, jpg, 'png');
  const initialResponse = await context.request.get(origin + '/api/v1/files');
  const initial = (await initialResponse.json()) as components['schemas']['SavedFilesPage'];
  expect(initial.items).toHaveLength(10);
  expect(initial.nextCursor).not.toBeNull();
  const second = (await (
    await context.request.get(origin + '/api/v1/files', { params: { cursor: initial.nextCursor! } })
  ).json()) as components['schemas']['SavedFilesPage'];
  expect(second.items).toHaveLength(2);
  expect(new Set([...initial.items, ...second.items].map((f) => f.id)).size).toBe(12);
  await page.goto(origin + '/files');
  await expect(page.getByRole('article')).toHaveCount(10);
  await page.getByRole('button', { name: 'Показати ще', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(12);
  const target = jobs[7]!;
  const row = page.getByRole('article', { name: target.name, exact: true });
  await row.getByRole('button', { name: 'Перейменувати', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Назва файлу', exact: true });
  await expect(field).toBeFocused();
  await field.fill('Перейменовано résumé 東京');
  await page.getByRole('button', { name: 'Зберегти назву', exact: true }).click();
  const renamed = 'Перейменовано résumé 東京.png';
  await expect(page.getByRole('article', { name: renamed, exact: true })).toBeVisible();
  const downloaded = await context.request.get(
    origin + '/api/v1/files/' + target.fileId + '/download',
  );
  expect(downloaded.status()).toBe(200);
  expect(
    createHash('sha256')
      .update(await downloaded.body())
      .digest('hex'),
  ).toBe(target.hash);
  expect(
    decodeURIComponent(downloaded.headers()['content-disposition']!.split("UTF-8''")[1]!),
  ).toBe(renamed);
  const renamedStatus = (await (
    await context.request.get(origin + '/api/v1/conversions/' + target.jobId)
  ).json()) as Job;
  expect(renamedStatus.result?.name).toBe(renamed);
  expect(
    (
      await mutate(context.request, 'files/' + target.fileId, { name: 'changed.jpg' }, 'PATCH')
    ).status(),
  ).toBe(400);
  await page.getByRole('searchbox', { name: 'Пошук за назвою' }).fill('résumé 東京');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: renamed, exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Пошук за назвою' }).fill('');
  await page.getByLabel('Тип файлу', { exact: true }).selectOption('jpg');
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByLabel('Тип файлу', { exact: true }).selectOption('all');
  await page.getByLabel('За датою', { exact: true }).selectOption('oldest');
  await expect(page.getByRole('article').first()).toHaveAttribute('aria-label', jobs[0]!.name);
  await page.getByLabel('За датою', { exact: true }).selectOption('newest');
  // A fresh view loads one page, so deletion tests the next-page path as well.
  await page.reload();
  await expect(page.getByRole('article')).toHaveCount(10);
  const boundary = initial.items[9]!;
  const boundaryRow = page.getByRole('article', { name: boundary.name, exact: true });
  await boundaryRow.getByRole('button', { name: 'Видалити', exact: true }).click();
  await page.getByRole('button', { name: 'Видалити файл', exact: true }).click();
  await expect(boundaryRow).toHaveCount(0);
  const afterBoundary = (await (
    await context.request.get(origin + '/api/v1/files', { params: { cursor: initial.nextCursor! } })
  ).json()) as components['schemas']['SavedFilesPage'];
  expect(afterBoundary.items.map((f) => f.id)).toEqual(second.items.map((f) => f.id));
  await page.getByRole('button', { name: 'Показати ще', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(11);
  expect(
    new Set(
      await page
        .getByRole('article')
        .evaluateAll((rows) => rows.map((r) => r.getAttribute('aria-label'))),
    ).size,
  ).toBe(11);
  expect(
    (
      await mutate(context.request, 'files/' + boundary.id, { name: boundary.name }, 'PATCH')
    ).status(),
  ).toBe(410);
  console.log(
    'Pagination 10+2, rename/download bytes, search/filter/sort and deleted-cursor continuation passed.',
  );
  // Real admission failures followed by a new valid selection/target.
  const raw = Buffer.alloc(4 * 8 * 4);
  for (let offset = 0; offset < raw.length; offset += 4) {
    raw[offset + (offset < raw.length / 2 ? 0 : 2)] = 255;
    raw[offset + 3] = 255;
  }
  const animated = await sharp(raw, { raw: { width: 4, height: 8, pageHeight: 4, channels: 4 } })
    .gif({ loop: 0, delay: [100, 100] })
    .toBuffer();
  expect((await sharp(animated).metadata()).pages).toBe(2);
  await page.goto(origin + '/');
  await expect(
    page
      .getByRole('navigation', { name: 'Основна навігація' })
      .getByRole('link', { name: 'Мої файли', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Файл для конвертації')
    .setInputFiles({ name: 'synthetic animated.gif', mimeType: 'image/gif', buffer: animated });
  await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Цей GIF містить анімацію. Наразі підтримуються лише статичні GIF-файли.',
  );
  await page
    .getByLabel('Файл для конвертації')
    .setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Filename suggests JPEG, actual PNG bytes cannot be converted to PNG.
  const png = await image.clone().png().toBuffer();
  await page
    .getByLabel('Файл для конвертації')
    .setInputFiles({ name: 'mismatch.jpg', mimeType: 'image/jpeg', buffer: png });
  await page.getByRole('combobox', { name: 'Конвертувати у' }).selectOption('png');
  await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Сервер відхилив файл. Виберіть інший файл або формат.',
  );
  await page.getByRole('combobox', { name: 'Конвертувати у' }).selectOption('webp');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(
    (
      await context.request.patch(origin + '/api/v1/files/' + target.fileId, {
        data: { name: renamed },
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.patch(origin + '/api/v1/files/' + target.fileId, {
        data: { name: renamed },
        headers: { 'X-API-Key': 'invalid-synthetic-key' },
      })
    ).status(),
  ).toBe(401);
  expect(
    (await mutate(request, 'files/' + target.fileId, { name: renamed }, 'PATCH')).status(),
  ).toBe(401);
  const other = await context.browser()!.newContext();
  try {
    const otherEmail =
      process.env.CONVERTER_MANUAL_QA_OTHER_EMAIL ?? `qa-acceptance-${randomUUID()}@example.test`;
    const otherPassword = process.env.CONVERTER_MANUAL_QA_OTHER_PASSWORD ?? password;
    if (!process.env.CONVERTER_MANUAL_QA_OTHER_EMAIL) {
      expect(
        (
          await mutate(other.request, 'auth/register', {
            email: otherEmail,
            password: otherPassword,
          })
        ).status(),
      ).toBe(202);
      await verify(other.request, otherEmail);
    }
    expect(
      (
        await mutate(other.request, 'auth/login', { email: otherEmail, password: otherPassword })
      ).status(),
    ).toBe(200);
    expect(
      (await mutate(other.request, 'files/' + target.fileId, { name: renamed }, 'PATCH')).status(),
    ).toBe(404);
    expect(
      (await other.request.get(origin + '/api/v1/files/' + target.fileId + '/download')).status(),
    ).toBe(404);
  } finally {
    await other.close();
  }
  console.log('Rename denies missing CSRF, invalid explicit keys, anonymous and foreign accounts.');
  // Keyboard/mobile navigation and desktop layout.
  async function navCheck(targetPage: Page, width: number) {
    await targetPage.setViewportSize({ width, height: 844 });
    const menu = targetPage.getByRole('button', { name: 'Відкрити меню' });
    await menu.click();
    const links = targetPage
      .getByRole('navigation', { name: 'Основна навігація' })
      .getByRole('link');
    const boxes = await links.evaluateAll((items) =>
      items.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, h: r.height };
      }),
    );
    expect(boxes).toHaveLength(4);
    for (let i = 1; i < boxes.length; i++)
      expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.h);
    await links.first().focus();
    await targetPage.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await links.filter({ hasText: 'Мої файли' }).click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(
      await targetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  }
  for (const width of [320, 390]) await navCheck(page, width);
  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(page.getByRole('button', { name: 'Відкрити меню' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Основна навігація' })).toBeVisible();
  expect(errors).toEqual([]);
});
