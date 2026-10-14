import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore, selectActiveQuoteRequest } from '@/store';
import { insurerReceivesRequests, needsCoverGuideSelection } from '@/store/shared';
import { env } from '@/config/env';
import { hydrateCustomer, hydrateDirectory } from '@/api/sync';
import { calculatePremium, formatZMW, formatDate } from '@/domain/premiumEngine';
import { sameInsurerName } from '@/domain/insurers';
import { quoteValidity, requestStatus } from '@/domain/quoteValidity';
import { coverPeriod } from '@/domain/coverPeriod';
import { openDocument } from '@/lib/files';
import CoverGuideDocument from '@/components/cover-guide/CoverGuideDocument';
import { COVER_TYPE_LABELS, asLines, isCoverGuideComplete } from '@/domain/coverGuide';
import JourneyLayout from '@/features/quote-journey/components/JourneyLayout';
import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/primitives/card';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/primitives/collapsible';
import { ChevronDown } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/primitives/alert';
import { Checkbox } from '@/components/ui/primitives/checkbox';

export default function QuotesComparisonPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const captureCode = searchParams.get('capture');
  const continuation = (path) => `${path}${captureCode ? `?capture=${encodeURIComponent(captureCode)}` : ''}`;
  const { insurersList, selectQuote, quoteRequests, customer, piaConfig, requoteFromRequest, requestQuotesFromGuides, completeDemoQuoteReplies, insurerReviews } =
    useStore();

  // Insurer replies arrive after the request was sent, so this page reloads
  // the request each time it opens rather than trusting what it last saw.
  useEffect(() => {
    void hydrateDirectory();
    void hydrateCustomer();
  }, []);
  const request = useStore(selectActiveQuoteRequest);

  // A request made during an earlier prototype session may have been sent
  // before demo replies were introduced. Finish only that mock-mode hand-off;
  // production requests always wait for an insurer's uploaded quotation.
  useEffect(() => {
    const hasNoReplies = Object.keys(request?.insurerQuotes || {}).length === 0;
    if (
      env.apiMode === 'mock' &&
      request?.quotesRequestedAt &&
      !needsCoverGuideSelection(request) &&
      request.insurers?.length &&
      hasNoReplies
    ) {
      completeDemoQuoteReplies(request.id);
    }
  }, [completeDemoQuoteReplies, request?.id, request?.quotesRequestedAt, request?.insurers?.length, request?.insurerQuotes, request]);

  const quotes = useMemo(() => {
    if (!request) return [];
    const requested = request.insurerIds?.length
      ? request.insurerIds.map((id) => insurersList.find((insurer) => insurer.id === id))
      : request.insurers.map((name) => insurersList.find((insurer) => sameInsurerName(insurer.name, name)));
    return (
      requested
        .filter(Boolean)
        .map((insurer) => {
          const coverageDays = request.policyDates?.anchoredToAnniversary ? request.policyDates.daysTotal : null;
          const breakdown = calculatePremium({
            vehicleValueZMW: request.vehicleValue,
            insurer,
            vehicleUsage: request.vehicleUsage,
            coverageDurationId: request.coverageDurationId,
            coverageDays,
            piaRatePercentage: piaConfig?.piaRatePercentage,
          });
          const replyKey = Object.keys(request.insurerQuotes || {}).find((name) => sameInsurerName(name, insurer.name));
          const reply = replyKey ? request.insurerQuotes[replyKey] : null;
          // An insurer's final quote replaces the indicative calculation outright.
          const finalBreakdown = reply
            ? {
                ...breakdown,
                basePremium: reply.premium,
                ncdDiscount: 0,
                appliedNcdPercentage: 0,
                finalPremium: reply.premium,
                source: 'insurer',
              }
            : { ...breakdown, source: 'estimate' };
          const validity = quoteValidity(reply);
          const reviews = insurerReviews.filter((review) => sameInsurerName(review.insurer, insurer.name));
          const rating = reviews.length
            ? reviews.reduce((total, review) => total + review.rating, 0) / reviews.length
            : null;
          return {
            ...insurer,
            breakdown: finalBreakdown,
            premium: finalBreakdown.finalPremium,
            estimate: breakdown.finalPremium,
            reply,
            isFinal: Boolean(reply),
            validity,
            expired: validity.expired,
            rating,
            ratingCount: reviews.length,
          };
        })
        // Expired offers sink to the bottom; everything else is ordered by price.
        .sort((a, b) => Number(a.expired) - Number(b.expired) || a.premium - b.premium)
    );
  }, [request, insurersList, insurerReviews, piaConfig?.piaRatePercentage]);

  const repliedCount = quotes.filter((quote) => quote.isFinal).length;
  const coverageType =
    request?.insuranceType === 'Third Party Only' ? 'ThirdParty' : request?.insuranceType || 'Comprehensive';
  const guideInsurers = useMemo(
    () =>
      insurersList.filter(
        (insurer) => insurerReceivesRequests(insurer) && isCoverGuideComplete(insurer.coverGuides?.[coverageType]),
      ),
    [coverageType, insurersList],
  );
  const status = requestStatus(request);
  const cover = coverPeriod(request?.policyDates);
  const requestExpired = status.status === 'expired';

  const choose = (quote) => {
    // Indicative estimates explain the market but are not an offer a customer
    // can buy. A documented insurer reply is required before payment.
    if (!quote.isFinal || quote.expired || requestExpired) return;
    selectQuote(
      { ...quote, price: quote.premium, requestId: request.id, validUntil: quote.validity.validUntil },
      quote.breakdown,
    );
    navigate(continuation('/payment'));
  };

  const requote = () => {
    requoteFromRequest(request.id);
    navigate(continuation('/quote-request'));
  };

  if (!request) return <NoActiveRequest requests={quoteRequests} customer={customer} />;

  if (needsCoverGuideSelection(request)) {
    return (
      <CoverGuideSelection
        request={request}
        coverageType={coverageType}
        insurers={guideInsurers}
        onRequestQuotes={(insurerIds) =>
          requestQuotesFromGuides(request.id, insurerIds, { createDemoReplies: env.apiMode === 'mock' })
        }
      />
    );
  }

  return (
    <>
      <JourneyLayout
        step={5}
        title={quotes.length === 1 ? 'Your final quote' : 'Compare your quotes'}
        description={
          quotes.length === 1
            ? 'Review the insurer’s final quotation, then continue to payment.'
            : 'Compare each insurer’s final quotation, price and validity before choosing your cover.'
        }
        className="max-w-6xl"
      >
        <Card className="mb-6">
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {request.id} · sent {formatDate(request.submittedAt)}
            </p>
            <p className="font-medium">
              {request.vehicle} · {formatZMW(request.vehicleValue)} declared value ·{' '}
              {request.vehicleUsage || 'Individual'} use
            </p>
            {cover.known && (
              <p className="text-sm text-muted-foreground">
                Cover {cover.start} to {cover.end}
                {cover.days ? ` (${cover.days} days)` : ''}
                {request.policyDates?.anchoredToAnniversary ? ', aligned to RTSA anniversary' : ''}
              </p>
            )}
            <p role="status" className="text-sm">
              {repliedCount === quotes.length
                ? 'All insurers have sent their final quotes.'
                : `${repliedCount} of ${quotes.length} insurers have replied. Only a final insurer quotation can be selected for payment.`}
            </p>
          </CardContent>
        </Card>
        {requestExpired ? (
          <Alert className="mt-6">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[26px] text-primary" aria-hidden="true">
                event_busy
              </span>
              <div>
                <AlertTitle>These quotes have expired</AlertTitle>
                <AlertDescription>
                  Request fresh quotes from every insurer. Your vehicle details will be carried over.
                </AlertDescription>
              </div>
            </div>
            <Button
              type="button"
              onClick={requote}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-medium text-white hover:bg-[#b91c1c]"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                refresh
              </span>
              Request new quotes
            </Button>
          </Alert>
        ) : (
          status.status === 'expiring' && (
            <p className="mt-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] p-4 text-[14px] text-primary">
              <span className="material-symbols-outlined text-[22px] text-primary" aria-hidden="true">
                timer
              </span>
              <span>
                <strong>Some quotes expire soon.</strong> Each insurer sets how long its quote stays open — check the
                valid-until date on each one and pay before it lapses.
              </span>
            </p>
          )
        )}

        <ul aria-label="Insurer quotes" className="mt-6 grid items-start gap-6 md:grid-cols-2">
          {quotes.map((quote) => (
            <li key={quote.id} aria-labelledby={`quote-${quote.id}`} className="min-w-0">
              <QuoteCard
                quote={quote}
                coverageType={coverageType}
                disabled={requestExpired}
                onChoose={() => choose(quote)}
                onRequote={requote}
                selectionLabel={quotes.length === 1 ? 'Continue to payment' : `Choose ${quote.name}`}
              />
            </li>
          ))}
        </ul>

        <p className="mt-7 text-center text-[14px] text-ink-muted">
          Choosing an insurer takes you to payment. Each final quote is valid until the date shown; indicative estimates
          are confirmed by the insurer before your policy is issued.
        </p>
      </JourneyLayout>
    </>
  );
}

