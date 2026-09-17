import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, selectActiveQuoteRequest } from '../store/useStore';
import { calculatePremium, formatZMW, formatDate } from '../utils/premiumEngine';
import { sameInsurerName } from '../utils/insurerRates';
import JourneyProgress from '../components/JourneyProgress';

/**
 * Benefits are free text per insurer; map them onto fixed rows so the
 * customer can scan across insurers instead of reading five different lists.
 */
const BENEFIT_ROWS = [
  { key: 'thirdParty', label: 'Third-party damage', test: /third party/i },
  { key: 'ownDamage', label: 'Own damage', test: /own damage/i },
  { key: 'theftFire', label: 'Theft & fire', test: /theft/i },
  { key: 'medical', label: 'Medical expenses', test: /medical/i, detail: (text) => text.replace(/medical expenses?/i, '').trim() },
  { key: 'disasters', label: 'Natural disasters', test: /natural disaster/i },
  { key: 'windscreen', label: 'Windscreen', test: /windscreen/i },
  { key: 'roadside', label: 'Roadside assistance', test: /roadside/i },
  { key: 'towing', label: 'Emergency towing', test: /towing/i },
  { key: 'legal', label: 'Legal assistance', test: /legal/i },
];

const INSPECTION_LABELS = { 'NOT REQUIRED': 'Not required', REQUIRED: 'Required before policy issue', OPTIONAL: 'May be requested' };

const benefitCell = (quote, row) => {
  const match = (quote.benefits || []).find((benefit) => row.test.test(benefit));
  if (!match) return null;
  return row.detail ? row.detail(match) || 'Included' : 'Included';
};

