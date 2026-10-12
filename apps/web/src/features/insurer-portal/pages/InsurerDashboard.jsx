import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BadgePercent, BookOpen, CheckCheck, FileCheck2, FileText, LayoutDashboard, MessageSquareWarning } from 'lucide-react';
import { toast } from 'sonner';
import InsurerShell from '@/features/insurer-portal/components/InsurerShell';
import { useStore } from '@/store';
import { api } from '@/api';
import { hydrateInsurerPortal } from '@/api/sync';
import { DEFAULT_QUOTE_VALIDITY_DAYS } from '@/domain/quoteValidity';
import { AWAITING_CERTIFICATE, isOpenNcdApplication, policyPaidAt, portalPath, toPortalRequest, waitingLongestFirst } from '@/features/insurer-portal/portal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { COVER_TYPES, isCoverGuideComplete } from '@/domain/coverGuide';
import { PageHeader, StatusBadge } from '@/features/insurer-portal/components/ui';
import RequestQueue from '@/features/insurer-portal/components/RequestQueue';
import QuoteRequestForm from '@/features/insurer-portal/components/QuoteRequestForm';
import CoverGuideLibrary from '@/features/insurer-portal/components/CoverGuideLibrary';
import PaidPoliciesTab from '@/features/insurer-portal/components/PaidPoliciesTab';
import PolicyIssuePanel from '@/features/insurer-portal/components/PolicyIssuePanel';
import ClaimsTab from '@/features/insurer-portal/components/ClaimsTab';
import NcdTab from '@/features/insurer-portal/components/NcdTab';

