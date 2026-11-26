import { Module } from '@nestjs/common';
import {
  AdminPrivacyReviewController,
  CustomerPrivacyReviewController,
} from './privacy-review.controller.js';
import { PrivacyReviewRepository } from './privacy-review.repository.js';
import { PrivacyReviewService } from './privacy-review.service.js';
@Module({
  controllers: [AdminPrivacyReviewController, CustomerPrivacyReviewController],
  providers: [PrivacyReviewRepository, PrivacyReviewService],
  exports: [PrivacyReviewService],
})
export class PrivacyReviewModule {}