export default function QuotesComparisonPage() {
  const navigate = useNavigate();
  const { insurersList, selectQuote, quoteRequests, customer, piaConfig } = useStore();
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
        return { ...insurer, breakdown: finalBreakdown, premium: finalBreakdown.finalPremium, estimate: breakdown.finalPremium, reply, isFinal: Boolean(reply) };
      })
      .sort((a, b) => a.premium - b.premium);
  }, [request, insurersList, piaConfig?.piaRatePercentage]);

  const repliedCount = quotes.filter((quote) => quote.isFinal).length;
  const benefitRows = BENEFIT_ROWS.filter((row) => quotes.some((quote) => benefitCell(quote, row)));

  const choose = (quote) => {
    selectQuote({ ...quote, price: quote.premium, requestId: request.id }, quote.breakdown);
    navigate('/payment');
  };

  if (!request) return <NoActiveRequest requests={quoteRequests} customer={customer} />;

  return (
    <>
      <JourneyProgress current={5} />
      <main className="mx-auto w-full max-w-[1550px] px-5 py-10 pb-24 sm:px-8 lg:py-12">
        <header className="rounded-2xl bg-primary p-7 text-white sm:p-10">
          <p className="text-[13px] font-extrabold uppercase tracking-[.12em] text-white/85">Request {request.id} · sent {formatDate(request.submittedAt)}</p>
          <h1 className="mt-3 text-[34px] font-extrabold leading-tight tracking-[-.04em] sm:text-[44px]">Compare your quotes</h1>
          <p className="mt-3 max-w-3xl text-[16px] leading-7 text-white/95">
            {request.vehicle} · declared value <strong>{formatZMW(request.vehicleValue)}</strong> · {request.vehicleUsage || 'Individual'} use
            {request.policyDates && <> · cover {request.policyDates.formattedStart} to {request.policyDates.formattedEnd} ({request.policyDates.daysTotal} days{request.policyDates.anchoredToAnniversary ? ', aligned to RTSA anniversary' : ''})</>}
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2 text-[14px]">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{repliedCount === quotes.length ? 'task_alt' : 'schedule'}</span>
            {repliedCount === quotes.length
              ? 'All insurers have sent their final quotes.'
              : `${repliedCount} of ${quotes.length} insurers have replied. Estimates shown for the rest — we'll update them as final quotes arrive.`}
          </div>
        </header>

        {/* Desktop: fixed comparison rows */}
        <div className="mt-8 hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white xl:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 align-top">
                <th scope="col" className="w-[18%] p-5 text-[12px] font-extrabold uppercase tracking-wide text-secondary">Compare</th>
                {quotes.map((quote, index) => (
                  <th key={quote.id} scope="col" className="p-5">
                    <span className="flex items-center gap-2 text-[19px] font-extrabold"><span className="material-symbols-outlined text-primary" aria-hidden="true">{quote.icon || 'shield'}</span>{quote.name}</span>
                    <span className="mt-1 block text-[12px] font-semibold text-secondary">{quote.coverage}</span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {index === 0 && <Badge tone="primary">Lowest</Badge>}
                      <QuoteStatusBadge isFinal={quote.isFinal} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-200 bg-slate-50/60">
                <th scope="row" className="p-5 text-[12px] font-extrabold uppercase text-secondary">{quotes[0]?.breakdown.coverageDays ? `${quotes[0].breakdown.coverageDays}-day` : quotes[0]?.breakdown.coverageDuration} premium</th>
                {quotes.map((quote) => <td key={quote.id} className="whitespace-nowrap p-5 align-top"><PriceBlock quote={quote} size="table" /></td>)}
              </tr>
              <Row label="Insurer rate" quotes={quotes} render={(quote) => <><strong>{quote.ratePercentage}%</strong> of vehicle value</>} />
              <Row label="Vehicle inspection" quotes={quotes} render={(quote) => INSPECTION_LABELS[quote.inspectionRules] || 'May be requested'} />
              {benefitRows.map((row) => (
                <Row key={row.key} label={row.label} quotes={quotes} render={(quote) => <BenefitCell value={benefitCell(quote, row)} />} />
              ))}
              {quotes.some((quote) => quote.reply?.notes) && <Row label="Insurer notes" quotes={quotes} render={(quote) => quote.reply?.notes || '—'} />}
              <tr className="border-t border-slate-200 bg-slate-50">
                <th scope="row" className="sr-only">Choose</th>
                {quotes.map((quote, index) => (
                  <td key={quote.id} className="p-5">
                    <button type="button" onClick={() => choose(quote)} className={`min-h-13 w-full rounded-lg text-[15px] font-bold ${index === 0 ? 'bg-primary text-white hover:bg-primary-container' : 'border-2 border-primary text-primary hover:bg-primary/5'}`}>Choose {quote.name.split(' ')[0]}</button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile / tablet: stacked cards */}
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:hidden">
          {quotes.map((quote, index) => <QuoteCard key={quote.id} quote={quote} lowest={index === 0} benefitRows={benefitRows} onChoose={() => choose(quote)} />)}
        </div>

        <p className="mt-7 text-center text-[14px] text-secondary">Choosing an insurer takes you to payment. Indicative estimates are confirmed by the insurer before your policy is issued.</p>
      </main>
    </>
  );
}

function Row({ label, quotes, render }) {
  return (
    <tr className="border-t border-slate-200">
      <th scope="row" className="p-5 text-[12px] font-extrabold uppercase text-secondary">{label}</th>
      {quotes.map((quote) => <td key={quote.id} className="p-5 text-[15px] text-on-surface">{render(quote)}</td>)}
    </tr>
  );
}

function BenefitCell({ value }) {
  if (!value) return <span className="text-secondary/70" aria-label="Not included">—</span>;
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
      <p className={`${amountClass} font-extrabold leading-none tracking-[-.04em] text-primary`}>{formatZMW(quote.premium)}</p>
      {quote.isFinal ? (
        <p className="mt-1.5 text-[12px] text-secondary">Final quote from insurer{quote.estimate !== quote.premium && <> · estimate was <s>{formatZMW(quote.estimate)}</s></>}</p>
      ) : (
        <p className="mt-1.5 text-[12px] text-secondary">Indicative estimate · awaiting insurer's final quote</p>
      )}
    </div>
  );
}

function Badge({ tone, children }) {
  const tones = { primary: 'bg-primary/10 text-primary', amber: 'bg-amber-100 text-amber-800', blue: 'bg-blue-100 text-blue-800' };
  return <span className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold uppercase ${tones[tone]}`}>{children}</span>;
}

function QuoteStatusBadge({ isFinal }) {
  return isFinal ? <Badge tone="blue">Final quote</Badge> : <Badge tone="amber">Estimate</Badge>;
}

function QuoteCard({ quote, lowest, benefitRows, onChoose }) {
  return (
    <article className={`rounded-2xl border-2 bg-white p-5 ${lowest ? 'border-primary' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="material-symbols-outlined text-[26px] text-primary" aria-hidden="true">{quote.icon || 'shield'}</span>
        <h2 className="text-[20px] font-extrabold tracking-[-.02em]">{quote.name}</h2>
        {lowest && <Badge tone="primary">Lowest</Badge>}
        <QuoteStatusBadge isFinal={quote.isFinal} />
      </div>
      <p className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-secondary">{quote.coverage}</p>
      <div className="mt-3"><PriceBlock quote={quote} size="card" /></div>
      <p className="mt-2 text-[13px] text-secondary">{quote.breakdown.coverageDays ? `${quote.breakdown.coverageDays} days` : quote.breakdown.coverageDuration} · {quote.ratePercentage}% of vehicle value · inspection {INSPECTION_LABELS[quote.inspectionRules]?.toLowerCase() || 'may be requested'}</p>
      <ul className="mt-4 grid gap-1.5 border-t border-slate-100 pt-4 text-[14px]">
        {benefitRows.map((row) => {
          const value = benefitCell(quote, row);
          return (
            <li key={row.key} className={`flex items-center justify-between gap-3 ${value ? 'text-on-surface' : 'text-secondary/60'}`}>
              <span>{row.label}</span>
              <span className="text-right text-[13px]">{value ? (value === 'Included' ? <span className="material-symbols-outlined text-[18px] text-primary" aria-label="Included">check</span> : value) : '—'}</span>
            </li>
          );
        })}
      </ul>
      {quote.reply?.notes && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-[13px] text-blue-900"><strong>Insurer note:</strong> {quote.reply.notes}</p>}
      <button type="button" onClick={onChoose} className={`mt-5 min-h-13 w-full rounded-lg text-[15px] font-bold ${lowest ? 'bg-primary text-white hover:bg-primary-container' : 'border-2 border-primary text-primary hover:bg-primary/5'}`}>Choose {quote.name}</button>
    </article>
  );
}

function NoActiveRequest({ requests, customer }) {
  const previous = requests.filter((request) => request.customer?.email === customer?.email);
  return (
    <>
      <JourneyProgress current={5} />
      <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-5 py-10">
        <section className="w-full rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <span className="material-symbols-outlined text-[48px] text-primary" aria-hidden="true">compare_arrows</span>
          <h1 className="mt-3 text-2xl font-extrabold">No quotes to compare yet</h1>
          <p className="mt-2 text-secondary">Send a quote request and every insurer on InsurShield will reply here.</p>
          <Link to="/insurance-type" className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-primary px-6 font-bold text-white hover:bg-primary-container">Start a quote request</Link>
          {previous.length > 0 && <p className="mt-4 text-[13px] text-secondary">Your {previous.length} earlier request{previous.length === 1 ? '' : 's'} can be found in <Link to="/account" className="font-bold text-primary hover:underline">My account</Link>.</p>}
        </section>
      </main>
    </>
  );
}
