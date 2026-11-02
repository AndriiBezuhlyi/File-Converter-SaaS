import { Module } from '@nestjs/common';
import { NotificationConfigModule } from './notification-config.js';
import { NotificationCipher } from './notification-cipher.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [NotificationConfigModule],
  providers: [NotificationCipher, NotificationsService],
  exports: [NotificationsService, NotificationCipher, NotificationConfigModule],
})
export class NotificationsModule {}
