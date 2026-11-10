import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../jobs/job-runner.service.js';
import { NOTIFICATION_EMAIL, NotificationsService } from './notifications.service.js';
import { NotificationsRepository } from './notifications.repository.js';

@Global()
@Module({
  providers: [NotificationsRepository, NotificationsService],
  exports: [NotificationsRepository, NotificationsService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly notifications: NotificationsService,
  ) {}

  /** The module that owns a job kind registers its handler; it starts no runner. */
  onModuleInit(): void {
    this.runner.register(NOTIFICATION_EMAIL, (job) =>
      this.notifications.deliver(job.payload.notificationId as string),
    );
  }
}
