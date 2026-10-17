import { defineConfig } from 'prisma/config';
import { resolve } from 'node:path';
import { config } from 'dotenv';

config({
  path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
  quiet: true,
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Validation/generation do not connect; deployments must provide a real DATABASE_URL.
    url:
      process.env.DATABASE_URL ??
      'postgresql://converter:converter-local-only@127.0.0.1:5432/converter',
  },
});
