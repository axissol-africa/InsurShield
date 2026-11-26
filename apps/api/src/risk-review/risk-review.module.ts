import { Module } from '@nestjs/common';
import { RiskReviewController } from './risk-review.controller.js';
import { RiskReviewRepository } from './risk-review.repository.js';
import { RiskReviewService } from './risk-review.service.js';
@Module({ controllers: [RiskReviewController], providers: [RiskReviewRepository, RiskReviewService] })
export class RiskReviewModule {}
