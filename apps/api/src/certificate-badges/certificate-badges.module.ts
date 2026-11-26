import { Module, type OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../jobs/job-runner.service.js';
import { SettingsModule } from '../settings/settings.module.js';
import { CertificateBadgesController } from './certificate-badges.controller.js';
import { CERTIFICATE_BADGES_CALCULATE, CertificateBadgesJobs } from './certificate-badges.jobs.js';
import { CertificateBadgesRepository } from './certificate-badges.repository.js';
import { CertificateBadgesService } from './certificate-badges.service.js';

@Module({
  imports: [SettingsModule], controllers: [CertificateBadgesController],
  providers: [CertificateBadgesRepository, CertificateBadgesService, CertificateBadgesJobs],
  exports: [CertificateBadgesService],
})
export class CertificateBadgesModule implements OnModuleInit {
  constructor(private readonly runner: JobRunner, private readonly jobs: CertificateBadgesJobs) {}
  onModuleInit(): void {
    this.runner.register(CERTIFICATE_BADGES_CALCULATE, () => this.jobs.run());
    this.runner.onStart(() => this.jobs.schedule(new Date()));
  }
}