function CoverGuideSelection({ request, coverageType, insurers, onRequestQuotes }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedInsurerIds, setExpandedInsurerIds] = useState([]);
  const selectedCount = selectedIds.length;

  const toggle = (insurerId, checked) => {
    setSelectedIds((current) => (checked ? [...new Set([...current, insurerId])] : current.filter((id) => id !== insurerId)));
  };

  return (
    <>
      <JourneyLayout
        step={5}
        title="Choose cover guides"
        description="Your vehicle details and documents are ready. Read each insurer’s published cover guide, then select one or more insurers to prepare a final quote."
        className="max-w-6xl"
      >
        <Card className="mb-6 border-primary/20 bg-primary/[0.04]">
          <CardContent className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-medium text-foreground">{request.id} · {COVER_TYPE_LABELS[coverageType]} cover</p>
              <p className="mt-1 text-sm text-muted-foreground">Cover guides are shared automatically. Your full quote request is sent only to the insurers you select.</p>
            </div>
            <Badge variant="secondary">{selectedCount} selected</Badge>
          </CardContent>
        </Card>

        {insurers.length ? (
          <div className="grid items-start gap-4 md:grid-cols-2">
            {insurers.map((insurer) => {
              const guide = insurer.coverGuides[coverageType];
              const selected = selectedIds.includes(insurer.id);
              return (
                <CoverGuideOption
                  key={insurer.id}
                  insurer={insurer}
                  guide={guide}
                  coverageType={coverageType}
                  selected={selected}
                  expanded={expandedInsurerIds.includes(insurer.id)}
                  onExpandedChange={(open) =>
                    setExpandedInsurerIds((current) =>
                      open ? [...new Set([...current, insurer.id])] : current.filter((id) => id !== insurer.id),
                    )
                  }
                  onToggle={(checked) => toggle(insurer.id, checked)}
                />
              );
            })}
          </div>
        ) : (
          <Alert>
            <AlertTitle>Cover guides are not available yet</AlertTitle>
            <AlertDescription>There are no published {COVER_TYPE_LABELS[coverageType].toLowerCase()} guides to compare at the moment. Please try again later.</AlertDescription>
          </Alert>
        )}

        <div className="mt-7 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Choose at least one insurer. Each selected insurer receives the same verified vehicle details and inspection photos.</p>
          <Button type="button" size="lg" disabled={!selectedCount} onClick={() => onRequestQuotes(selectedIds)}>
            Request {selectedCount || '—'} final quote{selectedCount === 1 ? '' : 's'}
          </Button>
        </div>
      </JourneyLayout>
    </>
  );
}

