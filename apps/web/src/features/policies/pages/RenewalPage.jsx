import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, ApiError } from '@/api';
import { hydrateCustomer } from '@/api/sync';
import { useStore } from '@/store';
import { formatZMW } from '@/domain/premiumEngine';
import { coverPeriod } from '@/domain/coverPeriod';
import { byRenewalUrgency, renewalLabel, renewalState } from '@/domain/renewal';
import Meta from '@/components/ui/Meta';

/** How each renewal window presents itself. */
const WINDOW = {
  EXPIRED: { label: 'Lapsed', tone: 'text-primary', border: 'border-primary', emphasis: true },
  DUE: { label: 'Due for renewal', tone: 'text-primary', border: 'border-primary', emphasis: true },
  NOT_DUE: { label: 'In force', tone: 'text-ink-muted', border: 'border-line', emphasis: false },
};

export default function RenewalPage() {
  const navigate = useNavigate();
  const { customer, policies } = useStore();

  useEffect(() => { void hydrateCustomer(); }, []);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const mine = useMemo(
    () =>
      policies
        .filter((policy) => policy.customerEmail === customer?.email || policy.customerPhone === customer?.phone)
        .slice()
        .sort(byRenewalUrgency),
    [policies, customer],
  );

  const dueCount = mine.filter((policy) => renewalState(policy).window !== 'NOT_DUE').length;

  const renew = async (policy) => {
    setBusy(policy.policyNumber);
    setError('');
    try {
      await api.policies.renew(policy.policyNumber);
      navigate('/quote-request');
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'RENEWAL_IN_PROGRESS'
          ? 'A renewal for this policy is already open. Finish it from My account.'
          : caught.message || 'The renewal could not be started. Please try again.',
      );
      setBusy(null);
    }
  };

  return (
    <main className="relative overflow-hidden">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-[1120px] px-6 py-12 pb-24 lg:px-10">
        <Link
          to="/account"
          className="inline-flex items-center gap-2 text-[14px] font-medium text-primary transition-colors duration-200 ease-out hover:text-[#b91c1c]"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>My account
        </Link>

        <header className="mt-8 border-b border-line pb-8">
          <span className="inline-flex items-center gap-3">
            <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
            <Meta className="text-ink-muted">Renewals</Meta>
          </span>
          <h1 className="mt-6 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[44px]">Renew a policy</h1>
          <p className="mt-4 max-w-[58ch] text-[16px] leading-[1.6] text-ink-muted">
            Renewing sends a fresh request to every insurer on InsurShield, so you compare the market again
            rather than rolling over last year's price. Your vehicle details carry forward.
          </p>
        </header>

        {error && (
          <p role="alert" className="mt-8 border border-primary/30 bg-primary/[0.06] px-4 py-3 text-[13px] text-primary">{error}</p>
        )}

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_300px] lg:items-start">
          <section>
            <div className="flex items-end justify-between gap-4 border-b border-dashed border-line pb-3">
              <Meta className="text-primary">Your policies</Meta>
              <Meta className="text-ink-faint">
                {mine.length} total{dueCount > 0 && <span className="text-primary"> · {dueCount} needing attention</span>}
              </Meta>
            </div>

            {mine.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="mt-6 space-y-5">
                {mine.map((policy, index) => (
                  <PolicyCard
                    key={policy.policyNumber}
                    policy={policy}
                    index={index}
                    busy={busy === policy.policyNumber}
                    disabled={Boolean(busy)}
                    onRenew={() => renew(policy)}
                  />
                ))}
              </div>
            )}
          </section>

          <HowItWorks />
        </div>
      </div>
    </main>
  );
}

