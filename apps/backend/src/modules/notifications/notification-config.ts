import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { RuntimeConfigModule } from '../../infrastructure/config/runtime-config.module.js';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ORIGIN: z.string(),
    NOTIFICATION_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  })
  .superRefine((value, context) => {
    try {
      const url = new URL(value.APP_ORIGIN);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        url.origin !== value.APP_ORIGIN ||
        url.username ||
        url.password ||
        (url.protocol !== 'https:' &&
          !(value.NODE_ENV !== 'production' && local && url.protocol === 'http:'))
      )
        throw new Error();
    } catch {
      context.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'Invalid origin.' });
    }
  });
export type NotificationConfig = z.infer<typeof schema>;
export const NOTIFICATION_CONFIG = Symbol('NOTIFICATION_CONFIG');
export function validateNotificationConfig(input: Record<string, unknown>): NotificationConfig {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      'Invalid notification configuration: ' +
        [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', '),
    );
  return result.data;
}
@Module({
  imports: [RuntimeConfigModule],
  providers: [
    {
      provide: NOTIFICATION_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        validateNotificationConfig(
          Object.fromEntries(
            Object.keys(schema.shape).map((key) => [key, config.get<unknown>(key)]),
          ),
        ),
    },
  ],
  exports: [NOTIFICATION_CONFIG],
})
export class NotificationConfigModule {}
