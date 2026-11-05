import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { RuntimeConfigModule } from '../../../infrastructure/config/runtime-config.module.js';

export const GUEST_RESULT_WINDOW_MS = 60 * 60_000;
export const GUEST_ADMISSION_WINDOW_MS = 2 * GUEST_RESULT_WINDOW_MS;
const schema = z.object({
  GUEST_CREDENTIAL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(10_800)
    .max(31_536_000)
    .default(2_592_000),
});
export type GuestConfig = z.infer<typeof schema>;
export const GUEST_CONFIG = Symbol('GUEST_CONFIG');
export function validateGuestConfig(input: Record<string, unknown>): GuestConfig {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error('Invalid guest configuration: GUEST_CREDENTIAL_TTL_SECONDS');
  return result.data;
}
@Module({
  imports: [RuntimeConfigModule],
  providers: [
    {
      provide: GUEST_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        validateGuestConfig({
          GUEST_CREDENTIAL_TTL_SECONDS: config.get<unknown>('GUEST_CREDENTIAL_TTL_SECONDS'),
        }),
    },
  ],
  exports: [GUEST_CONFIG],
})
export class GuestConfigModule {}
