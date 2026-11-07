import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { zipEntries } from '../../apps/backend/test/fixtures/docx.js';

// Opt-in only: an isolated local API, Linux worker, storage and Mailpit must already be running.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('live guest, account conversion directions and saved-file lifecycle', async ({
  page,
  request,
}) => {
  test.skip(
    process.env.CONVERTER_LIVE_E2E !== '1',
    'Requires explicitly provisioned local test services.',
  );
  test.setTimeout(180_000);
  const origin = 'http://127.0.0.1:5173';
  const mailOrigin = 'http://127.0.0.1:58025';
  const email = `item8-${randomUUID()}@example.test`;
  const password = randomUUID() + 'Aa1!';
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('Application runtime error'));
  const jpg = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#aabbcc' } })
    .jpeg()
    .toBuffer();
  const png = await sharp(jpg).png().toBuffer();
  const docx = zipEntries({
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic Item 8</w:t></w:r></w:p></w:body></w:document>',
  });
  await page.goto(origin);
  await expect(page.getByRole('button', { name: 'Вибрати файл', exact: true })).toBeEnabled();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'synthetic-guest.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Завантажити', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const guestUrl = page.url();
  const guestDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
  expect((await sharp(await readFile(await (await guestDownload).path())).metadata()).format).toBe(
    'png',
  );
  await page.getByRole('button', { name: 'Конвертувати інший файл' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
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
        const response = await request.get(mailOrigin + '/api/v1/messages');
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
  const message = (await (
    await request.get(mailOrigin + '/api/v1/message/' + messageId)
  ).json()) as { Text: string };
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
  await page.goto(guestUrl);
  await expect(page.getByRole('button', { name: 'Завантажити', exact: true })).toBeVisible();
  await expect(page.getByText('Гостьовий результат не зберігається в акаунті.')).toBeVisible();
  await page.goto(origin + '/files');
  const autoSave = page.getByRole('switch');
  await expect(autoSave).toBeEnabled();
  if (!(await autoSave.isChecked())) await autoSave.click();
  await expect(autoSave).toBeChecked();
  await expect(autoSave).toBeEnabled();
  for (const [source, target, bytes, mime, magic] of [
    ['jpg', 'png', jpg, 'image/jpeg', [137, 80, 78, 71]],
    ['png', 'jpg', png, 'image/png', [255, 216, 255]],
    [
      'docx',
      'pdf',
      docx,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      [37, 80, 68, 70, 45],
    ],
  ] as const) {
    await page.goto(origin);
    await expect(page.getByRole('button', { name: 'Вибрати файл', exact: true })).toBeEnabled();
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: `synthetic-${source}.${source}`, mimeType: mime, buffer: bytes });
    await page.getByRole('button', { name: 'Конвертувати', exact: true }).click();
    await expect(page.getByText('Збережено в «Мої файли»', { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Завантажити', exact: true }).click();
    const result = await readFile(await (await download).path());
    expect([...result.subarray(0, magic.length)]).toEqual([...magic]);
    await page.goto(origin + '/files');
    const row = page.getByRole('article', { name: `synthetic-${source}.${target}` });
    await expect(row).toBeVisible();
    if (source === 'jpg') {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: test.info().outputPath('live-files-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: test.info().outputPath('live-files-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await page.getByLabel('Тип файлу').selectOption(target);
    await page.getByLabel('За датою').selectOption('oldest');
    await page.getByLabel('Пошук за назвою').fill(`synthetic-${source}`);
    await expect(row).toBeVisible();
    const savedDownload = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Завантажити', exact: true }).click();
    expect(await readFile(await (await savedDownload).path())).toEqual(result);
    await row.getByRole('button', { name: 'Видалити', exact: true }).click();
    await page.getByRole('button', { name: 'Видалити файл', exact: true }).click();
    await expect(row).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
