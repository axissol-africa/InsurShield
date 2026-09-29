import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useStore, belongsToCustomer, DEMO_CUSTOMER_ACCOUNT } from '@/store';
import { hydrateCustomer } from '@/api/sync';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { requestStatus } from '@/domain/quoteValidity';
import { coverPeriod } from '@/domain/coverPeriod';
import { downloadPolicyCertificate, downloadRtsaDisc } from '@/lib/policyDocuments';
import { openDocument } from '@/lib/files';
import Meta from '@/components/ui/Meta';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

const AWAITING_CERTIFICATE = 'Awaiting insurer certificate';

/** The insurer's uploaded certificate; policies issued before certificates were uploaded get a generated summary. */
const openCertificate = (policy) =>
  policy.certificateDocument ? openDocument(policy.certificateDocument) : downloadPolicyCertificate(policy);

export default function CustomerAccountPage() {
  const navigate = useNavigate();
  const { customer, policies, quoteRequests, claims, setActiveQuoteRequest, deleteCurrentAccount, requoteFromRequest, resetJourney } = useStore();

  // Your records come from the server when one is configured; a no-op otherwise.
  useEffect(() => { void hydrateCustomer(); }, []);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const isDemoAccount = customer?.email === DEMO_CUSTOMER_ACCOUNT.email;

  const mine = belongsToCustomer(customer);
  const myPolicies = policies.filter((policy) => mine(policy) && policy.status === 'Active');
  const pendingPolicies = policies.filter((policy) => mine(policy) && policy.status === AWAITING_CERTIFICATE);
  const myRequests = quoteRequests.filter(mine);
  const myClaims = claims.filter(mine);

  const openRequest = (request) => {
    setActiveQuoteRequest(request.id);
    navigate('/quotes-comparison');
  };
  const requote = (request) => {
    requoteFromRequest(request.id);
    navigate('/quote-request');
  };
  const removeAccount = () => {
    setConfirmingRemoval(false);
    deleteCurrentAccount(); // CustomerRoute sends the visitor home once the session ends
  };

  const summary = [
    ['Active policies', myPolicies.length, 'verified_user'],
    ['Quote requests', myRequests.length, 'send'],
    ['Claims', myClaims.length, 'report_problem'],
  ];

  return (
    <main className="relative overflow-hidden">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-[1200px] px-6 py-12 pb-24 lg:px-10">
        {/* ── Who this is ──────────────────────────────────────── */}
        <section className="border-b border-line pb-8">
          <span className="inline-flex items-center gap-3">
            <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
            <Meta className="text-ink-muted">My InsurShield</Meta>
          </span>
          <h1 className="mt-6 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[44px]">
            Welcome back, {customer?.fullName?.split(' ')[0] || 'there'}.
          </h1>
          <p className="mt-4 max-w-xl text-[16px] leading-[1.6] text-ink-muted">
            Your policies, quote requests, renewals and claims — all in one place.
          </p>

          {/* On a phone these are the app's home actions, so they form a tidy
              block — the main one across the top, the other two side by side —
              instead of wrapping into a ragged line. */}
          <div className="mt-8 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
            <Link
              to="/insurance-type"
              onClick={resetJourney}
              className="group relative col-span-2 flex min-h-[48px] items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary px-6 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] sm:col-span-1 sm:inline-flex sm:justify-start"
            >
              <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
              <span className="relative">Get quotes</span>
              <span className="material-symbols-outlined relative text-[18px] transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
            </Link>
            {[['Renew a policy', '/renewal'], ['Claims & NCD', '/claims']].map(([label, to]) => (
              <Link
                key={to}
                to={to}
                className="flex min-h-[48px] items-center justify-center rounded-[1px] border border-dashed border-line-strong px-4 text-center text-[15px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary sm:inline-flex sm:px-6"
              >
                {label}
              </Link>
            ))}
          </div>
        </section>

        {/* ── Counts ───────────────────────────────────────────── */}
        <section aria-label="Summary" className="grid grid-cols-3 border-b border-line">
          {summary.map(([label, value, icon], index) => (
            <div
              key={label}
              className={`border-line py-7 pr-4 ${index === 0 ? '' : 'border-l pl-4 sm:pl-6'}`}
            >
              <span className="material-symbols-outlined text-[19px] text-primary" aria-hidden="true">{icon}</span>
              <p className="mt-4 text-[32px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[38px]">{value}</p>
              <p className="mt-3 text-[13px] leading-[1.35] text-ink-muted">{label}</p>
            </div>
          ))}
        </section>

        {pendingPolicies.length > 0 && (
          <section className="mt-8 flex gap-4 border border-dashed border-line-strong p-5">
            <span className="material-symbols-outlined shrink-0 text-[20px] text-primary" aria-hidden="true">pending_actions</span>
            <div>
              <Meta className="text-ink-muted">Certificate being prepared</Meta>
              {pendingPolicies.map((policy) => (
                <p key={policy.policyNumber} className="mt-3 text-[13px] leading-[1.55] text-ink-muted">
                  {policy.insurer} is preparing the certificate for paid quote{' '}
                  <span className="font-mono text-ink">{policy.quoteRequestId}</span>. It appears
                  under Policies once issued.
                </p>
              ))}
            </div>
          </section>
        )}

        {/* ── Policies and requests ────────────────────────────── */}
        <section className="mt-10 grid gap-8 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <Meta className="text-primary">Policies</Meta>
                <span className="h-px w-12 bg-line" aria-hidden="true" />
              </div>
              {myPolicies.length > 0 && (
                <Link to="/renewal" className="font-mono text-[11px] uppercase tracking-[0.1em] text-primary underline-offset-4 hover:underline">
                  Renew
                </Link>
              )}
            </div>

            {myPolicies.length ? (
              <ul className="mt-5 border border-line">
                {myPolicies.map((policy, index) => (
                  <li key={policy.policyNumber} className={`p-5 ${index === 0 ? '' : 'border-t border-dashed border-line'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{policy.insurer}</p>
                        <Meta className="mt-1.5 block truncate text-primary">{policy.policyNumber}</Meta>
                        <p className="mt-1 truncate text-[12px] text-ink-muted">
                          {policy.vehicle}{policy.vehicleDetails?.plateNumber ? ` · ${policy.vehicleDetails.plateNumber}` : ''}
                        </p>
                      </div>
                      <Meta className="shrink-0 rounded-[1px] border border-primary/30 bg-primary/10 px-2 py-1 text-primary">Active</Meta>
                    </div>

                    <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
                      {[
                        ['Cover', policy.coverage || 'Comprehensive'],
                        ['Premium', formatZMW(policy.premium || 0)],
                        ['Valid until', coverPeriod(policy.policyDates).end],
                        ['Issued', formatDate(policy.issuedAt)],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">{label}</dt>
                          <dd className="mt-2 text-[14px] text-ink">{value}</dd>
                        </div>
                      ))}
                    </dl>

                    <div className="mt-5 flex flex-wrap gap-2 border-t border-dashed border-line pt-4">
                      <button type="button" onClick={() => openCertificate(policy)} className={documentButton}>
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                          {policy.certificateDocument ? 'open_in_new' : 'download'}
                        </span>
                        Policy certificate
                      </button>
                      {policy.rtsaAnniversaryFee > 0 && (
                        <button type="button" onClick={() => downloadRtsaDisc(policy)} className={documentButton}>
                          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">download</span>
                          RTSA disc
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty text="Policies you buy through InsurShield will appear here." />
            )}
          </div>

          <div>
            <div className="flex items-center gap-4">
              <Meta className="text-primary">Quote requests</Meta>
              <span className="h-px w-12 bg-line" aria-hidden="true" />
            </div>

            {myRequests.length ? (
              <ul className="mt-5 border border-line">
                {myRequests.map((request, index) => {
                  const total = request.insurers?.length || 0;
                  const status = requestStatus(request);
                  const [tone, label] = {
                    expired: ['border-line-strong text-ink-faint', 'Expired'],
                    expiring: ['border-primary/30 bg-primary/10 text-primary', `Expiring · ${status.validQuotes} valid`],
                    quoted: ['border-primary/30 bg-primary/10 text-primary', `${status.replies}/${total} replied`],
                    pending: ['border-line-strong text-ink-muted', `${status.replies}/${total} replied`],
                  }[status.status];

                  return (
                    <li key={request.id} className={`p-5 ${index === 0 ? '' : 'border-t border-dashed border-line'} ${status.status === 'expired' ? 'bg-canvas-2' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{request.vehicle}</p>
                          <Meta className="mt-1.5 block truncate text-primary">{request.id}</Meta>
                          <p className="mt-1 text-[12px] leading-[1.45] text-ink-muted">
                            Sent {formatDate(request.submittedAt)} to {total} insurers
                            {request.requotedAs ? ` · re-requested as ${request.requotedAs}` : ''}
                          </p>
                        </div>
                        <Meta className={`shrink-0 whitespace-nowrap rounded-[1px] border px-2 py-1 ${tone}`}>{label}</Meta>
                      </div>

                      {status.status === 'expired' ? (
                        request.requotedAs ? (
                          <p className="mt-4 text-[13px] text-ink-muted">These quotes lapsed; the new request carries your details.</p>
                        ) : (
                          <button type="button" onClick={() => requote(request)} className="mt-4 inline-flex items-center gap-2 text-[14px] font-medium text-primary underline-offset-4 hover:underline">
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
                            Request new quotes
                          </button>
                        )
                      ) : (
                        <button type="button" onClick={() => openRequest(request)} className="group mt-4 inline-flex items-center gap-2 text-[14px] font-medium text-primary underline-offset-4 hover:underline">
                          Compare quotes
                          <span className="material-symbols-outlined text-[16px] transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty
                text="Send one request and every insurer on InsurShield will reply here."
                action={<Link to="/insurance-type" className="text-primary underline-offset-4 hover:underline">Start a quote</Link>}
              />
            )}
          </div>
        </section>

        {/* ── Claims ───────────────────────────────────────────── */}
        <section className="mt-10 flex flex-col gap-5 border border-line p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Meta className="text-primary">Claims &amp; NCD</Meta>
            <p className="mt-3 text-[14px] leading-[1.55] text-ink-muted">
              {myClaims.length
                ? `${myClaims.length} claim${myClaims.length === 1 ? '' : 's'} linked to this account.`
                : 'No claims yet. If you ever need to, you can notify your insurer from here.'}
            </p>
          </div>
          <Link
            to="/claims"
            className="inline-flex min-h-[46px] shrink-0 items-center justify-center rounded-[1px] border border-dashed border-line-strong px-6 text-[14px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary"
          >
            Manage claims
          </Link>
        </section>

        {/* ── The account itself ───────────────────────────────── */}
        {!isDemoAccount && (
          <section className="mt-6 flex flex-col gap-4 border border-dashed border-line-strong p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Meta className="text-ink-muted">Account details</Meta>
              {/* A phone number is not collected at sign-up, so it is only shown once there is one. */}
              <p className="mt-3 text-[14px] text-ink-muted">
                {[customer?.fullName, customer?.email, customer?.phone].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmingRemoval(true)}
              className="shrink-0 self-start font-mono text-[11px] uppercase tracking-[0.1em] text-primary underline-offset-4 hover:underline sm:self-auto"
            >
              Close this account
            </button>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmingRemoval}
        destructive
        title="Close your account?"
        description="You will be signed out and will need to register again to use InsurShield."
        consequences={[
          { text: 'You lose access to your quote requests and documents.' },
          { text: 'Your policies, claims and payment records are kept for regulatory retention.', kept: true },
          { text: 'An account holding cover in force cannot be closed until that cover ends.', kept: true },
        ]}
        confirmLabel="Close account"
        cancelLabel="Keep my account"
        onConfirm={removeAccount}
        onCancel={() => setConfirmingRemoval(false)}
      />
    </main>
  );
}

const documentButton =
  'inline-flex min-h-10 items-center gap-2 rounded-[1px] border border-dashed border-line-strong px-3.5 text-[13px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary';

function Empty({ text, action }) {
  return (
    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 border border-dashed border-line-strong p-6 text-[13px] leading-[1.6] text-ink-muted">
      {text}
      {action && <> {action}</>}
    </motion.p>
  );
}
