import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../src/infrastructure/database/database.service.js';
import { validateInfrastructureEnvironment } from '../src/infrastructure/config/infrastructure-config.js';
import type { StorageService } from '../src/infrastructure/storage/storage.service.js';
import type { File, Prisma } from '../src/generated/prisma/client.js';
import { FilesService } from '../src/modules/files/files.service.js';

const target = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
if (
  target.protocol !== 'postgresql:' ||
  target.hostname !== '127.0.0.1' ||
  target.search ||
  !/^\/converter_test_[a-z0-9_]+$/.test(target.pathname)
)
  throw new Error('Explicit disposable loopback database required.');

describe('saved-file cursor boundaries with real PostgreSQL', () => {
  let db: DatabaseService;
  let files: FilesService;
  const users: string[] = [];
  let userId: string;
  let otherId: string;
  let rows: File[];

  beforeAll(async () => {
    db = new DatabaseService(
      validateInfrastructureEnvironment({ NODE_ENV: 'test', DATABASE_URL: target.href }),
    );
    await db.start();
    // Listing must not call storage; the existing HTTP suite covers authentication boundaries.
    files = new FilesService(db, {} as StorageService);
    for (let index = 0; index < 2; index++) {
      const user = await db.client.user.create({
        data: { email: `${randomUUID()}@example.test`, passwordHash: 'synthetic' },
      });
      users.push(user.id);
    }
    [userId, otherId] = users as [string, string];
    await db.client.file.createMany({
      data: Array.from({ length: 321 }, (_, index) => fixture(userId, index)),
    });
    rows = await db.client.file.findMany({ where: { userId } });
    await db.client.file.createMany({
      data: [
        fixture(otherId, 500),
        { ...fixture(userId, 501), purpose: 'input', retention: 'temporary' },
        {
          ...fixture(userId, 502),
          retention: 'temporary',
          expiresAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          ...fixture(userId, 503),
          deletedAt: new Date(),
          storageDeletionState: 'pending',
        },
      ],
    });
  });

  afterAll(async () => {
    if (db) {
      await db.client.file.deleteMany({ where: { userId: { in: users } } });
      await db.client.user.deleteMany({ where: { id: { in: users } } });
      await db.stop();
    }
  });

  function fixture(owner: string, index: number): Prisma.FileCreateManyInput {
    const format = index % 2 ? 'pdf' : 'png';
    return {
      userId: owner,
      objectKey: `cursor-regression/${randomUUID()}`,
      originalName: `${index % 3 ? 'ordinary' : 'Needle%_'}-${index}.${format}`,
      format,
      detectedMime: format === 'pdf' ? 'application/pdf' : 'image/png',
      sizeBytes: 100n,
      purpose: 'output',
      retention: 'saved',
      // Ties span multiple pages; nearby groups differ by only one millisecond.
      createdAt: new Date(Date.UTC(2026, 0, 1) + Math.floor(index / 37)),
    };
  }

  function ordered(input: File[], sort: 'newest' | 'oldest') {
    return [...input].sort((a, b) => {
      const comparison =
        a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return sort === 'oldest' ? comparison : -comparison;
    });
  }

  const cases = (['newest', 'oldest'] as const).flatMap((sort) =>
    [
      { sort },
      { sort, format: 'png' },
      { sort, search: 'needle%_' },
      { sort, search: 'needle%_', format: 'pdf' },
    ].map((query) => [JSON.stringify(query), query] as const),
  );

  it.each(cases)('visits every eligible file exactly once: %s', async (_name, query) => {
    const expected = ordered(
      rows.filter(
        (row) =>
          (!query.format || row.format === query.format) &&
          (!query.search || row.originalName.toLowerCase().includes(query.search)),
      ),
      query.sort,
    ).map((row) => row.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    let previousId: string | undefined;
    let pages = 0;
    do {
      const page = await files.list(userId, { ...query, limit: 7, ...(cursor ? { cursor } : {}) });
      const ids = page.items.map((row) => row.id);
      expect(ids).not.toContain(previousId);
      expect(ids.every((id) => !seen.includes(id))).toBe(true);
      seen.push(...ids);
      previousId = ids.at(-1);
      cursor = page.nextCursor ?? undefined;
      expect(++pages).toBeLessThan(100);
    } while (cursor);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(expected.length);
    if (!query.format && !query.search) expect(pages).toBe(46);
  });

  it.each(['newest', 'oldest'] as const)(
    'continues after deleting the cursor and a future file: %s',
    async (sort) => {
      const user = await db.client.user.create({
        data: { email: `${randomUUID()}@example.test`, passwordHash: 'synthetic' },
      });
      users.push(user.id);
      await db.client.file.createMany({
        data: Array.from({ length: 80 }, (_, index) => fixture(user.id, index)),
      });
      const expected = ordered(await db.client.file.findMany({ where: { userId: user.id } }), sort);
      const first = await files.list(user.id, { sort, limit: 7 });
      expect(first.items.map((row) => row.id)).toEqual(expected.slice(0, 7).map((row) => row.id));
      const removed = [expected[6]!.id, expected[10]!.id];
      await db.client.file.updateMany({
        where: { id: { in: removed } },
        data: { deletedAt: new Date(), storageDeletionState: 'pending' },
      });
      const seen = first.items.map((row) => row.id);
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await files.list(user.id, { sort, limit: 7, cursor });
        const ids = page.items.map((row) => row.id);
        expect(ids.some((id) => removed.includes(id) || seen.includes(id))).toBe(false);
        seen.push(...ids);
        cursor = page.nextCursor;
        expect(seen.length).toBeLessThanOrEqual(80);
      }
      expect(seen).toEqual(expected.filter((row) => row.id !== removed[1]).map((row) => row.id));
    },
  );

  it('keeps cursor validation and owner scoping for continuation requests', async () => {
    const first = await files.list(userId, { sort: 'newest', limit: 7 });
    expect(first.nextCursor).not.toBeNull();
    for (const query of [
      { sort: 'oldest', cursor: first.nextCursor },
      { search: 'needle%_', cursor: first.nextCursor },
      { format: 'pdf', cursor: first.nextCursor },
      { cursor: 'not-json' },
    ])
      await expect(files.list(userId, query)).rejects.toMatchObject({
        response: { error: { code: 'INVALID_QUERY' } },
      });
    const foreignPage = await files.list(otherId, { cursor: first.nextCursor });
    expect(foreignPage.items.every((row) => !rows.some((owned) => owned.id === row.id))).toBe(true);
  });
});
