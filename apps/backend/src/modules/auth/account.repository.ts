import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '../../generated/prisma/client.js';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { AuthError } from './auth-error.js';
import type { ProfileDto } from './auth.dto.js';

export const profile = (user: User): ProfileDto => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName ?? '',
});
export const isUniqueConflict = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'P2002';

@Injectable()
export class AccountRepository {
  constructor(readonly database: DatabaseService) {}
  get client() {
    return this.database.client;
  }
  transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.client.$transaction(work, { maxWait: 2_000, timeout: 5_000 });
  }
  async lock(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id}::uuid FOR UPDATE`;
    return tx.user.findUnique({ where: { id } });
  }
  async confirmed(tx: Prisma.TransactionClient, snapshot: User) {
    const user = await this.lock(tx, snapshot.id);
    if (
      !user ||
      user.passwordHash !== snapshot.passwordHash ||
      user.sessionVersion !== snapshot.sessionVersion
    )
      throw new AuthError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    return user;
  }
  async invalidate(tx: Prisma.TransactionClient, id: string) {
    await tx.verificationToken.updateMany({
      where: { userId: id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
}
