import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import { z } from 'zod';
import { RuntimeConfigModule } from '../../infrastructure/config/runtime-config.module.js';

const schema = z.object({
  SESSION_SECRET: z.string().regex(/^[a-fA-F0-9]{64}$/),
  AUTH_TRUSTED_PROXIES: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .refine((values) =>
      values.every((value) => {
        const [ip, mask, extra] = value.split('/');
        const version = isIP(ip ?? '');
        return (
          !extra &&
          Boolean(version) &&
          (mask === undefined ||
            (/^\d+$/.test(mask) && Number(mask) > 0 && Number(mask) <= (version === 4 ? 32 : 128)))
        );
      }),
    ),
});
export type AuthConfig = z.infer<typeof schema>;
export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
export const ANONYMOUS_TTL_MS = 15 * 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60_000;
export function validateAuthConfig(input: Record<string, unknown>): AuthConfig {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      'Invalid authentication configuration: ' +
        [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', '),
    );
  return result.data;
}
@Module({
  imports: [RuntimeConfigModule],
  providers: [
    {
      provide: AUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        validateAuthConfig(
          Object.fromEntries(
            Object.keys(schema.shape).map((key) => [key, config.get<unknown>(key)]),
          ),
        ),
    },
  ],
  exports: [AUTH_CONFIG],
})
export class AuthConfigModule {}
