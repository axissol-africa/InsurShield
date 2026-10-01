import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { api } from '@/api';
import { hydrateInsurerPortal } from '@/api/sync';
import { DEFAULT_QUOTE_VALIDITY_DAYS } from '@/domain/quoteValidity';
import { AWAITING_CERTIFICATE, isOpenNcdApplication, toPortalRequest } from '@/features/insurer-portal/portal';
import { Icon } from '@/features/insurer-portal/components/ui';
import Meta from '@/components/ui/Meta';
import RequestQueue from '@/features/insurer-portal/components/RequestQueue';
import QuoteRequestForm from '@/features/insurer-portal/components/QuoteRequestForm';
import CoverGuideLibrary from '@/features/insurer-portal/components/CoverGuideLibrary';
import PaidPoliciesTab, { PolicyIssuePanel } from '@/features/insurer-portal/components/PaidPoliciesTab';
import ClaimsTab from '@/features/insurer-portal/components/ClaimsTab';
import NcdTab from '@/features/insurer-portal/components/NcdTab';

/** The portal demo signs in as this insurer; a real deployment takes the identity from authentication. */
const DEFAULT_PORTAL_INSURER = 'Prestige Assurance';
const EXTENSION_DAYS = 7;

const byNewest = (key) => (first, second) => new Date(second[key] || 0) - new Date(first[key] || 0);

/**
 * Insurer portal: a module beside the insurer's own systems. Quote requests
 * arrive here, quotations and certificates are uploaded here, and first
 * claim notifications are acknowledged here; everything else stays in the
 * insurer's systems.
 */
