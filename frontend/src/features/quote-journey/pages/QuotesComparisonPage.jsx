import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Meta from '@/components/ui/Meta';
import { useStore, selectActiveQuoteRequest } from '@/store';
import { hydrateCustomer, hydrateDirectory } from '@/api/sync';
import { calculatePremium, formatZMW, formatDate } from '@/domain/premiumEngine';
import { sameInsurerName } from '@/domain/insurers';
import { quoteValidity, requestStatus } from '@/domain/quoteValidity';
import { coverPeriod } from '@/domain/coverPeriod';
import { openDocument } from '@/lib/files';
import EmptyState from '@/components/ui/EmptyState';
import CoverGuideReader from '@/components/cover-guide/CoverGuideReader';
import { COVER_TYPE_LABELS, asLines, benefitKey, splitBenefit } from '@/domain/coverGuide';
import JourneyProgress from '@/features/quote-journey/components/JourneyProgress';

/**
 * Rows are taken from the benefits insurers publish in their cover guides,
 * each with the limit stated against it. Older quotes carry free-text
 * benefits with no limits, so those still appear — as the benefit alone.
 */
const coveredRows = (quotes, coverageType) => {
  // Keyed by the benefit, labelled by the first insurer to name it, so the
  // same cover at different ceilings is one row with different cells.
  const rows = new Map();
  for (const quote of quotes) {
    for (const benefit of benefitsOf(quote, coverageType)) {
      const key = benefitKey(benefit);
      if (key && !rows.has(key)) rows.set(key, splitBenefit(benefit).name);
    }
  }
  return [...rows].map(([key, label]) => ({ key, label }));
};

/** A quote's benefits, from its published guide or from an older reply. */
/**
 * An insurer that has not replied yet is still compared on its published
 * guide, not on the free text in the catalogue. Those wordings differ per
 * insurer — "Medical Expenses up to ZMW 30,000" against "…up to ZMW 50,000" —
 * so every variant became a row of its own and the table grew a line for each
 * insurer rather than one per benefit.
 */
const benefitsOf = (quote, coverageType) => {
  const quoted = quote.reply?.coverGuide;
  if (quoted?.coveredItems?.length) return asLines(quoted.coveredItems);
  const published = quote.coverGuides?.[coverageType];
  if (published?.coveredItems?.length) return asLines(published.coveredItems);
  return asLines(quoted?.benefits || quote.benefits || []);
};

const INSPECTION_LABELS = { 'NOT REQUIRED': 'Not required', REQUIRED: 'Required before policy issue', OPTIONAL: 'May be requested' };

/** What this insurer says about one benefit: its ceiling, or just that it is included. */
const benefitCell = (quote, key, coverageType) => {
  const match = benefitsOf(quote, coverageType).find((benefit) => benefitKey(benefit) === key);
  if (!match) return null;
  return splitBenefit(match).detail || 'Included';
};

