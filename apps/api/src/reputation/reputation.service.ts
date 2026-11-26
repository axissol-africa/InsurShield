import { Injectable } from '@nestjs/common';
import { CertificateBadgesService } from '../certificate-badges/certificate-badges.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { RATING_METHOD, ratingAverage, windowStart } from './domain/ratings.js';
import { ReputationRepository } from './reputation.repository.js';

@Injectable()
export class ReputationService {
  constructor(
    private readonly repository: ReputationRepository,
    private readonly settings: SettingsService,
    private readonly certificates: CertificateBadgesService,
  ) {}

  publicList(insurerIds: readonly string[], asOf = new Date()) {
    return this.repository.snapshot(async (tx) => {
      const policy = await this.settings.effective('REPUTATION_POLICY', asOf, tx);
      if (policy.provisional || policy.version === null) return { items: [] };
      const ruleVersion = policy.version;
      const visible = await this.repository.visibleInsurers(tx, insurerIds, asOf);
      if (!visible.length) return { items: [] };

      const reviewPolicy = await this.settings.effective('REVIEW_POLICY', asOf, tx);
      const { ratingWindowDays, minimumReviews } = policy.value;
      const start = windowStart(asOf, ratingWindowDays);
      const ids = visible.map(({ insurerId }) => insurerId);
      const badgeIds = visible.filter(({ badgeEligible }) => badgeEligible).map(({ insurerId }) => insurerId);
      const ratings = reviewPolicy.provisional ? [] : await this.repository.publishedRatings(tx, ids, start, asOf);
      const badges = badgeIds.length ? await this.certificates.publicBadges(badgeIds, ruleVersion, asOf, tx) : [];
      const ratingsByInsurer = new Map(ratings.map((rating) => [rating.insurerId, rating]));
      const badgesByInsurer = new Map(badges.map((badge) => [badge.insurerId, badge]));
      const visibleIds = new Set(ids);

      return {
        items: insurerIds.filter((insurerId) => visibleIds.has(insurerId)).map((insurerId) => {
          const { reviewCount = 0, totalStars = 0 } = ratingsByInsurer.get(insurerId) ?? {};
          const badge = badgesByInsurer.get(insurerId);
          return {
            insurerId,
            rating: reviewPolicy.provisional ? null : {
              average: ratingAverage(totalStars, reviewCount, minimumReviews),
              reviewCount,
              minimumReviews,
              periodStart: start.toISOString(),
              periodEnd: asOf.toISOString(),
              method: RATING_METHOD,
              ruleVersion,
            },
            badges: badge ? [badge] : [],
          };
        }),
      };
    });
  }
}