export default function InsurerDashboard() {
  const { staffSession, claims, ncdApplications, quoteRequests, policies, insurersList, piaConfig, updateInsurer } = useStore();

  // The queue is shared with customers and other staff, so it is loaded on
  // open and again after every action rather than kept on the device.
  useEffect(() => { void hydrateInsurerPortal(); }, []);
  const [activeTab, setActiveTab] = useState('overview');
  const [quotingRequest, setQuotingRequest] = useState(null);
  const [issuingPolicy, setIssuingPolicy] = useState(null);

  // Sub-views (quote form, certificate upload) replace the dashboard; start them at the top on phones.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [quotingRequest, issuingPolicy, activeTab]);

  // A session may name the insurer separately from the staff member; the
  // prototype session puts the insurer in `name`.
  const insurerName =
    (staffSession?.role === 'insurer' && (staffSession.insurerName || staffSession.name)) ||
    DEFAULT_PORTAL_INSURER;
  const insurer = insurersList.find((item) => item.name === insurerName);
  const defaultValidityDays = insurer?.quoteValidityDays || DEFAULT_QUOTE_VALIDITY_DAYS;

  const myClaims = claims.filter((claim) => claim.insurer === insurerName);
  const myNcd = ncdApplications.filter((application) => application.insurer === insurerName);
  const myPolicies = policies.filter((policy) => policy.insurer === insurerName && ['Active', AWAITING_CERTIFICATE].includes(policy.status)).sort(byNewest('receivedAt'));
  const myRequests = quoteRequests.filter((request) => request.insurers?.includes(insurerName)).sort(byNewest('submittedAt')).map((request) => toPortalRequest(request, insurerName));

  const awaitingQuote = myRequests.filter((request) => !request.reply);
  const quoted = myRequests.filter((request) => request.reply);
  const newClaims = myClaims.filter((claim) => claim.status === 'Notified');
  const receivedClaims = myClaims.filter((claim) => claim.status === 'Received by insurer');
  const openNcd = myNcd.filter(isOpenNcdApplication);
  const awaitingCertificate = myPolicies.filter((policy) => policy.status === AWAITING_CERTIFICATE);

  if (issuingPolicy) {
    return (
      <PolicyIssuePanel
        policy={issuingPolicy}
        onBack={() => setIssuingPolicy(null)}
        onIssued={async (policyNumber, issuance) => {
          await api.policies.issueCertificate(policyNumber, issuance);
          await hydrateInsurerPortal();
          setIssuingPolicy(null);
        }}
      />
    );
  }

  if (quotingRequest) {
    return (
      <QuoteRequestForm
        request={quotingRequest}
        insurer={insurer}
        coverDocuments={insurer?.coverDocuments}
        piaRatePercentage={piaConfig?.piaRatePercentage}
        defaultValidityDays={defaultValidityDays}
        onBack={() => setQuotingRequest(null)}
        onSubmit={async (quote) => {
          await api.quotes.reply(quotingRequest.id, quote);
          await hydrateInsurerPortal();
          setQuotingRequest(null);
        }}
      />
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'dashboard', badge: awaitingQuote.length },
    { id: 'guides', label: 'Cover documents', shortLabel: 'Documents', icon: 'description', badge: insurer?.coverDocuments?.Comprehensive && insurer?.coverDocuments?.ThirdParty ? 0 : 1 },
    { id: 'policies', label: 'Paid policies', shortLabel: 'Policies', icon: 'verified_user', badge: awaitingCertificate.length },
    { id: 'claims', label: 'Claims', icon: 'report_problem', badge: newClaims.length },
    { id: 'ncd', label: 'NCD Applications', shortLabel: 'NCD', icon: 'sell', badge: openNcd.length },
  ];
  const kpis = [
    { label: 'Requests awaiting a quote', value: awaitingQuote.length, icon: 'request_quote', tag: 'Respond' },
    { label: 'Paid policies to issue', value: awaitingCertificate.length, icon: 'verified_user', tag: awaitingCertificate.length ? 'Certificate due' : null },
    { label: 'New claim notices', value: newClaims.length, icon: 'report_problem', tag: newClaims.length ? 'Needs review' : null },
    { label: 'Claims acknowledged', value: receivedClaims.length, icon: 'task_alt', tag: null },
  ];
  const attentionCount = awaitingQuote.length + awaitingCertificate.length + newClaims.length + openNcd.length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full pb-10">
      {/* ── Who is signed in, and what is waiting ──────────────── */}
      <section className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-7">
        <div>
          <span className="inline-flex items-center gap-3">
            <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
            <Meta className="text-ink-muted">Insurer portal</Meta>
          </span>
          <h2 className="mt-5 text-[32px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[40px]">
            {insurerName}
          </h2>
          <p className="mt-3 text-[14px] text-ink-muted">
            {plural(newClaims.length, 'new claim')} · {plural(openNcd.length, 'NCD application')} pending
          </p>
        </div>

        {/* A readout rather than a bell: the number is the useful part. */}
        <div
          className={`flex items-center gap-4 rounded-[1px] border px-5 py-3 ${attentionCount > 0 ? 'border-primary bg-primary/[0.03]' : 'border-dashed border-line-strong'}`}
        >
          <div>
            <Meta className={attentionCount > 0 ? 'text-primary' : 'text-ink-faint'}>Needs attention</Meta>
            <p className={`mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] ${attentionCount > 0 ? 'text-primary' : 'text-ink-faint'}`}>
              {attentionCount}
            </p>
          </div>
          {attentionCount > 0 && (
            <span aria-hidden="true" className="flex items-center gap-1.5">
              {Array.from({ length: 6 }, (_, index) => (
                <span
                  key={index}
                  className="dot-pulse block h-[3px] w-[3px] rounded-full bg-primary"
                  style={{ animationDelay: `${index * 0.12}s` }}
                />
              ))}
            </span>
          )}
        </div>
      </section>

      {/* ── Sections ───────────────────────────────────────────── */}
      {/* Every section stays reachable without scrolling a strip sideways, so
          on a phone the tabs are a two-column rail of equal cells. An odd last
          tab takes the full width rather than leaving a ragged gap. */}
      <div role="tablist" className="no-scrollbar -mb-px grid grid-cols-2 border-b border-line md:flex md:overflow-x-auto">
        {tabs.map((tab, index) => {
          const active = activeTab === tab.id;
          const fullWidth = tabs.length % 2 === 1 && index === tabs.length - 1;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              // A phone shows the short label to keep the rail one line per
              // tab; the section is still announced by its full name.
              aria-label={tab.label}
              onClick={() => setActiveTab(tab.id)}
              className={`flex min-h-14 items-center justify-center gap-2.5 border-b-2 px-3 py-3 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors duration-200 ease-out md:min-h-0 md:shrink-0 md:justify-start md:px-5 md:py-4 md:text-[12px] ${
                fullWidth ? 'col-span-2 md:col-span-1' : ''
              } ${
                active ? 'border-primary text-primary' : 'border-transparent text-ink-faint hover:text-ink'
              }`}
            >
              <Icon name={tab.icon} className="text-[17px]" />
              {tab.shortLabel ? (
                <>
                  <span className="md:hidden">{tab.shortLabel}</span>
                  <span className="hidden md:inline">{tab.label}</span>
                </>
              ) : (
                tab.label
              )}
              {tab.badge > 0 && (
                <span className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-[1px] px-1 text-[10px] leading-none ${active ? 'bg-primary text-white' : 'bg-primary/10 text-primary'}`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' && (
        <>
          {/* Counts read as one instrument panel rather than four cards. */}
          <section className="mb-10 grid grid-cols-2 border-b border-line lg:grid-cols-4">
            {kpis.map((kpi, index) => (
              <div
                key={kpi.label}
                className={`border-line py-7 pr-3 sm:pr-5 ${index % 2 === 1 ? 'border-l pl-3 sm:pl-5' : ''} ${index < 2 ? 'border-b lg:border-b-0' : ''} lg:border-l lg:pl-6 ${index === 0 ? 'lg:border-l-0 lg:pl-0' : ''}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Icon name={kpi.icon} className="text-[19px] text-primary" />
                  {kpi.tag && (
                    <Meta className="rounded-[1px] border border-primary/30 bg-primary/10 px-2 py-1 text-primary">
                      {kpi.tag}
                    </Meta>
                  )}
                </div>
                <p className="mt-5 text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink">{kpi.value}</p>
                <p className="mt-3 max-w-[170px] text-[13px] leading-[1.4] text-ink-muted">{kpi.label}</p>
              </div>
            ))}
          </section>

          <RequestQueue
            title="Quote requests"
            countLabel={`${awaitingQuote.length} awaiting a quote`}
            requests={awaitingQuote}
            emptyMessage="Every request has been quoted. Sent quotes are listed below."
            onQuote={setQuotingRequest}
          />
          <RequestQueue
            title="Quotes sent"
            hint="Each quote stays open until its validity date; extend one if the customer needs more time."
            countLabel={`${quoted.length} sent`}
            requests={quoted}
            emptyMessage="No quotes have been sent yet."
            onExtend={async (request) => {
              await api.quotes.extend(request.id, EXTENSION_DAYS);
              await hydrateInsurerPortal();
            }}
          />
        </>
      )}

      {activeTab === 'guides' && (
        <CoverGuideLibrary
          insurer={insurer}
          onSave={async (coverageType, document) => {
            if (!insurer) throw new Error('Your insurer profile could not be found.');
            const coverDocuments = { ...(insurer.coverDocuments || {}), [coverageType]: document };
            await api.insurers.update(insurer.id, { coverDocuments });
            updateInsurer(insurer.id, { coverDocuments });
            await hydrateInsurerPortal();
          }}
        />
      )}

      {activeTab === 'policies' && <div className="pt-8"><PaidPoliciesTab policies={myPolicies} onIssue={setIssuingPolicy} /></div>}
      {activeTab === 'claims' && <div className="pt-8"><ClaimsTab claims={myClaims} /></div>}
      {activeTab === 'ncd' && <div className="pt-8"><NcdTab applications={myNcd} /></div>}
    </motion.div>
  );
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
