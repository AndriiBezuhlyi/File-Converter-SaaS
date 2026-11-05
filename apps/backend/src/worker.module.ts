import { Module, type DynamicModule } from '@nestjs/common';
import { RuntimeConfigModule } from './infrastructure/config/runtime-config.module.js';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { WorkerHealth, WORKER_FEATURE_READINESS } from './infrastructure/health/worker-health.js';
import { NotificationWorkerModule } from './modules/notifications/notification-worker.module.js';
import { NotificationWorker } from './modules/notifications/notification-worker.js';
import { ConversionWorkerModule } from './modules/conversions/conversion-worker.module.js';
import { ConversionWorker } from './modules/conversions/conversion-worker.js';

@Module({ imports: [RuntimeConfigModule] })
export class WorkerModule {
  static withProcessors(): DynamicModule {
    return {
      module: WorkerModule,
      imports: [InfrastructureModule, NotificationWorkerModule, ConversionWorkerModule],
      providers: [
        WorkerHealth,
        {
          provide: WORKER_FEATURE_READINESS,
          inject: [NotificationWorker, ConversionWorker],
          useFactory: (notifications: NotificationWorker, conversions: ConversionWorker) => ({
            check: () => Promise.all([notifications.check(), conversions.check()]),
          }),
        },
      ],
    };
  }
  static withNotifications(): DynamicModule {
    return {
      ...this.withInfrastructure(),
      imports: [InfrastructureModule, NotificationWorkerModule],
      providers: [
        WorkerHealth,
        { provide: WORKER_FEATURE_READINESS, useExisting: NotificationWorker },
      ],
    };
  }
  static withInfrastructure(): DynamicModule {
    return { module: WorkerModule, imports: [InfrastructureModule], providers: [WorkerHealth] };
  }
}
