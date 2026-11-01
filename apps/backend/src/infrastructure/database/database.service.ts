import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { INFRA_CONFIG, type InfrastructureEnvironment } from '../config/infrastructure-config.js';
import type { InfrastructureDependency } from '../dependency.js';

@Injectable()
export class DatabaseService implements InfrastructureDependency {
  readonly pool: Pool;
  readonly client: PrismaClient;

  constructor(@Inject(INFRA_CONFIG) config: InfrastructureEnvironment) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      connectionTimeoutMillis: config.INFRA_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
      statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
      idle_in_transaction_session_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
    });
    this.pool.on('error', () => Logger.warn('Database connection unavailable.', 'DatabaseService'));
    this.client = new PrismaClient({
      adapter: new PrismaPg(this.pool, { disposeExternalPool: false }),
      log: [],
    });
  }

  async start() {
    await this.client.$connect();
    await this.check();
  }
  async check() {
    await this.client.$queryRaw`SELECT 1`;
  }
  async stop() {
    try {
      await this.client.$disconnect();
    } finally {
      await this.pool.end();
    }
  }
}
