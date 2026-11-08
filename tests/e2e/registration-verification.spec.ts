import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Controlled HTTP responses exercise real two-page browser behavior, not live DB/Redis proof.
// Never record even synthetic verification URLs/receipts in traces.
test.use({ trace: 'off' });

async function backend(
  context: BrowserContext,
  options: { noChannel?: boolean; ttl?: number; duplicate?: boolean } = {},
) {
  const state = { verified: false, reads: 0, registrations: 0, verifies: 0, failure: false };
  if (options.noChannel)
    await context.addInitScript(() => {
      Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
    });
  await context.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/v1/auth/session') return route.fulfill({ json: { kind: 'anonymous' } });
    if (path === '/api/v1/auth/csrf')
      return route.fulfill({ json: { csrfToken: 'synthetic-csrf' } });
    if (req.method() === 'POST') expect(req.headers()['x-csrf-token']).toBe('synthetic-csrf');
    if (path === '/api/v1/auth/register') {
      const body = req.postDataJSON() as { trackStatus: boolean };
      expect(body.trackStatus).toBe(true);
      state.registrations++;
      return route.fulfill({
        status: 202,
        json: {
          status: 'accepted',
          registration: {
            receipt: 'r'.repeat(43),
            expiresAt: new Date(Date.now() + (options.ttl ?? 900_000)).toISOString(),
          },
        },
      });
    }
    if (path === '/api/v1/auth/registration/status') {
      state.reads++;
      expect(req.postDataJSON() as unknown).toEqual({ receipt: 'r'.repeat(43) });
      if (state.failure)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable.' } },
        });
      return route.fulfill({
        json: { status: state.verified && !options.duplicate ? 'verified' : 'pending' },
      });
    }
    if (path === '/api/v1/auth/verify-email') {
      state.verifies++;
      if (state.verified)
        return route.fulfill({
          status: 400,
          json: { error: { code: 'TOKEN_INVALID', message: 'Invalid.' } },
        });
      state.verified = true;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Unexpected synthetic route.' } },
    });
  });
  return state;
}

async function register(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Електронна пошта', { exact: true }).fill('owned@example.test');
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic password');
  await page.getByLabel('Повторіть пароль', { exact: true }).fill('synthetic password');
  await page.getByRole('button', { name: 'Створити акаунт', exact: true }).click();
  await expect(page).toHaveURL('/verify-email');
  await expect(page.getByRole('button', { name: 'Перевірити підтвердження' })).toBeEnabled();
}
async function verify(page: Page) {
  await page.goto('/verify-email#token=synthetic-verification-token');
  await expect(page).toHaveURL('/verify-email');
  await page.getByRole('button', { name: 'Підтвердити пошту', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Пошту підтверджено' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Увійти', exact: true }).last()).toBeVisible();
}

test('two tabs: spoofed hints cannot confirm; valid server verification updates the original without login or refocus', async ({
  page,
  context,
}) => {
  const state = await backend(context);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await register(page);
  const link = await context.newPage();
  await link.goto('/verify-email');
  await link.evaluate(() => {
    const channel = new BroadcastChannel('flux-email-verification');
    channel.postMessage({ type: 'verification-completed' });
    channel.close();
  });
  await expect.poll(() => state.reads).toBeGreaterThan(1);
  await expect(page.getByText('Пошту підтверджено.', { exact: false })).toHaveCount(0);
  await verify(link);
  await expect(page.getByRole('status').filter({ hasText: 'Пошту підтверджено' })).toBeVisible({
    timeout: 8_000,
  });
  expect(state.registrations).toBe(1);
  expect(await page.evaluate(() => sessionStorage.length + localStorage.length)).toBe(0);
  const reads = state.reads;
  await page.waitForTimeout(2_200);
  expect(state.reads).toBe(reads);
  // Reusing a consumed token must show failure in its own tab, not local success.
  await link.goto('/verify-email#token=synthetic-verification-token');
  await expect(link).toHaveURL('/verify-email');
  await link.getByRole('button', { name: 'Підтвердити пошту', exact: true }).click();
  await expect(link.getByRole('alert')).toContainText('Посилання недійсне');
  await expect(link.getByRole('status').filter({ hasText: 'Пошту підтверджено' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('missing channel and another-device confirmation are recovered by bounded visible polling', async ({
  page,
  context,
  browser,
}) => {
  const state = await backend(context, { noChannel: true });
  await register(page);
  const anotherDevice = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  try {
    await anotherDevice.route('**/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/session')) return route.fulfill({ json: { kind: 'anonymous' } });
      if (path.endsWith('/csrf')) return route.fulfill({ json: { csrfToken: 'synthetic-csrf' } });
      if (path.endsWith('/verify-email')) {
        state.verified = true;
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ status: 404 });
    });
    await verify(await anotherDevice.newPage());
    await expect(page.getByRole('status').filter({ hasText: 'Пошту підтверджено' })).toBeVisible({
      timeout: 20_000,
    });
    expect(state.registrations).toBe(1);
  } finally {
    await anotherDevice.close();
  }
});

test('expiry and reload provide sign-in/resend recovery; expiry and leaving the component stop polling', async ({
  page,
  context,
}) => {
  const state = await backend(context, { ttl: 3_000 });
  await register(page);
  await expect(page.getByRole('status').filter({ hasText: 'Строк перевірки' })).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByRole('button', { name: 'Надіслати лист повторно' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Увійти', exact: true }).last()).toBeVisible();
  const reads = state.reads;
  await page.reload();
  await expect(
    page.getByText('Після оновлення сторінки автоматична перевірка', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Перевірити підтвердження' })).toHaveCount(0);
  expect(state.reads).toBe(reads);
  await page.goto('/login');
  await page.waitForTimeout(2_200);
  expect(state.reads).toBe(reads);
});

test('status failure remains pending and recovers without another registration; duplicate decoys never confirm', async ({
  page,
  context,
}) => {
  const state = await backend(context, { duplicate: true });
  await register(page);
  state.failure = true;
  await page.getByRole('button', { name: 'Перевірити підтвердження' }).click();
  await expect(page.getByRole('alert')).toContainText('Підтвердження могло вже відбутися');
  state.failure = false;
  state.verified = true;
  await page.getByRole('button', { name: 'Перевірити підтвердження' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Пошту підтверджено.', { exact: false })).toHaveCount(0);
  expect(state.registrations).toBe(1);
});
