import { expect, test } from '@playwright/test';

test('API documentation has native deep links, seven operations, and no product API requests', async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.method());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/api-docs');
  await expect(page).toHaveTitle('Документація API — converter');
  await expect(page.getByRole('heading', { level: 1, name: 'Документація API' })).toBeVisible();
  await expect(page.getByRole('note', { name: 'Доступність API' })).toContainText(
    'API ще готується.',
  );
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(7);
  await page
    .getByRole('navigation', { name: 'Зміст документації API' })
    .getByRole('link', { name: 'Помилки', exact: true })
    .click();
  await expect(page).toHaveURL('/api-docs#errors');
  await expect(page.getByRole('heading', { name: 'Помилки', exact: true })).toBeInViewport();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Помилки', exact: true })).toBeInViewport();
  await page.getByRole('link', { name: 'До початку' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('copy writes the displayed example to the clipboard, with confirmation', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://127.0.0.1:4173',
  });
  await page.goto('/api-docs');
  const code = await page.getByRole('region', { name: 'Код: cURL · Створення задачі' }).innerText();
  await page
    .getByRole('button', { name: 'Копіювати: cURL · Створення задачі', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Скопійовано: cURL · Створення задачі', exact: true }),
  ).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  // Windows normalizes system clipboard line endings to CRLF.
  expect(clipboard.replace(/\r\n/g, '\n')).toBe(code);
});

test('mobile tables and code reflow, and clipboard failure leaves a manual-copy path', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException('Blocked', 'NotAllowedError')) },
    });
  });
  await page.setViewportSize({ width: 320, height: 768 });
  await page.goto('/api-docs');
  await page
    .getByRole('button', { name: 'Копіювати: cURL · Створення задачі', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('скопіюйте код вручну');
  const code = page.getByRole('region', { name: 'Код: cURL · Створення задачі' });
  await expect(code).toBeVisible();
  expect(await code.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await code.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => code.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  for (const width of [320, 390, 768, 1024, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
