import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module.js';
import { NotificationsModule } from './notifications.module.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationWorker } from './notification-worker.js';

@Module({
  imports: [InfrastructureModule, NotificationsModule],
  providers: [NotificationDeliveryService, NotificationWorker],
  exports: [NotificationWorker],
})
export class NotificationWorkerModule {}
