import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminReviewAppealsController, CustomerReviewAppealsController, InsurerReviewAppealsController } from './review-appeals.controller.js';
import { ReviewAppealsRepository } from './review-appeals.repository.js';
import { ReviewAppealsService } from './review-appeals.service.js';

@Module({ imports: [SettingsModule], controllers: [CustomerReviewAppealsController, InsurerReviewAppealsController, AdminReviewAppealsController], providers: [ReviewAppealsRepository, ReviewAppealsService], exports: [ReviewAppealsService] })
export class ReviewAppealsModule {}
