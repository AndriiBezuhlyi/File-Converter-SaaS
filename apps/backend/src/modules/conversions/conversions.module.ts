import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { rmdir, readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { UPLOAD_STAGING_DIRECTORY } from './upload-staging.js';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { QueueModule } from '../../infrastructure/queue/queue.module.js';
import { AuthSecurityModule } from '../auth/auth-security.module.js';
import { GuestModule } from '../auth/guest/guest.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { ConversionBoundaryGuard, ConversionSessionMiddleware } from './conversion-boundary.js';
import {
  ConversionAdmissionGuard,
  ConversionCapabilitiesController,
  ConversionsController,
} from './conversions.controller.js';
import { ConversionsService } from './conversions.service.js';
import { UploadBudgetInterceptor } from './upload-budget.interceptor.js';

@Module({
  imports: [
    DatabaseModule,
    StorageModule,
    QueueModule,
    AuthSecurityModule,
    GuestModule,
    ApiKeysModule,
  ],
  controllers: [ConversionsController, ConversionCapabilitiesController],
  providers: [
    UploadBudgetInterceptor,
    ConversionsService,
    ConversionBoundaryGuard,
    ConversionSessionMiddleware,
    ConversionAdmissionGuard,
  ],
})
export class ConversionsModule implements NestModule, OnModuleDestroy, OnModuleInit {
  private cleanupTimer?: ReturnType<typeof setTimeout>;
  private cleanupPending?: Promise<void>;
  private stopping = false;
  async onModuleInit() {
    await this.cleanupStaging();
  }
  private async cleanupStaging() {
    this.cleanupPending = (async () => {
      const root = resolve(tmpdir());
      for (const entry of await readdir(root, { withFileTypes: true })) {
        const match = /^converter-upload-(\d+)-[a-zA-Z0-9]+$/.exec(entry.name);
        if (!entry.isDirectory() || !match) continue;
        try {
          process.kill(Number(match[1]), 0);
          continue;
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') continue;
        }
        const path = resolve(root, entry.name);
        if (!path.startsWith(root + sep)) continue;
        const stat = await lstat(path).catch(() => null);
        if (stat && !stat.isSymbolicLink() && stat.mtimeMs < Date.now() - 3_600_000)
          await rm(path, { recursive: true, force: true });
      }
    })();
    try {
      await this.cleanupPending;
    } finally {
      if (!this.stopping)
        this.cleanupTimer = setTimeout(() => {
          void this.cleanupStaging().catch(() => undefined);
        }, 60_000);
    }
  }
  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.cleanupTimer);
    await this.cleanupPending;
    await rmdir(UPLOAD_STAGING_DIRECTORY).catch(() => undefined);
  }
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ConversionSessionMiddleware).forRoutes(ConversionsController);
  }
}