/** The portal demo signs in as this insurer; a real deployment takes the identity from authentication. */
const DEFAULT_PORTAL_INSURER = 'Prestige Assurance';
const EXTENSION_DAYS = 7;
const SECTION_IDS = ['overview', 'guides', 'policies', 'claims', 'ncd'];
const QUOTE_QUEUE_ID = 'quote-requests';

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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('view');
  const activeTab = SECTION_IDS.includes(requestedTab) ? requestedTab : 'overview';

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

  // The quote and certificate screens are addressed by the record they act
  // on, so the browser's Back button and a refresh both keep the person's
  // place. An address for a record that is no longer waiting shows its section.
  const quotingRequest = activeTab === 'overview' ? awaitingQuote.find((request) => request.id === searchParams.get('quote')) : undefined;
  const issuingPolicy = activeTab === 'policies' ? awaitingCertificate.find((policy) => policy.policyNumber === searchParams.get('issue')) : undefined;

  // Each screen replaces the one before it; start it at the top on phones.
  const screen = quotingRequest?.id || issuingPolicy?.policyNumber || activeTab;
  useEffect(() => { window.scrollTo({ top: 0 }); }, [screen]);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, badge: awaitingQuote.length },
    { id: 'guides', label: 'Cover guides', shortLabel: 'Guides', icon: BookOpen, badge: COVER_TYPES.filter((type) => !isCoverGuideComplete(insurer?.coverGuides?.[type])).length },
    { id: 'policies', label: 'Paid policies', shortLabel: 'Policies', icon: FileCheck2, badge: awaitingCertificate.length },
    { id: 'claims', label: 'Claims', icon: MessageSquareWarning, badge: newClaims.length },
    { id: 'ncd', label: 'NCD applications', shortLabel: 'NCD', icon: BadgePercent, badge: openNcd.length },
  ];
  // Each number is the way into the work it counts.
  const kpis = [
    { label: 'Awaiting quotes', value: awaitingQuote.length, icon: FileText, detail: 'Requests ready for a response', to: `#${QUOTE_QUEUE_ID}` },
    { label: 'Certificates to issue', value: awaitingCertificate.length, icon: FileCheck2, detail: 'Paid policies awaiting documents', to: portalPath.section('policies') },
    { label: 'New claims', value: newClaims.length, icon: MessageSquareWarning, detail: 'Waiting for acknowledgement', to: portalPath.section('claims') },
    { label: 'Claims received', value: receivedClaims.length, icon: CheckCheck, detail: 'Acknowledged by your team', to: portalPath.section('claims') },
  ];
  const attentionCount = awaitingQuote.length + awaitingCertificate.length + newClaims.length + openNcd.length;

  const section = tabs.find((tab) => tab.id === activeTab);
  const sectionPath = portalPath.section(activeTab);
  const openScreen = issuingPolicy ? 'Issue policy certificate' : quotingRequest ? 'Prepare quotation' : null;
  const backToSection = () => navigate(sectionPath);

  // Finishing one item offers the next, so clearing a queue is not a round
  // trip through the list each time.
  const nextRequest = quotingRequest && awaitingQuote.find((request) => request.id !== quotingRequest.id);
  const nextPolicy = issuingPolicy && awaitingCertificate
    .filter((policy) => policy.policyNumber !== issuingPolicy.policyNumber)
    .sort(waitingLongestFirst(policyPaidAt))[0];

  let content;
  if (issuingPolicy) {
    content = (
      <PolicyIssuePanel
        policy={issuingPolicy}
        onBack={backToSection}
        onIssued={async (policyNumber, issuance) => {
          await api.policies.issueCertificate(policyNumber, issuance);
          await hydrateInsurerPortal();
          toast.success('Official policy issued', {
            description: `${policyNumber} is active. The customer can open the certificate from their account.`,
            action: nextPolicy && { label: 'Next policy', onClick: () => navigate(portalPath.issue(nextPolicy.policyNumber)) },
          });
          navigate(sectionPath, { replace: true });
        }}
      />
    );
  } else if (quotingRequest) {
    content = (
      <QuoteRequestForm
        request={quotingRequest}
        insurer={insurer}
        coverGuides={insurer?.coverGuides}
        piaRatePercentage={piaConfig?.piaRatePercentage}
        defaultValidityDays={defaultValidityDays}
        onBack={backToSection}
        onSubmit={async (quote) => {
          await api.quotes.reply(quotingRequest.id, quote);
          await hydrateInsurerPortal();
          toast.success('Quote sent', {
            description: `The customer can now see your quotation for ${quotingRequest.vehicle}.`,
            action: nextRequest && { label: 'Next request', onClick: () => navigate(portalPath.quote(nextRequest.id)) },
          });
          navigate(sectionPath, { replace: true });
        }}
      />
    );
  } else if (activeTab === 'overview') {
    content = (
      <>
        <div className="mb-6">
          <PageHeader title="Overview" description="Review quote requests, policy issuance and claims.">
            <div className="space-y-2 sm:text-right">
              <StatusBadge tone="open" className="px-3 py-1">{attentionCount} {attentionCount === 1 ? 'item needs' : 'items need'} attention</StatusBadge>
              <p className="text-xs text-muted-foreground">{plural(openNcd.length, 'NCD application')} pending</p>
            </div>
          </PageHeader>
        </div>

        <section aria-label="Operational summary" className="mb-6 grid min-w-0 grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {kpis.map(({ label, value, icon: MetricIcon, detail, to }) => {
            const card = (
              <Card className="h-full gap-3 border-border shadow-none transition-colors [--card-spacing:--spacing(4)] group-hover:bg-muted/50 sm:gap-4 sm:[--card-spacing:--spacing(6)]">
                <CardHeader className="grid-cols-[1fr_auto] items-center gap-3">
                  <CardTitle className="min-h-8 text-xs font-medium leading-4 text-muted-foreground sm:min-h-0 sm:text-sm">{label}</CardTitle>
                  <MetricIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{value}</p>
                  <p className="mt-3 hidden text-xs leading-relaxed text-muted-foreground sm:block">{detail}</p>
                </CardContent>
              </Card>
            );
            const linkClass = 'group rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
            // The quote queue is on this page, so its number is a jump down rather than a route.
            return to.startsWith('#')
              ? <a key={label} href={to} className={linkClass}>{card}</a>
              : <Link key={label} to={to} className={linkClass}>{card}</Link>;
          })}
        </section>

        <div id={QUOTE_QUEUE_ID} className="scroll-mt-20">
          <RequestQueue
            title="Quote requests"
            countLabel={`${awaitingQuote.length} awaiting a quote`}
            requests={awaitingQuote}
            emptyMessage="Every request has been quoted. Sent quotes are listed below."
            onQuote={(request) => navigate(portalPath.quote(request.id))}
          />
        </div>
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
    );
  } else if (activeTab === 'guides') {
    content = (
      <CoverGuideLibrary
        insurer={insurer}
        onSave={async (coverageType, guide) => {
          if (!insurer) throw new Error('Your insurer profile could not be found.');
          const coverGuides = { ...(insurer.coverGuides || {}), [coverageType]: guide };
          await api.insurers.update(insurer.id, { coverGuides });
          updateInsurer(insurer.id, { coverGuides });
          await hydrateInsurerPortal();
        }}
      />
    );
  } else if (activeTab === 'policies') {
    content = <PaidPoliciesTab policies={myPolicies} onIssue={(policy) => navigate(portalPath.issue(policy.policyNumber))} />;
  } else if (activeTab === 'claims') {
    content = <ClaimsTab claims={myClaims} />;
  } else {
    content = <NcdTab applications={myNcd} />;
  }

  return (
    <InsurerShell
      insurerName={insurerName}
      insurerLogo={insurer?.logoUrl}
      sections={tabs}
      activeSection={activeTab}
      trail={openScreen ? [{ label: section.label, to: sectionPath }, { label: openScreen }] : [{ label: section.label }]}
    >
      <div className="w-full pb-10">{content}</div>
    </InsurerShell>
  );
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
