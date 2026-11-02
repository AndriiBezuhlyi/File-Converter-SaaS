import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { NOTIFICATION_CONFIG, type NotificationConfig } from './notification-config.js';

const envelope = z.object({ iv: z.string(), tag: z.string(), ciphertext: z.string() }).strict();
export const deliverySchema = z
  .object({
    to: z.email(),
    token: z.string().min(1).max(200),
    tokenId: z.uuid(),
    purpose: z.enum(['email_verification', 'password_reset', 'email_change']),
  })
  .strict();
export type Delivery = z.infer<typeof deliverySchema>;

@Injectable()
export class NotificationCipher {
  private readonly key: Buffer;
  constructor(@Inject(NOTIFICATION_CONFIG) config: NotificationConfig) {
    this.key = Buffer.from(config.NOTIFICATION_ENCRYPTION_KEY, 'hex');
  }
  encrypt(id: string, delivery: Delivery) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`email_notification:v1:${id}`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(delivery), 'utf8'),
      cipher.final(),
    ]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }
  decrypt(id: string, input: unknown): Delivery {
    const data = envelope.parse(input);
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(data.iv, 'base64'));
    decipher.setAAD(Buffer.from(`email_notification:v1:${id}`));
    decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(data.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return deliverySchema.parse(JSON.parse(plaintext.toString('utf8')) as unknown);
  }
}
