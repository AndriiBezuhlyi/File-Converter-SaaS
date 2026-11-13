import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import type { File } from '../../generated/prisma/client.js';
import type { DatabaseService } from '../../infrastructure/database/database.service.js';
import type { StorageService } from '../../infrastructure/storage/storage.service.js';
import { FilesService } from './files.service.js';

function fixture() {
  const file = {
    id: randomUUID(),
    userId: randomUUID(),
    guestSessionId: null,
    objectKey: 'outputs/opaque',
    originalName: 'Зображення.png',
    format: 'png',
    sizeBytes: 42n,
    detectedMime: 'image/png',
    purpose: 'output',
    retention: 'saved',
    deletedAt: null,
    expiresAt: null,
    storageDeletionState: 'present',
    createdAt: new Date('2026-11-13T10:00:00Z'),
    updatedAt: new Date(),
    storageDeletedAt: null,
  } satisfies File;
  const findFirst = jest.fn<() => Promise<File | null>>().mockResolvedValue(file);
  const updateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
  const findMany = jest
    .fn<() => Promise<File[]>>()
    .mockResolvedValue(Array.from({ length: 11 }, () => ({ ...file, id: randomUUID() })));
  const get = jest
    .fn<() => Promise<{ body: Buffer }>>()
    .mockResolvedValue({ body: Buffer.from('synthetic') });
  const service = new FilesService(
    { client: { file: { findFirst, updateMany, findMany } } } as unknown as DatabaseService,
    { get } as unknown as StorageService,
  );
  return { file, service, findFirst, updateMany, findMany, get };
}
it('defaults to ten records and carries the date/id cursor even if its row is deleted', async () => {
  const { service, file, findMany } = fixture();
  const page = await service.list(file.userId, {});
  expect(page.items).toHaveLength(10);
  expect(page.nextCursor).not.toBeNull();
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 11 }));
  await service.list(file.userId, { cursor: page.nextCursor });
  expect(findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        userId: file.userId,
        deletedAt: null,
        AND: {
          OR: [
            { createdAt: { lt: file.createdAt } },
            { createdAt: file.createdAt, id: { lt: page.items[9]!.id } },
          ],
        },
      }) as unknown,
    }),
  );
  await expect(
    service.list(file.userId, { cursor: page.nextCursor, search: 'changed' }),
  ).rejects.toMatchObject({ status: 400 });
});
it.each(['Новий файл.png', 'café été.png', 'two spaces name.png', 'Фото 東京 résumé.png'])(
  'renames only owned visible filename metadata: %s',
  async (name) => {
    const { service, file, updateMany, get, findFirst } = fixture();
    const result = await service.rename(file.userId, file.id, { name });
    expect(result.name).toBe(name);
    expect(findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: file.id,
        userId: file.userId,
        guestSessionId: null,
        purpose: 'output',
        retention: 'saved',
      }) as unknown,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: file.id,
        userId: file.userId,
        deletedAt: null,
        storageDeletionState: 'present',
        expiresAt: null,
      }) as unknown,
      data: { originalName: name },
    });
    file.originalName = name;
    expect((await service.download(file.userId, file.id)).name).toBe(name);
    expect(get).toHaveBeenCalledWith('outputs/opaque');
  },
);
it.each([
  'evil.jpg',
  '../evil.png',
  'bad\r\nHeader.png',
  'bad\u202efile.png',
  '.png',
  '..png',
  'bad?.png',
  'bad .png',
  'x'.repeat(200) + '.png',
  '\ud800.png',
])('rejects unsafe names and extension changes without writes', async (name) => {
  const { service, file, updateMany } = fixture();
  await expect(service.rename(file.userId, file.id, { name })).rejects.toMatchObject({
    status: 400,
  });
  expect(updateMany).not.toHaveBeenCalled();
});
it('denies foreign, deleted and concurrently deleted files', async () => {
  const { service, file, findFirst, updateMany } = fixture();
  findFirst.mockResolvedValueOnce(null);
  await expect(service.rename(randomUUID(), file.id, { name: 'safe.png' })).rejects.toMatchObject({
    status: 404,
  });
  findFirst.mockResolvedValueOnce({ ...file, deletedAt: new Date() });
  await expect(service.rename(file.userId, file.id, { name: 'safe.png' })).rejects.toMatchObject({
    status: 410,
  });
  expect(updateMany).not.toHaveBeenCalled();
  updateMany.mockResolvedValueOnce({ count: 0 });
  findFirst.mockResolvedValueOnce(file).mockResolvedValueOnce({ ...file, deletedAt: new Date() });
  await expect(service.rename(file.userId, file.id, { name: 'safe.png' })).rejects.toMatchObject({
    status: 410,
  });
});
