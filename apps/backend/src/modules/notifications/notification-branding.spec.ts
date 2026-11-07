import { jest } from '@jest/globals';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseService } from '../../infrastructure/database/database.service.js';
import type { EmailService } from '../../infrastructure/email/email.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationCipher, type Delivery } from './notification-cipher.js';
import { validateNotificationConfig } from './notification-config.js';

it.each([
  ['email_verification', 'Confirm your Flux Converter email', '/verify-email'],
  ['password_reset', 'Reset your Flux Converter password', '/reset-password'],
  ['email_change', 'Confirm your Flux Converter email', '/verify-email'],
] as const)(
  'brands the %s notification without changing its protected link',
  async (purpose, subject, route) => {
    const config = validateNotificationConfig({
      NODE_ENV: 'test',
      APP_ORIGIN: 'https://clarity.example.test',
      NOTIFICATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    });
    const cipher = new NotificationCipher(config);
    const id = randomUUID();
    const tokenId = randomUUID();
    const delivery: Delivery = {
      to: 'owned@example.test',
      token: 'owned-synthetic-token',
      tokenId,
      purpose,
    };
    const database = {
      client: {
        backgroundTask: {
          updateMany: jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockReturnValue({
            id,
            resourceId: tokenId,
            payloadVersion: 1,
            payload: cipher.encrypt(id, delivery),
          }),
        },
        verificationToken: {
          findUnique: jest.fn().mockReturnValue({
            id: tokenId,
            purpose,
            consumedAt: null,
            attempts: 0,
            expiresAt: new Date(Date.now() + 60_000),
          }),
        },
      },
    };
    const email = { send: jest.fn<EmailService['send']>().mockResolvedValue(undefined) };
    await new NotificationDeliveryService(
      database as unknown as DatabaseService,
      email as unknown as EmailService,
      cipher,
      config,
    ).deliver(id);
    expect(email.send).toHaveBeenCalledTimes(1);
    const message = email.send.mock.calls[0]![0];
    expect(message.subject).toBe(subject);
    expect(message.text).toContain(subject);
    expect(message.text).toContain(`${config.APP_ORIGIN}${route}#token=owned-synthetic-token`);
    expect(message.text).not.toContain('?token=');
  },
);