/** A complete insurer guide, kept in its comparison card rather than a separate page. */
function CoverGuideOption({ insurer, guide, coverageType, selected, expanded, onExpandedChange, onToggle }) {
  const action = expanded ? 'Hide full cover guide' : 'Show full cover guide';

  return (
    <Collapsible open={expanded} onOpenChange={onExpandedChange} asChild>
      <Card size="sm" className={`gap-3 border ${selected ? 'ring-2 ring-primary/70' : ''}`}>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Checkbox
              id={`guide-${insurer.id}`}
              checked={selected}
              onCheckedChange={(checked) => onToggle(checked === true)}
              aria-label={`Select ${insurer.name} cover guide`}
              className="mt-1 size-5"
            />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-foreground">{insurer.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{guide.planName}</p>
            </div>
            <Badge variant="outline">Cover guide</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm leading-6 text-muted-foreground">{guide.summary}</p>
          <dl className="grid grid-cols-2 gap-3 border-y py-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Benefits</dt>
              <dd className="mt-1 font-medium">{asLines(guide.coveredItems).length} listed</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Quote validity</dt>
              <dd className="mt-1 font-medium">{guide.quoteValidityDays} days</dd>
            </div>
          </dl>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between border-primary text-primary hover:bg-primary hover:text-white"
              aria-label={`${action} for ${insurer.name}`}
            >
              <span>{action}</span>
              <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
        </CardContent>
        <CollapsibleContent className="border-t border-line">
          <CoverGuideDocument
            guide={guide}
            coverType={coverageType}
            insurerName={insurer.name}
            embedded
            className="border-x-0 border-b-0 border-t-0"
          />
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/** Premium with its provenance: the insurer's final figure, or our indicative estimate. */
function PriceBlock({ quote }) {
  return (
    <div>
      <p className="text-2xl font-semibold leading-none tracking-tight text-foreground">{formatZMW(quote.premium)}</p>
      {quote.isFinal ? (
        <p className="mt-1.5 text-[12px] text-ink-muted">
          Final quote from insurer
          {quote.estimate !== quote.premium && (
            <>
              {' '}
              · estimate was <s>{formatZMW(quote.estimate)}</s>
            </>
          )}
        </p>
      ) : (
        <p className="mt-1.5 text-[12px] text-ink-muted">Indicative estimate · awaiting insurer's final quote</p>
      )}
    </div>
  );
}

/** The insurer's own quotation document and reference, as uploaded from its system. */
function QuoteDocuments({ reply }) {
  if (!reply) return <span className="text-ink-muted/70">—</span>;
  return (
    <div className="space-y-1.5 text-[13px]">
      {reply.document && (
        <Button
          type="button"
          variant="link"
          onClick={() => openDocument(reply.document)}
          className="h-auto justify-start whitespace-normal px-0 font-medium"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            {reply.document.type === 'application/pdf' ? 'picture_as_pdf' : 'image'}
          </span>
          View quotation
        </Button>
      )}
      {reply.insurerReference && (
        <p className="text-ink-muted">
          Insurer ref <span className="font-mono font-semibold text-ink">{reply.insurerReference}</span>
        </p>
      )}
    </div>
  );
}

function QuoteStatusBadge({ quote }) {
  if (quote.expired) return <Badge variant="secondary">Expired</Badge>;
  if (quote.isFinal)
    return (
      <>
        {quote.validity.expiringSoon && <Badge variant="outline">Expires soon</Badge>}
        <Badge variant="secondary">Final quote</Badge>
      </>
    );
  return <Badge variant="outline">Estimate</Badge>;
}

/** "Valid until 28 Sep · 5 days left" (final quotes only). */
function ValidityLine({ quote }) {
  if (!quote.isFinal) return null;
  return (
    <span
      className={`mt-2 flex items-center gap-1 text-[12px] ${quote.expired ? 'text-primary' : quote.validity.expiringSoon ? 'text-primary' : 'text-ink-muted'}`}
    >
      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
        {quote.expired ? 'event_busy' : 'event_available'}
      </span>
      {quote.validity.label}
    </span>
  );
}

function ChooseButton({ quote, disabled, onChoose, onRequote, label }) {
  if (!quote.isFinal)
    return (
      <Button type="button" variant="outline" disabled className="h-auto min-h-11 w-full whitespace-normal">
        Awaiting insurer quote
      </Button>
    );
  if (quote.expired || disabled)
    return (
      <Button type="button" variant="outline" onClick={onRequote} className="h-auto min-h-11 w-full whitespace-normal">
        {quote.expired ? 'Expired · request a new quote' : 'Request new quotes'}
      </Button>
    );
  return (
    <Button type="button" onClick={onChoose} className="h-auto min-h-11 w-full whitespace-normal">
      {label}
    </Button>
  );
}

function QuoteCard({ quote, coverageType, disabled, onChoose, onRequote, selectionLabel }) {
  return (
      <Card size="sm" className="gap-3">
        <CardHeader>
          <div className="flex items-start gap-2">
            {quote.logoUrl ? (
              <img src={quote.logoUrl} alt="" className="size-8 shrink-0 object-contain" />
            ) : (
              <span className="material-symbols-outlined mt-0.5 text-2xl text-primary" aria-hidden="true">
                {quote.icon || 'shield'}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id={`quote-${quote.id}`} className="text-base font-semibold tracking-tight">
                {quote.name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{COVER_TYPE_LABELS[coverageType]}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <QuoteStatusBadge quote={quote} />
            </div>
          </div>
          <RatingSummary quote={quote} />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <PriceBlock quote={quote} />
            <ValidityLine quote={quote} />
          </div>
          {quote.reply?.notes && (
            <p className="rounded-xl bg-muted p-3 text-sm">
              <strong>Insurer note:</strong> {quote.reply.notes}
            </p>
          )}
        </CardContent>
        <CardFooter className="mt-auto flex-col items-stretch gap-2 border-t pt-3">
          {(quote.reply?.document || quote.reply?.insurerReference) && (
            <QuoteDocuments reply={quote.reply} />
          )}
          <ChooseButton
            quote={quote}
            disabled={disabled}
            onChoose={onChoose}
            onRequote={onRequote}
            label={selectionLabel}
          />
        </CardFooter>
      </Card>
  );
}

function RatingSummary({ quote }) {
  if (!quote.ratingCount) return null;
  return (
    <span className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
      <span className="text-[17px] leading-none text-primary" aria-hidden="true">
        ★
      </span>
      <strong className="font-medium text-ink">{quote.rating.toFixed(1)}</strong> / 5 · {quote.ratingCount} customer
      rating{quote.ratingCount === 1 ? '' : 's'}
    </span>
  );
}

function NoActiveRequest({ requests, customer }) {
  const previous = requests.filter((request) => request.customer?.email === customer?.email);
  return (
    <JourneyLayout
      step={5}
      title="No quotes to compare yet"
      description="Compare cover guides first, then request final quotes from the insurers you choose."
    >
      <Button asChild>
        <Link to="/insurance-type">Start a quote request</Link>
      </Button>
      {previous.length > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Your {previous.length} earlier request{previous.length === 1 ? '' : 's'}{' '}
          {previous.length === 1 ? 'is' : 'are'} in{' '}
          <Link to="/account" className="font-medium text-primary underline">
            My account
          </Link>
          .
        </p>
      )}
    </JourneyLayout>
  );
}
