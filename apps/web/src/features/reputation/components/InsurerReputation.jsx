import { ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/primitives/collapsible';
import { useInsurerReputation } from '../hooks/useInsurerReputation';

const date = (value) => new Date(value).toLocaleDateString('en-GB', { timeZone: 'Africa/Lusaka' });
const ratingText = (rating) => rating?.average == null
  ? `Not enough reviews for a rating yet · ${rating.reviewCount} verified reviews`
  : `${rating.average.toFixed(1)} out of 5 · ${rating.reviewCount} verified reviews`;

export function ReputationSummary({ reputation }) {
  if (!reputation || (!reputation.rating && !reputation.badges.length)) return null;
  return <div className="mt-2 space-y-2 text-sm">
    {reputation.rating && <p>{ratingText(reputation.rating)}</p>}
    {reputation.badges.map((badge) => (
      <Collapsible key={badge.code}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="group h-auto min-h-8 max-w-full whitespace-normal text-left">
            {badge.label}
            <ChevronDown aria-hidden="true" className="shrink-0 group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 rounded-lg border border-border p-3">
          <BadgeEvidence badge={badge} />
        </CollapsibleContent>
      </Collapsible>
    ))}
  </div>;
}

export function InsurerReputation({ insurerId }) {
  const { items, loading, error } = useInsurerReputation([insurerId]);
  const reputation = items.find((item) => item.insurerId.toLowerCase() === insurerId.toLowerCase());
  const rating = reputation?.rating;
  return <Card id="reputation"><CardHeader><CardTitle><h2>Ratings and performance</h2></CardTitle></CardHeader>
    <CardContent className="space-y-5 break-words text-sm">
      {loading ? <p role="status">Loading ratings and performance…</p> : error ? <p>Ratings and performance are temporarily unavailable. You can still explore cover.</p> : !reputation || (!rating && !reputation.badges.length) ? <p>No published ratings or performance badges are available.</p> : <>
        {rating && <section className="space-y-2" aria-label="Verified review rating">
          <p className="font-medium">{ratingText(rating)}</p>
          <p>An average is published once there are at least {rating.minimumReviews} verified reviews.</p>
          <p>Review period: {date(rating.periodStart)} – {date(rating.periodEnd)}.</p>
          <p>Method: {rating.method} · Rule version {rating.ruleVersion}.</p>
        </section>}
        {reputation.badges.map((badge) => <section key={badge.code} className="space-y-2 border-t border-border pt-4" aria-label={badge.label}>
          <Badge variant="secondary" className="max-w-full whitespace-normal">{badge.label}</Badge>
          <BadgeEvidence badge={badge} />
        </section>)}
      </>}
    </CardContent>
  </Card>;
}

function BadgeEvidence({ badge }) {
  return (
    <div className="space-y-2 break-words">
      <p>{badge.onTimeCount} of {badge.sampleCount} eligible policies had certificates issued on time ({badge.percentage}%).</p>
      <p>Qualification threshold: {badge.thresholdBps / 100}%; minimum sample: {badge.minimumPolicies} policies.</p>
      <p>Measurement period: {date(badge.periodStart)} – {date(badge.periodEnd)}.</p>
      <p>Awarded: {date(badge.awardedAt)} · Expires: {date(badge.expiresAt)}.</p>
      <p>Method: {badge.method} · Rule version {badge.ruleVersion}.</p>
      <p>Data source: {badge.dataSource}</p>
      <p className="text-muted-foreground">{badge.disclaimer}</p>
    </div>
  );
}
