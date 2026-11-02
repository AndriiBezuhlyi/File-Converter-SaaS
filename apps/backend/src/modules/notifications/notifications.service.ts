import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import type { TokenPurpose } from '../../generated/prisma/enums.js';
import { NotificationCipher } from './notification-cipher.js';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class NotificationsService {
  constructor(private readonly cipher: NotificationCipher) {}
  async issue(tx: Prisma.TransactionClient, userId: string, purpose: TokenPurpose, to: string) {
    const now = new Date();
    // Callers hold the user lock. Replacing an intent and inserting its successor are atomic.
    await tx.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    const id = randomUUID();
    const taskId = randomUUID();
    const token = `${id}.${randomBytes(32).toString('base64url')}`;
    await tx.verificationToken.create({
      data: {
        id,
        userId,
        purpose,
        tokenHash: tokenHash(token),
        pendingEmail: purpose === 'email_change' ? to : null,
        expiresAt: new Date(
          now.getTime() + (purpose === 'email_verification' ? 24 * 60 * 60_000 : 30 * 60_000),
        ),
      },
    });
    await tx.backgroundTask.create({
      data: {
        id: taskId,
        type: 'email_notification',
        resourceId: id,
        deduplicationKey: `email:${id}`,
        payload: this.cipher.encrypt(taskId, { token, tokenId: id, purpose, to }),
      },
    });
  }
}