function PolicyCard({ policy, index, busy, disabled, onRenew }) {
  const state = renewalState(policy);
  const style = WINDOW[state.window] ?? WINDOW.NOT_DUE;
  const inFlight = !state.renewable && state.renewalRequestId;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.2) }}
      className={`flex flex-col border bg-canvas ${style.border}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-dashed border-line p-5">
        <div className="min-w-0">
          <Meta className={style.tone}>{style.label}</Meta>
          <p className="mt-3 text-[18px] font-medium leading-[1.25] tracking-[-0.02em] text-ink">{policy.vehicle}</p>
          <p className="mt-2 font-mono text-[12px] tracking-[0.02em] text-ink-muted">{policy.policyNumber}</p>
        </div>
        {state.window !== 'NOT_DUE' && (
          <span className="material-symbols-outlined shrink-0 text-[22px] text-primary" aria-hidden="true">
            {state.window === 'EXPIRED' ? 'error' : 'schedule'}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4">
        <Fact label="Insurer" value={policy.insurer} />
        <Fact label="Cover" value={policy.plan || policy.coverage} />
        <Fact label="Premium paid" value={policy.premium ? formatZMW(policy.premium) : '—'} />
        <Fact label="Cover ends" value={coverPeriod(policy.policyDates).end} />
      </dl>

      <div className={`mt-auto border-t p-5 ${style.emphasis ? 'border-primary/30 bg-primary/[0.04]' : 'border-line bg-canvas-2'}`}>
        <p className={`text-[13px] font-medium ${style.emphasis ? 'text-primary' : 'text-ink-muted'}`}>{renewalLabel(state)}</p>

        {inFlight ? (
          <div className="mt-4">
            <p className="text-[13px] leading-[1.55] text-ink-muted">
              A renewal is already open as <span className="font-mono text-ink">{state.renewalRequestId}</span>.
            </p>
            <Link
              to="/account"
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[1px] border border-dashed border-line-strong px-4 text-[14px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary"
            >
              See it in My account
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={onRenew}
            disabled={disabled}
            className="group relative mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-[1px] bg-primary px-5 text-[14px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:pointer-events-none disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:w-auto"
          >
            <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
            <span className={`material-symbols-outlined relative text-[18px] ${busy ? 'animate-spin' : ''}`} aria-hidden="true">
              {busy ? 'sync' : 'autorenew'}
            </span>
            <span className="relative">{busy ? 'Starting renewal…' : 'Renew this policy'}</span>
          </button>
        )}
      </div>
    </motion.article>
  );
}

/** The three things people ask before clicking renew. */
const STAGES = [
  { title: 'We ask every insurer again', detail: 'Your vehicle and cover go out as a new request, so last year\u2019s insurer has to compete for you.' },
  { title: 'You compare the replies', detail: 'Each insurer sends its own final quote, exactly as it did the first time.' },
  { title: 'Cover continues without a gap', detail: 'New cover is set to start the day your current policy ends.' },
];

function HowItWorks() {
  return (
    <aside className="border border-line bg-canvas lg:sticky lg:top-24">
      <div className="border-b border-dashed border-line px-5 py-4">
        <Meta className="text-primary">How renewal works</Meta>
      </div>
      <ol className="space-y-5 p-5">
        {STAGES.map((stage, index) => (
          <li key={stage.title} className="border-l-2 border-primary/30 pl-4">
            <Meta className="text-primary">{String(index + 1).padStart(2, '0')}</Meta>
            <p className="mt-2 text-[14px] font-medium tracking-[-0.01em] text-ink">{stage.title}</p>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-muted">{stage.detail}</p>
          </li>
        ))}
      </ol>
      <p className="border-t border-line bg-canvas-2 px-5 py-4 text-[12px] leading-[1.55] text-ink-muted">
        Renewing does not cancel your current policy. It stays in force until the day it ends.
      </p>
    </aside>
  );
}

function Fact({ label, value }) {
  return (
    <div className="min-w-0">
      <dt><Meta className="text-ink-faint">{label}</Meta></dt>
      <dd className="mt-2 break-words text-[14px] font-medium leading-[1.45] tracking-[-0.01em] text-ink">{value}</dd>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-6 border border-dashed border-line-strong p-12 text-center">
      <span className="material-symbols-outlined text-[32px] text-line-strong" aria-hidden="true">description</span>
      <h2 className="mt-4 text-[18px] font-medium tracking-[-0.02em] text-ink">No policies to renew yet</h2>
      <p className="mx-auto mt-3 max-w-[46ch] text-[14px] leading-[1.6] text-ink-muted">
        Once you buy a policy it appears here, and we will tell you when it is coming up for renewal.
      </p>
      <Link
        to="/insurance-type"
        className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-[1px] bg-primary px-5 text-[14px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]"
      >
        Get a new quote
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
      </Link>
    </div>
  );
}
