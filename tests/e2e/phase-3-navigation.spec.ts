import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: { kind: 'anonymous' } }),
  );
});

const contents = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Зміст документації API' });

test('native anchors support keyboard, repeated targets, history and top links', async ({
  page,
}) => {
  await page.goto('/api-docs');
  const authentication = contents(page).getByRole('link', { name: 'Авторизація', exact: true });
  await authentication.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/api-docs#authentication');
  await expect(page.locator('#authentication')).toBeFocused();
  await expect(authentication).toHaveAttribute('aria-current', 'location');
  await contents(page).getByRole('link', { name: 'Конвертації', exact: true }).click();
  await expect(page.locator('#conversions')).toBeFocused();
  await expect
    .poll(() =>
      page.locator('#conversions').evaluate((el) => Math.abs(el.getBoundingClientRect().top - 24)),
    )
    .toBeLessThan(2);
  await page.goBack();
  await expect(authentication).toHaveAttribute('aria-current', 'location');
  await expect
    .poll(() =>
      page
        .locator('#authentication')
        .evaluate((el) => Math.abs(el.getBoundingClientRect().top - 24)),
    )
    .toBeLessThan(2);
  await page.goForward();
  await expect(
    contents(page).getByRole('link', { name: 'Конвертації', exact: true }),
  ).toHaveAttribute('aria-current', 'location');
  await contents(page).getByRole('link', { name: 'Конвертації', exact: true }).click();
  await expect(page.locator('#conversions')).toBeFocused();
  await page.getByRole('link', { name: 'До початку' }).click();
  await expect(page.locator('#api-docs-title')).toBeFocused();
  await expect(page.locator('#api-docs-title')).toBeInViewport();
});

test('scrollspy follows rapid manual scroll, short sections, bottom and resize without changing history or focus', async ({
  page,
}) => {
  await page.goto('/api-docs');
  const historyLength = await page.evaluate(() => history.length);
  await contents(page).getByRole('link').first().focus();
  for (const id of ['conversions', 'limits', 'authentication', 'saved-files', 'errors']) {
    await page.locator(`#${id}`).evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
    await expect(contents(page).locator('[aria-current="location"]')).toHaveAttribute(
      'href',
      `#${id}`,
    );
  }
  await page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
  );
  await expect(contents(page).locator('[aria-current="location"]')).toHaveAttribute(
    'href',
    '#errors',
  );
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 500 });
    await page.locator('#limits').evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
    await expect(contents(page).locator('[aria-current="location"]')).toHaveAttribute(
      'href',
      '#limits',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await expect(page).toHaveURL('/api-docs');
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await expect(contents(page).getByRole('link').first()).toBeFocused();
});

test('direct encoded hashes survive delayed fonts, reload and reduced motion on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*.woff2', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.continue();
  });
  await page.goto('/api-docs#%61uthentication');
  await expect(page.locator('#authentication')).toBeFocused();
  await expect(contents(page).locator('[aria-current="location"]')).toHaveAttribute(
    'href',
    '#authentication',
  );
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  await page.reload();
  await expect(page.locator('#authentication')).toBeFocused();
  await page.goto('/#how-it-works');
  await expect(page.locator('#how-it-works')).toBeFocused();
  await expect(page.locator('#how-it-works')).toBeInViewport();
});

test('unknown and malformed fragments remain safe, and native links still work without observers', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', { value: undefined });
    Object.defineProperty(window, 'ResizeObserver', { value: undefined });
  });
  for (const hash of ['missing-section', '%E0%A4%A']) {
    await page.goto(`/api-docs#${hash}`);
    await expect(page.locator('h1')).toBeVisible();
  }
  await contents(page).getByRole('link', { name: 'Авторизація', exact: true }).click();
  await expect(page.locator('#authentication')).toBeFocused();
  await expect(contents(page).locator('[aria-current="location"]')).toHaveAttribute(
    'href',
    '#authentication',
  );
  expect(errors).toEqual([]);
});

test('Back/Forward restores manual scroll across routes rather than resetting to the top', async ({
  page,
}) => {
  await page.goto('/api-docs#authentication');
  await expect(page.locator('#authentication')).toBeFocused();
  await page.locator('#saved-files').evaluate((el) => el.scrollIntoView({ behavior: 'instant' }));
  await expect(contents(page).locator('[aria-current="location"]')).toHaveAttribute(
    'href',
    '#saved-files',
  );
  const y = await page.evaluate(() => scrollY);
  // Keyboard activation avoids scrolling to the non-sticky header before leaving.
  await page
    .locator('#primary-navigation a[href="/"]')
    .evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/');
  await page.goBack();
  await expect(page).toHaveURL('/api-docs#authentication');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
  await expect(contents(page).locator('[aria-current="location"]')).toHaveAttribute(
    'href',
    '#saved-files',
  );
  await page.goForward();
  await expect(page).toHaveURL('/');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test('mobile anonymous navigation and a cross-route fragment keep native focus behavior', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Відкрити меню' }).click();
  await page.locator('#primary-navigation a[href="/login"]').click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.locator('#primary-navigation')).toBeHidden();
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/api-docs#authentication';
    link.textContent = 'Open documentation section';
    document.querySelector('main')!.append(link);
  });
  await page.getByRole('link', { name: 'Open documentation section' }).click();
  await expect(page.locator('#authentication')).toBeFocused();
  await expect(contents(page).locator('[aria-current="location"]')).toHaveAttribute(
    'href',
    '#authentication',
  );
});

test('authenticated active links share accent styling, mobile keyboard navigation and logout behavior', async ({
  page,
}) => {
  let signedIn = true;
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      json: signedIn
        ? {
            kind: 'authenticated',
            user: { id: 'synthetic-account', email: 'reader@example.test', displayName: '' },
            expiresAt: '2026-11-08T12:00:00Z',
          }
        : { kind: 'anonymous' },
    }),
  );
  await page.route('**/api/v1/auth/csrf', (route) =>
    route.fulfill({ json: { csrfToken: 'synthetic-csrf' } }),
  );
  await page.route('**/api/v1/auth/logout', (route) => {
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
  for (const path of ['/', '/api-docs/#errors', '/files/?page=2', '/account/#profile']) {
    await page.goto(path);
    const active = page.locator('#primary-navigation [aria-current="page"]');
    await expect(active).toHaveCount(1);
    const style = await active.evaluate((el) => ({
      decoration: getComputedStyle(el).textDecorationLine,
      accent: getComputedStyle(el).textDecorationColor,
    }));
    expect(style).toEqual({ decoration: 'underline', accent: 'rgb(171, 255, 132)' });
    const inactive = page.locator('#primary-navigation a:not([aria-current])');
    for (const link of await inactive.all())
      expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/files');
  await page.getByRole('button', { name: 'Відкрити меню' }).click();
  await page.locator('#primary-navigation a[href="/account"]').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Відкрити меню' })).toBeFocused();
  await page.getByRole('button', { name: 'Відкрити меню' }).click();
  await page.locator('#primary-navigation a[href="/account"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/account');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.locator('#primary-navigation')).toBeHidden();
  await page.getByRole('button', { name: 'Відкрити меню' }).click();
  await page.getByRole('button', { name: 'Вийти', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('main')).toBeFocused();
  await page.getByRole('button', { name: 'Відкрити меню' }).click();
  await expect(page.locator('#primary-navigation a[href="/account"]')).toHaveCount(0);
  await expect(page.locator('#primary-navigation a[href="/login"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
});
