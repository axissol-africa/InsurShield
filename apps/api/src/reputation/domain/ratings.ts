const DAY_MS = 86_400_000;

export const RATING_METHOD = 'Equal-weight mean of the current published ratings on verified policy reviews, grouped by original submission date.';

export function windowStart(end: Date, days: number): Date {
  return new Date(end.getTime() - days * DAY_MS);
}

export function ratingAverage(totalStars: number, reviewCount: number, minimumReviews: number): number | null {
  if (reviewCount === 0 || reviewCount < minimumReviews) return null;
  return Math.round(10 * totalStars / reviewCount) / 10;
}
