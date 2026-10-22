import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174' });
async function open(page: Page, path = '/login', scenario = 'success') {
  await page.goto(`/test-fixtures/auth/?scenario=${scenario}#${path}`);
  await expect(page.getByRole('note')).toContainText('без справжнього входу');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
async function fill(page: Page, mode: 'login' | 'register' | 'reset' = 'login') {
  if (mode !== 'reset')
    await page.getByLabel('Електронна пошта', { exact: true }).fill('reader@example.test');
  await page
    .getByRole('form')
    .getByLabel(mode === 'reset' ? 'Новий пароль' : 'Пароль', { exact: true })
    .fill('synthetic-password');
  if (mode !== 'login')
    await page.getByLabel('Повторіть пароль', { exact: true }).fill('synthetic-password');
}
async function counters(page: Page, expected: Record<string, number>) {
  const output = page.getByLabel('Лічильники стенда авторизації');
  await output.getByRole('button').click();
  const counts: unknown = JSON.parse((await output.textContent()) ?? '{}');
  expect(counts).toMatchObject(expected);
}

test('production forms validate, support password managers, and never send credentials without a gateway', async ({
  page,
}) => {
  const productRequests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) productRequests.push(request.method());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/login?returnTo=https%3A%2F%2Fevil.invalid');
  await expect(page).toHaveTitle('Увійти — converter');
  await expect(
    page.getByText('Авторизацію ще не підключено. Дані нікуди не надсилаються.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Увійти', exact: true }).click();
  await expect(page.getByLabel('Електронна пошта')).toBeFocused();
  await expect(page.getByLabel('Електронна пошта')).toHaveAttribute('aria-invalid', 'true');
  await fill(page);
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveAttribute(
    'autocomplete',
    'current-password',
  );
  await page.getByRole('button', { name: 'Показати: пароль', exact: true }).click();
  await expect(page.getByLabel('Пароль', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Приховати: пароль', exact: true }).click();
  await page.getByLabel('Пароль', { exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'Авторизацію ще не підключено. Дані нікуди не надіслано.',
  );
  await expect(page.getByRole('link', { name: 'До конвертера', exact: true })).toHaveAttribute(
    'href',
    '/',
  );
  expect(productRequests).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
});

test('registration validates confirmation, verification is explicit, then sign-in and sign-out update navigation', async ({
  page,
}) => {
  await open(page, '/register?returnTo=%2F%3Fconversion%3Djob_1');
  await fill(page, 'register');
  await page.getByLabel('Повторіть пароль', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: 'Створити акаунт', exact: true }).click();
  await expect(page.getByText('Паролі не збігаються.')).toBeVisible();
  await page.getByLabel('Повторіть пароль', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Створити акаунт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Підтвердження пошти' })).toBeVisible();
  await counters(page, { register: 1 });
  await expect(page.getByText(/Після переходу виберіть файл повторно/)).toBeVisible();
  await open(page, '/verify-email?%74oken=fixture-token');
  await expect(page).not.toHaveURL(/token/);
  await counters(page, { session: 1 });
  await page.getByRole('button', { name: 'Підтвердити пошту' }).click();
  await expect(page.getByText(/Пошту підтверджено/)).toBeVisible();
  await counters(page, { verify: 1 });
  await page.getByRole('link', { name: 'До входу', exact: true }).click();
  await fill(page);
  await page.getByRole('form', { name: 'Увійти', exact: true }).evaluate((element) => {
    const form = element as HTMLFormElement;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.getByRole('button', { name: 'Зачекайте…' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Інший формат. Той самий файл.' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Основна навігація' });
  await expect(nav.getByRole('link', { name: 'Мої файли' })).toBeVisible();
  await counters(page, { login: 1 });
  await nav.getByRole('button', { name: 'Вийти' }).click();
  await expect(page.getByRole('heading', { name: 'Увійти', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Вийти' })).not.toBeVisible();
  await counters(page, { logout: 1 });
});

test('recovery acknowledgement is neutral and reset consumes only an in-memory link', async ({
  page,
}) => {
  await open(page, '/forgot-password');
  for (const email of ['reader@example.test', 'absent@example.test']) {
    await page.getByLabel('Електронна пошта').fill(email);
    await page.getByRole('button', { name: 'Надіслати посилання' }).click();
    await expect(
      page.getByText('Якщо акаунт існує, лист із посиланням надійде на пошту.'),
    ).toBeVisible();
  }
  await counters(page, { recovery: 2 });
  await open(page, '/reset-password?token=fixture-token');
  await expect(page).not.toHaveURL(/token/);
  await fill(page, 'reset');
  await page.getByRole('button', { name: 'Зберегти пароль' }).click();
  await expect(page.getByText(/Пароль змінено/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Зберегти пароль' })).not.toBeVisible();
  await counters(page, { reset: 1 });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Запросити нове посилання' })).toBeVisible();
  await expect(
    page.getByRole('form').getByLabel('Новий пароль', { exact: true }),
  ).not.toBeVisible();
});

test('invalid links and pending verification have a usable resend path', async ({ page }) => {
  await open(page, '/login', 'unverified');
  await fill(page);
  await page.getByRole('button', { name: 'Увійти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Підтвердження пошти' })).toBeVisible();
  await open(page, '/verify-email?token=expired-token');
  await page.getByRole('button', { name: 'Підтвердити пошту' }).click();
  await expect(page.getByRole('alert')).toContainText('Посилання недійсне');
  await page.getByLabel('Електронна пошта').fill('reader@example.test');
  await page.getByRole('button', { name: 'Надіслати лист повторно' }).click();
  await expect(page.getByText('Якщо адреса потребує підтвердження, надішлемо лист.')).toBeVisible();
  await open(page, '/reset-password?token=expired-token');
  await fill(page, 'reset');
  await page.getByRole('button', { name: 'Зберегти пароль' }).click();
  await expect(page.getByRole('alert')).toContainText('Посилання недійсне');
  await page.getByRole('link', { name: 'Запросити нове посилання' }).click();
  await expect(page.getByRole('heading', { name: 'Відновлення пароля' })).toBeVisible();
});

test('network, rate-limit, credential and session failures expose an explicit retry without false success', async ({
  page,
}) => {
  for (const [scenario, message] of [
    ['network', 'Перевірте з’єднання'],
    ['invalid-credentials', 'Перевірте пошту та пароль'],
    ['rate-limited', 'Забагато спроб'],
  ]) {
    await open(page, '/login', scenario);
    await fill(page);
    await page.getByRole('button', { name: 'Увійти', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(message!);
    await expect(page.getByRole('button', { name: 'Увійти', exact: true })).toBeEnabled();
    await counters(page, { login: 1 });
  }
  await open(page, '/login', 'session-error');
  await page.getByRole('button', { name: 'Спробувати ще раз' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Основна навігація' })
      .getByRole('link', { name: 'Увійти' }),
  ).toBeVisible();
  await open(page, '/', 'logout-error');
  await page.getByRole('button', { name: 'Вийти' }).click();
  await expect(page.getByRole('alert')).toContainText('Перевірте з’єднання');
  await expect(page.getByRole('link', { name: 'Профіль', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Вийти' }).click();
  await expect(page.getByRole('heading', { name: 'Увійти', exact: true })).toBeVisible();
  await counters(page, { logout: 2 });
});

test('auth pages and signed-in navigation reflow without hiding forms or errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [320, 390, 768, 1366, 1505]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/login',
      '/register',
      '/verify-email',
      '/forgot-password',
      '/reset-password?token=fixture-token',
    ]) {
      await open(page, path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await open(page, '/', 'signed-in');
    if (width < 640) await page.getByRole('button', { name: 'Відкрити меню' }).click();
    await expect(page.getByRole('button', { name: 'Вийти' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(errors).toEqual([]);
});
