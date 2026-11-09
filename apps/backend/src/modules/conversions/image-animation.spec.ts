import { describe, expect, it } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AnimatedImageError, validateImageInput } from './image-input.js';

async function withImage(bytes: Buffer, check: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'flux-animation-'));
  try {
    const path = join(directory, 'synthetic-image');
    await writeFile(path, bytes);
    await check(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('animation rejection classification', () => {
  it.each(['gif', 'webp'] as const)(
    '%s accepts static input and identifies actual animation',
    async (format) => {
      const raw = Buffer.alloc(4 * 8 * 4);
      for (let offset = 0; offset < raw.length; offset += 4) {
        raw[offset + (offset < raw.length / 2 ? 0 : 2)] = 255;
        raw[offset + 3] = 255;
      }
      const animated = await sharp(raw, {
        raw: { width: 4, height: 8, pageHeight: 4, channels: 4 },
      })
        .toFormat(format, { loop: 0, delay: [100, 100] })
        .toBuffer();
      expect((await sharp(animated).metadata()).pages).toBe(2);
      await withImage(animated, async (path) => {
        await expect(validateImageInput(path, format)).rejects.toBeInstanceOf(AnimatedImageError);
      });
      const still = await sharp({
        create: { width: 4, height: 4, channels: 4, background: 'red' },
      })
        .toFormat(format)
        .toBuffer();
      await withImage(still, async (path) => {
        await expect(validateImageInput(path, format)).resolves.toMatchObject({
          width: 4,
          height: 4,
        });
      });
    },
  );

  it.each(['gif', 'webp', 'avif'])('malformed %s is not reported as animation', async (format) => {
    await withImage(Buffer.from('invalid synthetic image'), async (path) => {
      await expect(validateImageInput(path, format)).rejects.not.toBeInstanceOf(AnimatedImageError);
    });
  });

  it('identifies the AVIF sequence brand before decoding a primary frame', async () => {
    const header = Buffer.from('000000186674797061766966000000006176696661766973', 'hex');
    await withImage(header, async (path) => {
      await expect(validateImageInput(path, 'avif')).rejects.toBeInstanceOf(AnimatedImageError);
    });
  });
});
