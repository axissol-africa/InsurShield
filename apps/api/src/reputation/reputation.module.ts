import { Module } from '@nestjs/common';
import { CertificateBadgesModule } from '../certificate-badges/certificate-badges.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ReputationController } from './reputation.controller.js';
import { ReputationRepository } from './reputation.repository.js';
import { ReputationService } from './reputation.service.js';

@Module({
  imports: [SettingsModule, CertificateBadgesModule],
  controllers: [ReputationController],
  providers: [ReputationRepository, ReputationService],
})
export class ReputationModule {}
