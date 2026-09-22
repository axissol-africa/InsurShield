import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { DEFAULT_QUOTE_VALIDITY_DAYS } from '@/domain/quoteValidity';
import { AWAITING_CERTIFICATE, isOpenNcdApplication, toPortalRequest } from '@/features/insurer-portal/portal';
import { Icon } from '@/features/insurer-portal/components/ui';
import RequestQueue from '@/features/insurer-portal/components/RequestQueue';
import QuoteRequestForm from '@/features/insurer-portal/components/QuoteRequestForm';
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
  const { staffSession, claims, ncdApplications, quoteRequests, policies, insurersList, piaConfig, addInsurerQuote, extendInsurerQuote, issuePolicyCertificate } = useStore();
  const [activeTab, setActiveTab] = useState('overview');
  const [quotingRequest, setQuotingRequest] = useState(null);
  const [issuingPolicy, setIssuingPolicy] = useState(null);

  const insurerName = (staffSession?.role === 'insurer' && staffSession.name) || DEFAULT_PORTAL_INSURER;
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
        onIssued={(policyNumber, issuance) => { issuePolicyCertificate(policyNumber, issuance); setIssuingPolicy(null); }}
      />
    );
  }

  if (quotingRequest) {
    return (
      <QuoteRequestForm
        request={quotingRequest}
        insurer={insurer}
        piaRatePercentage={piaConfig?.piaRatePercentage}
        defaultValidityDays={defaultValidityDays}
        onBack={() => setQuotingRequest(null)}
        onSubmit={(quote) => { addInsurerQuote(quotingRequest.id, insurerName, quote); setQuotingRequest(null); }}
      />
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'dashboard', badge: awaitingQuote.length },
    { id: 'policies', label: 'Paid policies', icon: 'verified_user', badge: awaitingCertificate.length },
    { id: 'claims', label: 'Claims', icon: 'report_problem', badge: newClaims.length },
    { id: 'ncd', label: 'NCD Applications', icon: 'sell', badge: openNcd.length },
  ];
  const kpis = [
    { label: 'Requests awaiting a quote', value: awaitingQuote.length, icon: 'request_quote', tag: 'Respond' },
    { label: 'Paid policies to issue', value: awaitingCertificate.length, icon: 'verified_user', tag: awaitingCertificate.length ? 'Certificate due' : null },
    { label: 'New claim notices', value: newClaims.length, icon: 'report_problem', tag: newClaims.length ? 'Needs review' : null },
    { label: 'Claims acknowledged', value: receivedClaims.length, icon: 'task_alt', tag: null },
  ];
  const attentionCount = awaitingQuote.length + awaitingCertificate.length + newClaims.length + openNcd.length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full pb-8">
      <section className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[12px] font-bold uppercase tracking-wider text-secondary">Insurer Portal</p>
          <h2 className="text-[30px] font-bold leading-tight text-primary">{insurerName}</h2>
          <p className="mt-0.5 text-[14px] text-secondary">{plural(newClaims.length, 'new claim')} · {plural(openNcd.length, 'NCD application')} pending</p>
        </div>
        <div className="relative rounded-full border border-gray-100 bg-white p-3 shadow-sm" aria-label={`${attentionCount} items need attention`}>
          <Icon name="notifications" className="text-2xl text-primary" />
          {attentionCount > 0 && <span className="absolute right-2 top-2 h-3 w-3 animate-pulse rounded-full border-2 border-white bg-red-500" />}
        </div>
      </section>

      <div role="tablist" className="mb-6 flex overflow-x-auto border-b border-gray-200">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-[14px] font-semibold transition-colors ${activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}`}>
            <Icon name={tab.icon} className="text-[18px]" />
            {tab.label}
            {tab.badge > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{tab.badge}</span>}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <section className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="relative flex flex-col gap-2 overflow-hidden rounded-xl border border-primary/10 bg-primary/5 p-6 shadow-sm">
                {kpi.tag && <span className="absolute right-0 top-0 rounded-bl-lg bg-primary px-2 py-1 text-[10px] font-bold uppercase text-white">{kpi.tag}</span>}
                <Icon name={kpi.icon} className="text-2xl text-primary" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-secondary">{kpi.label}</p>
                <p className="text-[32px] font-bold leading-tight text-primary">{kpi.value}</p>
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
            onExtend={(request) => extendInsurerQuote(request.id, insurerName, EXTENSION_DAYS)}
          />
        </>
      )}

      {activeTab === 'policies' && <PaidPoliciesTab policies={myPolicies} onIssue={setIssuingPolicy} />}
      {activeTab === 'claims' && <ClaimsTab claims={myClaims} />}
      {activeTab === 'ncd' && <NcdTab applications={myNcd} />}
    </motion.div>
  );
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
