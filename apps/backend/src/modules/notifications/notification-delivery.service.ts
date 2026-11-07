import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../infrastructure/database/database.service.js';
import { EmailService } from '../../infrastructure/email/email.service.js';
import { NotificationCipher } from './notification-cipher.js';
import { NOTIFICATION_CONFIG, type NotificationConfig } from './notification-config.js';

@Injectable()
export class NotificationDeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly email: EmailService,
    private readonly cipher: NotificationCipher,
    @Inject(NOTIFICATION_CONFIG) private readonly config: NotificationConfig,
  ) {}
  async deliver(id: string) {
    const db = this.database.client;
    const lease = randomUUID();
    const now = new Date();
    const claimed = await db.backgroundTask.updateMany({
      where: {
        id,
        type: 'email_notification',
        completedAt: null,
        availableAt: { lte: now },
        attempts: { lt: 5 },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        leaseToken: lease,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) return;
    const task = await db.backgroundTask.findUniqueOrThrow({ where: { id } });
    try {
      if (task.payloadVersion !== 1) throw new Error('Unsupported notification version.');
      const delivery = this.cipher.decrypt(task.id, task.payload);
      const token = await db.verificationToken.findUnique({ where: { id: delivery.tokenId } });
      if (
        token &&
        token.id === task.resourceId &&
        token.purpose === delivery.purpose &&
        !token.consumedAt &&
        token.expiresAt > new Date() &&
        token.attempts < 5
      ) {
        const route = delivery.purpose === 'password_reset' ? '/reset-password' : '/verify-email';
        const link = new URL(route, this.config.APP_ORIGIN);
        // Fragments are never sent to HTTP servers, proxies or access logs.
        link.hash = new URLSearchParams({ token: delivery.token }).toString();
        const subject =
          delivery.purpose === 'password_reset'
            ? 'Reset your Flux Converter password'
            : 'Confirm your Flux Converter email';
        await this.email.send({
          to: delivery.to,
          subject,
          text: `${subject}\n\n${link.toString()}\n\nThis link expires at ${token.expiresAt.toISOString()}. If you did not request this, ignore this email.`,
        });
      }
      await db.backgroundTask.updateMany({
        where: { id, leaseToken: lease, leaseExpiresAt: { gt: new Date() } },
        data: {
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          payload: {},
          lastErrorCode: null,
        },
      });
    } catch {
      await db.backgroundTask.updateMany({
        where: { id, leaseToken: lease, leaseExpiresAt: { gt: new Date() } },
        data: {
          leaseToken: null,
          leaseExpiresAt: null,
          availableAt: new Date(Date.now() + Math.min(30_000 * 2 ** task.attempts, 15 * 60_000)),
          lastErrorCode: 'EMAIL_DELIVERY_FAILED',
        },
      });
      // Queue failure text is deliberately generic; the durable intent owns bounded retries.
      throw new Error('Notification delivery failed.');
    }
  }
}
