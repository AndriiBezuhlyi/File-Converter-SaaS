import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';
import type { File, Prisma } from '../../generated/prisma/client.js';
import { AuthError } from '../auth/auth-error.js';

const querySchema = z
  .object({
    search: z.string().trim().max(200).default(''),
    format: z.enum(['jpg', 'png', 'webp', 'avif', 'pdf']).optional(),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(2048).optional(),
  })
  .strict();
const cursorSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    search: z.string(),
    format: z.string().nullable(),
    sort: z.enum(['newest', 'oldest']),
  })
  .strict();
const missing = () => new AuthError(404, 'NOT_FOUND', 'File not found.');
const invalid = () => new AuthError(400, 'INVALID_QUERY', 'Invalid file query or cursor.');
const visible = (userId: string): Prisma.FileWhereInput => ({
  userId,
  guestSessionId: null,
  purpose: 'output',
  retention: 'saved',
});
export const describeFile = (file: File) => ({
  id: file.id,
  name: file.originalName,
  format: file.format,
  sizeBytes: Number(file.sizeBytes),
  createdAt: file.createdAt.toISOString(),
  retention: file.retention,
  expiresAt: file.expiresAt?.toISOString() ?? null,
});

@Injectable()
export class FilesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
  ) {}
  async list(userId: string, raw: unknown) {
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) throw invalid();
    const query = parsed.data;
    let boundary: Prisma.FileWhereInput = {};
    if (query.cursor) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      } catch {
        throw invalid();
      }
      const cursor = cursorSchema.safeParse(decoded);
      if (
        !cursor.success ||
        cursor.data.search !== query.search ||
        cursor.data.format !== (query.format ?? null) ||
        cursor.data.sort !== query.sort
      )
        throw invalid();
      const date = new Date(cursor.data.createdAt);
      const comparison = query.sort === 'newest' ? 'lt' : 'gt';
      boundary = {
        OR: [
          { createdAt: { [comparison]: date } },
          { createdAt: date, id: { [comparison]: cursor.data.id } },
        ],
      };
    }
    const rows = await this.database.client.file.findMany({
      where: {
        ...visible(userId),
        deletedAt: null,
        storageDeletionState: 'present',
        expiresAt: null,
        ...(query.format ? { format: query.format } : {}),
        ...(query.search
          ? {
              originalName: {
                contains: query.search.replace(/[\\%_]/g, '\\$&'),
                mode: 'insensitive' as const,
              },
            }
          : {}),
        AND: boundary,
      },
      orderBy: [
        { createdAt: query.sort === 'newest' ? 'desc' : 'asc' },
        { id: query.sort === 'newest' ? 'desc' : 'asc' },
      ],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(describeFile),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(
              JSON.stringify({
                id: last.id,
                createdAt: last.createdAt.toISOString(),
                search: query.search,
                format: query.format ?? null,
                sort: query.sort,
              }),
            ).toString('base64url')
          : null,
    };
  }
  private async owned(userId: string, id: string) {
    if (!z.uuid().safeParse(id).success) throw missing();
    const file = await this.database.client.file.findFirst({ where: { id, ...visible(userId) } });
    if (!file) throw missing();
    if (
      file.deletedAt ||
      file.storageDeletionState !== 'present' ||
      (file.expiresAt && file.expiresAt <= new Date())
    )
      throw new AuthError(410, 'RESULT_UNAVAILABLE', 'File is no longer available.');
    return file;
  }
  async details(userId: string, id: string) {
    return describeFile(await this.owned(userId, id));
  }
  async download(userId: string, id: string) {
    const file = await this.owned(userId, id);
    return {
      ...(await this.storage.get(file.objectKey)),
      name: file.originalName,
      mime: file.detectedMime,
      size: Number(file.sizeBytes),
    };
  }
  async delete(userId: string, id: string) {
    if (!z.uuid().safeParse(id).success) throw missing();
    await this.database.client.$transaction(async (tx) => {
      const file = await tx.file.findFirst({ where: { id, ...visible(userId) } });
      if (!file) throw missing();
      if (file.storageDeletionState === 'deleted') return;
      await tx.file.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date(), storageDeletionState: 'pending' },
      });
      await tx.backgroundTask.upsert({
        where: { deduplicationKey: `delete:${id}` },
        create: { type: 'file_deletion', resourceId: id, deduplicationKey: `delete:${id}` },
        update: { completedAt: null },
      });
    });
  }
}
