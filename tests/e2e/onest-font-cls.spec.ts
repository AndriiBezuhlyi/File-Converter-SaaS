import { expect, test } from '@playwright/test';

for (const delayPreload of [false, true]) {
  for (const width of [320, 375, 390, 504, 768, 1366]) {
    test(`hero geometry survives delayed fonts at ${width}px (preload delayed: ${delayPreload})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      let releaseFonts!: () => void;
      const fontsHeld = new Promise<void>((resolve) => {
        releaseFonts = resolve;
      });
      await page.route('**/fonts/**', async (route) => {
        // Reproduce the existing Cyrillic-600 preload arriving before the other subsets.
        if (delayPreload || !route.request().url().endsWith('/onest-cyrillic-600-normal.woff2')) {
          await fontsHeld;
        }
        await route.continue();
      });
      const geometry = () =>
        page.evaluate(() =>
          ['main h1', '[data-home-hero] > div > p', '[class*="workspace"]'].map((selector) => {
            const element = document.querySelector(selector)!;
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          }),
        );
      try {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('input[type="file"]')).toBeEnabled();
        if (!delayPreload) {
          await page.evaluate(() => document.fonts.load('600 50px Onest', 'Конвертуй'));
        }
        const before = await geometry();
        releaseFonts();
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const after = await geometry();
        // The below-fold workspace may change height as its own control labels swap.
        for (let index = 0; index < before.length; index++) {
          for (const key of ['x', 'y', 'width'] as const) {
            expect(after[index]![key]).toBeCloseTo(before[index]![key], 1);
          }
          if (index < 2) expect(after[index]!.height).toBe(before[index]!.height);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      } finally {
        releaseFonts();
      }
    });
  }
}
