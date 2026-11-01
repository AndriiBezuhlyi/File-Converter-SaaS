import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { RuntimeConfigModule } from './runtime-config.module.js';

const boolean = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
]);
const milliseconds = z.coerce.number().int().min(100).max(120_000);
const safeUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};
const connectionUrl = (protocols: string[]) =>
  z.string().refine((value) => {
    try {
      const url = new URL(value);
      return protocols.includes(url.protocol) && Boolean(url.hostname) && !url.hash;
    } catch {
      return false;
    }
  });

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    DATABASE_URL: connectionUrl(['postgres:', 'postgresql:']),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(5),
    DATABASE_STATEMENT_TIMEOUT_MS: milliseconds.default(10_000),
    REDIS_URL: connectionUrl(['redis:', 'rediss:']).refine((value) => {
      const url = safeUrl(value);
      return Boolean(url && !url.search && /^\/(?:\d+)?$/.test(url.pathname || '/'));
    }),
    REDIS_NAMESPACE: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .default('converter'),
    S3_ENDPOINT: connectionUrl(['http:', 'https:']).refine((value) => {
      const url = safeUrl(value);
      return Boolean(
        url && !url.username && !url.password && !url.search && ['/', ''].includes(url.pathname),
      );
    }),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: boolean.default(false),
    SMTP_HOST: z.string().regex(/^[a-zA-Z0-9.:[\]_-]+$/),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_FROM: z.email(),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_SECURE: boolean.default(false),
    SMTP_REQUIRE_TLS: boolean.default(true),
    INFRA_TIMEOUT_MS: milliseconds.default(5_000),
    HEALTH_CHECK_INTERVAL_MS: milliseconds.default(5_000),
    SHUTDOWN_TIMEOUT_MS: milliseconds.default(20_000),
    WORKER_TEMP_DIR: z.string().refine(isAbsolute).default(join(tmpdir(), 'converter')),
  })
  .superRefine((value, context) => {
    const issue = (key: keyof typeof value) =>
      context.addIssue({ code: 'custom', path: [key], message: 'Invalid configuration.' });
    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) issue('SMTP_PASSWORD');
    if (value.NODE_ENV === 'production') {
      if (!value.S3_ENDPOINT.startsWith('https:')) issue('S3_ENDPOINT');
      if (!value.SMTP_SECURE && !value.SMTP_REQUIRE_TLS) issue('SMTP_REQUIRE_TLS');
      if (!safeUrl(value.REDIS_URL)?.password) issue('REDIS_URL');
      for (const key of [
        'DATABASE_URL',
        'REDIS_URL',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
        'SMTP_PASSWORD',
      ] as const)
        if (value[key].includes('local-only') || value[key] === 'converter-local') issue(key);
    }
  });

export type InfrastructureEnvironment = z.infer<typeof schema>;
export const INFRA_CONFIG = Symbol('INFRA_CONFIG');

export function validateInfrastructureEnvironment(
  input: Record<string, unknown>,
): InfrastructureEnvironment {
  const local =
    input.NODE_ENV !== 'production'
      ? {
          DATABASE_URL: 'postgresql://converter:converter-local-only@127.0.0.1:5432/converter',
          REDIS_URL: 'redis://127.0.0.1:6379',
          S3_ENDPOINT: 'http://127.0.0.1:9000',
          S3_REGION: 'us-east-1',
          S3_BUCKET: 'converter-local',
          S3_ACCESS_KEY_ID: 'converter-local',
          S3_SECRET_ACCESS_KEY: 'converter-local-only',
          S3_FORCE_PATH_STYLE: true,
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: 1025,
          SMTP_FROM: 'converter@example.test',
          SMTP_REQUIRE_TLS: false,
        }
      : {};
  const supplied = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = schema.safeParse({ NODE_ENV: 'development', ...local, ...supplied });
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error('Invalid infrastructure configuration: ' + keys.join(', '));
  }
  return result.data;
}

@Module({
  imports: [RuntimeConfigModule],
  providers: [
    {
      provide: INFRA_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        validateInfrastructureEnvironment(
          Object.fromEntries(
            Object.keys(schema.shape).map((key) => [key, config.get<unknown>(key)]),
          ),
        ),
    },
  ],
  exports: [INFRA_CONFIG],
})
export class InfrastructureConfigModule {}