export default function QuotesComparisonPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [reading, setReading] = useState(null); // { guide, insurerName } while a cover guide is open
  const captureCode = searchParams.get('capture');
  const continuation = (path) => `${path}${captureCode ? `?capture=${encodeURIComponent(captureCode)}` : ''}`;
  const { insurersList, selectQuote, quoteRequests, customer, piaConfig, requoteFromRequest, insurerReviews } = useStore();

  // Insurer replies arrive after the request was sent, so this page reloads
  // the request each time it opens rather than trusting what it last saw.
  useEffect(() => { void hydrateDirectory(); void hydrateCustomer(); }, []);
  const request = useStore(selectActiveQuoteRequest);

  const quotes = useMemo(() => {
    if (!request) return [];
    const requested = request.insurerIds?.length
      ? request.insurerIds.map((id) => insurersList.find((insurer) => insurer.id === id))
      : request.insurers.map((name) => insurersList.find((insurer) => sameInsurerName(insurer.name, name)));
    return requested
      .filter(Boolean)
      .map((insurer) => {
        const coverageDays = request.policyDates?.anchoredToAnniversary ? request.policyDates.daysTotal : null;
        const breakdown = calculatePremium({ vehicleValueZMW: request.vehicleValue, insurer, vehicleUsage: request.vehicleUsage, coverageDurationId: request.coverageDurationId, coverageDays, piaRatePercentage: piaConfig?.piaRatePercentage });
        const replyKey = Object.keys(request.insurerQuotes || {}).find((name) => sameInsurerName(name, insurer.name));
        const reply = replyKey ? request.insurerQuotes[replyKey] : null;
        // An insurer's final quote replaces the indicative calculation outright.
        const finalBreakdown = reply
          ? { ...breakdown, basePremium: reply.premium, ncdDiscount: 0, appliedNcdPercentage: 0, finalPremium: reply.premium, source: 'insurer' }
          : { ...breakdown, source: 'estimate' };
        const validity = quoteValidity(reply);
        const reviews = insurerReviews.filter((review) => sameInsurerName(review.insurer, insurer.name));
        const rating = reviews.length ? reviews.reduce((total, review) => total + review.rating, 0) / reviews.length : null;
        return { ...insurer, breakdown: finalBreakdown, premium: finalBreakdown.finalPremium, estimate: breakdown.finalPremium, reply, isFinal: Boolean(reply), validity, expired: validity.expired, rating, ratingCount: reviews.length };
      })
      // Expired offers sink to the bottom; everything else is ordered by price.
      .sort((a, b) => Number(a.expired) - Number(b.expired) || a.premium - b.premium);
  }, [request, insurersList, insurerReviews, piaConfig?.piaRatePercentage]);

  const repliedCount = quotes.filter((quote) => quote.isFinal).length;
  const coverageType = request?.insuranceType === 'Third Party Only' ? 'ThirdParty' : request?.insuranceType || 'Comprehensive';
  const benefitRows = coveredRows(quotes, coverageType);
  const status = requestStatus(request);
  const cover = coverPeriod(request?.policyDates);
  const requestExpired = status.status === 'expired';

  const choose = (quote) => {
    if (quote.expired || requestExpired) return;
    selectQuote({ ...quote, price: quote.premium, requestId: request.id, validUntil: quote.validity.validUntil }, quote.breakdown);
    navigate(continuation('/payment'));
  };

  const requote = () => {
    requoteFromRequest(request.id);
    navigate(continuation('/quote-request'));
  };

  if (!request) return <NoActiveRequest requests={quoteRequests} customer={customer} />;

  return (
    <>
      <JourneyProgress current={5} />
      <main className="relative overflow-hidden">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-[1400px] px-6 py-12 pb-24 lg:px-10">
        <header className="border-b border-line pb-8">
          <span className="inline-flex items-center gap-3">
            <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
            <Meta className="text-primary">{request.id}</Meta>
            <Meta className="text-ink-faint">sent {formatDate(request.submittedAt)}</Meta>
          </span>
          <h1 className="mt-6 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[44px]">Compare your quotes</h1>
          <p className="mt-3 max-w-3xl text-[16px] leading-[1.6] text-ink-muted">
            {request.vehicle} · declared value <strong>{formatZMW(request.vehicleValue)}</strong> · {request.vehicleUsage || 'Individual'} use
            {cover.known && <> · cover {cover.start} to {cover.end}{cover.days ? ` (${cover.days} days` : ''}{cover.days && request.policyDates?.anchoredToAnniversary ? ', aligned to RTSA anniversary' : ''}{cover.days ? ')' : ''}</>}
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-[1px] border border-line bg-canvas-2 px-4 py-2 text-[14px] text-ink">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{repliedCount === quotes.length ? 'task_alt' : 'schedule'}</span>
            {repliedCount === quotes.length
              ? 'All insurers have sent their final quotes.'
              : `${repliedCount} of ${quotes.length} insurers have replied. Estimates shown for the rest — we'll update them as final quotes arrive.`}
          </div>
        </header>

        {requestExpired ? (
          <section role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[1px] border border-primary/30 bg-primary/[0.06] p-5">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-[26px] text-primary" aria-hidden="true">event_busy</span>
              <div>
                <h2 className="text-[17px] font-semibold text-primary">These quotes have expired</h2>
                <p className="mt-1 text-[14px] text-primary">Insurers only hold a quote open for a limited time. Request fresh quotes and every insurer will quote again — your vehicle details are carried over.</p>
              </div>
            </div>
            <button type="button" onClick={requote} className="inline-flex min-h-12 items-center gap-2 rounded-[1px] bg-primary px-5 text-[15px] font-medium text-white hover:bg-[#b91c1c]"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">refresh</span>Request new quotes</button>
          </section>
        ) : status.status === 'expiring' && (
          <p className="mt-6 flex items-start gap-3 rounded-[1px] border border-primary/30 bg-primary/[0.06] p-4 text-[14px] text-primary">
            <span className="material-symbols-outlined text-[22px] text-primary" aria-hidden="true">timer</span>
            <span><strong>Some quotes expire soon.</strong> Each insurer sets how long its quote stays open — check the valid-until date on each one and pay before it lapses.</span>
          </p>
        )}

        {/* Desktop: fixed comparison rows */}
        <div className="mt-8 hidden overflow-x-auto rounded-[1px] border border-line bg-white xl:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-canvas-2 align-top">
                <th scope="col" className="w-[18%] p-5 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">Compare</th>
                {quotes.map((quote, index) => (
                  <th key={quote.id} scope="col" className="p-5">
                    <span className="flex items-center gap-2 text-[19px] font-semibold"><span className="material-symbols-outlined text-primary" aria-hidden="true">{quote.icon || 'shield'}</span>{quote.name}</span>
                    <span className="mt-1 block text-[12px] font-semibold text-ink-muted">{quote.coverage}</span>
                    <RatingSummary quote={quote} />
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {index === 0 && !quote.expired && <Badge tone="primary">Lowest</Badge>}
                      <QuoteStatusBadge quote={quote} />
                    </span>
                    <ValidityLine quote={quote} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line bg-canvas-2/60">
                <th scope="row" className="p-5 text-[12px] font-semibold uppercase text-ink-muted">{quotes[0]?.breakdown.coverageDays ? `${quotes[0].breakdown.coverageDays}-day` : quotes[0]?.breakdown.coverageDuration} premium</th>
                {quotes.map((quote) => <td key={quote.id} className="whitespace-nowrap p-5 align-top"><PriceBlock quote={quote} size="table" /></td>)}
              </tr>
              <Row label="Insurer rate" quotes={quotes} render={(quote) => <><strong>{quote.ratePercentage}%</strong> of vehicle value</>} />
              <Row label="Customer rating" quotes={quotes} render={(quote) => <RatingSummary quote={quote} />} />
              <Row label="Vehicle inspection" quotes={quotes} render={(quote) => INSPECTION_LABELS[quote.inspectionRules] || 'May be requested'} />
              {benefitRows.map((row) => (
                <Row key={row.key} label={row.label} quotes={quotes} render={(quote) => <BenefitCell value={benefitCell(quote, row.key, coverageType)} />} />
              ))}
              {quotes.some((quote) => quote.reply?.notes) && <Row label="Insurer notes" quotes={quotes} render={(quote) => quote.reply?.notes || '—'} />}
              {quotes.some((quote) => quote.reply?.document || quote.reply?.coverGuide?.planName || quote.reply?.insurerReference) && <Row label="Quote & cover guide" quotes={quotes} render={(quote) => <QuoteDocuments reply={quote.reply} onOpenGuide={(guide) => setReading({ guide, insurerName: quote.name })} />} />}
              <tr className="border-t border-line bg-canvas-2">
                <th scope="row" className="sr-only">Choose</th>
                {quotes.map((quote, index) => (
                  <td key={quote.id} className="p-5">
                    <ChooseButton quote={quote} primary={index === 0} disabled={requestExpired} onChoose={() => choose(quote)} onRequote={requote} label={`Choose ${quote.name.split(' ')[0]}`} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile / tablet: stacked cards */}
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:hidden">
          {quotes.map((quote, index) => <QuoteCard key={quote.id} quote={quote} lowest={index === 0 && !quote.expired} benefitRows={benefitRows} coverageType={coverageType} disabled={requestExpired} onChoose={() => choose(quote)} onRequote={requote} onOpenGuide={(guide) => setReading({ guide, insurerName: quote.name })} />)}
        </div>

        <p className="mt-7 text-center text-[14px] text-ink-muted">Choosing an insurer takes you to payment. Each final quote is valid until the date shown; indicative estimates are confirmed by the insurer before your policy is issued.</p>
        </div>
      </main>

      {reading && (
        <CoverGuideReader
          guide={reading.guide}
          insurerName={reading.insurerName}
          onClose={() => setReading(null)}
        />
      )}
    </>
  );
}

function Row({ label, quotes, render }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="p-5 text-[12px] font-semibold uppercase text-ink-muted">{label}</th>
      {quotes.map((quote) => <td key={quote.id} className="p-5 text-[15px] text-ink">{render(quote)}</td>)}
    </tr>
  );
}

function BenefitCell({ value }) {
  if (!value) return <span className="text-ink-muted/70" aria-label="Not included">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="material-symbols-outlined text-[20px] text-primary" aria-hidden="true">check</span>
      {value === 'Included' ? <span className="sr-only">Included</span> : value}
    </span>
  );
}

/** Premium with its provenance: the insurer's final figure, or our indicative estimate. */
function PriceBlock({ quote, size }) {
  const amountClass = size === 'card' ? 'text-[32px]' : 'text-[26px]';
  return (
    <div>
      <p className={`${amountClass} font-semibold leading-none tracking-[-.04em] text-primary`}>{formatZMW(quote.premium)}</p>
      {quote.isFinal ? (
        <p className="mt-1.5 text-[12px] text-ink-muted">Final quote from insurer{quote.estimate !== quote.premium && <> · estimate was <s>{formatZMW(quote.estimate)}</s></>}</p>
      ) : (
        <p className="mt-1.5 text-[12px] text-ink-muted">Indicative estimate · awaiting insurer's final quote</p>
      )}
    </div>
  );
}

/** The insurer's own quotation document and reference, as uploaded from its system. */
function QuoteDocuments({ reply, onOpenGuide }) {
  if (!reply) return <span className="text-ink-muted/70">—</span>;
  const guide = reply.coverGuide;
  return (
    <div className="space-y-1.5 text-[13px]">
      {reply.document && (
        <button type="button" onClick={() => openDocument(reply.document)} className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{reply.document.type === 'application/pdf' ? 'picture_as_pdf' : 'image'}</span>View quotation
        </button>
      )}
      {guide?.planName && (
        <button type="button" onClick={() => onOpenGuide(guide)} className="flex items-center gap-1.5 font-medium text-primary hover:underline">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">description</span>Read the cover guide
        </button>
      )}
      {reply.insurerReference && <p className="text-ink-muted">Insurer ref <span className="font-mono font-semibold text-ink">{reply.insurerReference}</span></p>}
    </div>
  );
}

function CoverGuideDetails({ quote }) {
  const guide = quote.reply?.coverGuide;
  if (!guide) return <p className="mt-3 text-[12px] leading-[1.5] text-ink-muted">The insurer sends its cover guide with its final quote.</p>;
  const covered = asLines(guide.coveredItems).length || asLines(guide.benefits).length;
  return (
    <div className="mt-4 border-y border-line py-3 text-[12px] leading-[1.55] text-ink-muted">
      <p className="font-medium text-ink">{guide.planName || COVER_TYPE_LABELS[guide.coverageType] || 'Cover guide'}</p>
      <p className="mt-1">{covered} stated benefit{covered === 1 ? '' : 's'}{guide.claimsContact ? ` · Claims: ${guide.claimsContact}` : ''}</p>
    </div>
  );
}

function Badge({ tone, children }) {
  const tones = { primary: 'bg-primary/10 text-primary', amber: 'bg-primary/[0.06] text-primary', blue: 'bg-canvas-2 text-ink-muted', grey: 'bg-line text-ink-muted' };
  return <span className={`rounded-[1px] px-2 py-0.5 text-[11px] font-semibold uppercase ${tones[tone]}`}>{children}</span>;
}

function QuoteStatusBadge({ quote }) {
  if (quote.expired) return <Badge tone="grey">Expired</Badge>;
  if (quote.isFinal) return <>{quote.validity.expiringSoon && <Badge tone="amber">Expires soon</Badge>}<Badge tone="blue">Final quote</Badge></>;
  return <Badge tone="amber">Estimate</Badge>;
}

/** "Valid until 28 Sep · 5 days left" (final quotes only). */
function ValidityLine({ quote }) {
  if (!quote.isFinal) return null;
  return (
    <span className={`mt-2 flex items-center gap-1 text-[12px] ${quote.expired ? 'text-primary' : quote.validity.expiringSoon ? 'text-primary' : 'text-ink-muted'}`}>
      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">{quote.expired ? 'event_busy' : 'event_available'}</span>{quote.validity.label}
    </span>
  );
}

function ChooseButton({ quote, primary, disabled, onChoose, onRequote, label }) {
  if (quote.expired || disabled) {
    return (
      <button type="button" onClick={onRequote} className="min-h-13 w-full rounded-[1px] border-2 border-dashed border-line text-[14px] font-medium text-ink-muted hover:border-primary hover:text-primary">
        {quote.expired ? 'Expired · request a new quote' : 'Request new quotes'}
      </button>
    );
  }
  return <button type="button" onClick={onChoose} className={`min-h-13 w-full rounded-[1px] text-[15px] font-medium ${primary ? 'bg-primary text-white hover:bg-[#b91c1c]' : 'border-2 border-primary text-primary hover:bg-primary/5'}`}>{label}</button>;
}

function QuoteCard({ quote, lowest, benefitRows, coverageType, disabled, onChoose, onRequote, onOpenGuide }) {
  return (
    <article className={`rounded-[1px] border-2 bg-white p-5 ${quote.expired ? 'border-line opacity-70' : lowest ? 'border-primary' : 'border-line'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="material-symbols-outlined text-[26px] text-primary" aria-hidden="true">{quote.icon || 'shield'}</span>
        <h2 className="text-[20px] font-semibold tracking-[-.02em]">{quote.name}</h2>
        {lowest && <Badge tone="primary">Lowest</Badge>}
        <QuoteStatusBadge quote={quote} />
      </div>
      <ValidityLine quote={quote} />
      <p className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">{quote.coverage}</p>
      <RatingSummary quote={quote} />
      <div className="mt-3"><PriceBlock quote={quote} size="card" /></div>
      <p className="mt-2 text-[13px] text-ink-muted">{quote.breakdown.coverageDays ? `${quote.breakdown.coverageDays} days` : quote.breakdown.coverageDuration} · {quote.ratePercentage}% of vehicle value · inspection {INSPECTION_LABELS[quote.inspectionRules]?.toLowerCase() || 'may be requested'}</p>
      <ul className="mt-4 grid gap-1.5 border-t border-line pt-4 text-[14px]">
        {benefitRows.map((row) => {
          const value = benefitCell(quote, row.key, coverageType);
          return (
            <li key={row.key} className={`flex items-center justify-between gap-3 ${value ? 'text-ink' : 'text-ink-muted/60'}`}>
              <span>{row.label}</span>
              <span className="text-right text-[13px]">{value ? (value === 'Included' ? <span className="material-symbols-outlined text-[18px] text-primary" aria-label="Included">check</span> : value) : '—'}</span>
            </li>
          );
        })}
      </ul>
      {quote.reply?.notes && <p className="mt-3 rounded-[1px] bg-canvas-2 p-3 text-[13px] text-ink-muted"><strong>Insurer note:</strong> {quote.reply.notes}</p>}
      <CoverGuideDetails quote={quote} />
      {(quote.reply?.document || quote.reply?.coverGuide?.planName || quote.reply?.insurerReference) && <div className="mt-3"><QuoteDocuments reply={quote.reply} onOpenGuide={onOpenGuide} /></div>}
      <div className="mt-5"><ChooseButton quote={quote} primary={lowest} disabled={disabled} onChoose={onChoose} onRequote={onRequote} label={`Choose ${quote.name}`} /></div>
    </article>
  );
}

function RatingSummary({ quote }) {
  if (!quote.ratingCount) return <span className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-muted">New insurer · no customer ratings yet</span>;
  return (
    <span className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
      <span className="text-[17px] leading-none text-primary" aria-hidden="true">★</span>
      <strong className="font-medium text-ink">{quote.rating.toFixed(1)}</strong> / 5 · {quote.ratingCount} customer rating{quote.ratingCount === 1 ? '' : 's'}
    </span>
  );
}

function NoActiveRequest({ requests, customer }) {
  const previous = requests.filter((request) => request.customer?.email === customer?.email);
  return (
    <>
      <JourneyProgress current={5} />
      <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-5 py-10">
        <div className="w-full">
          <EmptyState
            icon="compare_arrows"
            title="No quotes to compare yet"
            hint="Send one request and every insurer on InsurShield replies here."
            action={
              <Link to="/insurance-type" className="inline-flex min-h-12 items-center rounded-[1px] bg-primary px-6 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">
                Start a quote request
              </Link>
            }
          />
          {previous.length > 0 && (
            <p className="mt-4 text-center text-[13px] text-ink-muted">
              Your {previous.length} earlier request{previous.length === 1 ? '' : 's'} {previous.length === 1 ? 'is' : 'are'} in <Link to="/account" className="font-medium text-primary hover:underline">My account</Link>.
            </p>
          )}
        </div>
      </main>
    </>
  );
}
