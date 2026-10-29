import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BadgePercent, FileCheck2, FileText, HeartPulse, LayoutDashboard, LifeBuoy, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { useStore, belongsToCustomer, DEMO_CUSTOMER_ACCOUNT } from '@/store';
import { hydrateCustomer } from '@/api/sync';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { requestStatus } from '@/domain/quoteValidity';
import { coverPeriod } from '@/domain/coverPeriod';
import { downloadPolicyCertificate, downloadRtsaDisc } from '@/lib/policyDocuments';
import { openDocument } from '@/lib/files';
import Meta from '@/components/ui/Meta';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CoverGuideReader from '@/components/cover-guide/CoverGuideReader';
import { documentButtonClass as documentButton } from '@/components/ui/documentButton';
import { needsCoverGuideSelection } from '@/store/shared';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/primitives/pagination';

const AWAITING_CERTIFICATE = 'Awaiting insurer certificate';
const QUOTE_REQUESTS_PER_PAGE = 5;

const ACCOUNT_SECTION_COPY = {
  overview: { title: 'Overview', description: 'Your insurance activity at a glance.' },
  certificates: { title: 'Certificates', description: 'Track paid quotes while insurers prepare the official policy certificate.' },
  policies: { title: 'Policies', description: 'View active cover, certificates and renewal details.' },
  quotes: { title: 'Quote activity', description: 'Review cover guides, quotations and requests you have sent.' },
};

const requestDate = (request) => {
  const timestamp = new Date(request.quotesRequestedAt || request.submittedAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const visiblePages = (pageCount, currentPage) => {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const pages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount])]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((first, second) => first - second);

  return pages.flatMap((page, index) => {
    const previousPage = pages[index - 1];
    return index > 0 && page - previousPage > 1
      ? [`ellipsis-${previousPage}-${page}`, page]
      : [page];
  });
};

/** The insurer's uploaded certificate; policies issued before certificates were uploaded get a generated summary. */
const openCertificate = (policy) =>
  policy.certificateDocument ? openDocument(policy.certificateDocument) : downloadPolicyCertificate(policy);

export default function CustomerAccountPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { customer, policies, quoteRequests, claims, setActiveQuoteRequest, deleteCurrentAccount, requoteFromRequest, resetJourney } = useStore();

  // Your records come from the server when one is configured; a no-op otherwise.
  useEffect(() => { void hydrateCustomer(); }, []);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [readingGuide, setReadingGuide] = useState(null); // the policy whose cover guide is open
  const isDemoAccount = customer?.email === DEMO_CUSTOMER_ACCOUNT.email;
  const requestedSection = searchParams.get('section');
  const activeSection = ACCOUNT_SECTION_COPY[requestedSection] ? requestedSection : 'overview';
  const sectionCopy = ACCOUNT_SECTION_COPY[activeSection];

  const mine = belongsToCustomer(customer);
  const myPolicies = policies.filter((policy) => mine(policy) && policy.status === 'Active');
  const pendingPolicies = policies.filter((policy) => mine(policy) && policy.status === AWAITING_CERTIFICATE);
  const myRequests = quoteRequests.filter(mine).sort((first, second) => requestDate(second) - requestDate(first));
  const myClaims = claims.filter(mine);
  const requestPageCount = Math.max(1, Math.ceil(myRequests.length / QUOTE_REQUESTS_PER_PAGE));
  const requestedPage = Number.parseInt(searchParams.get('page') || '1', 10);
  const currentRequestPage = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    requestPageCount,
  );
  const firstRequestIndex = (currentRequestPage - 1) * QUOTE_REQUESTS_PER_PAGE;
  const displayedRequests = myRequests.slice(firstRequestIndex, firstRequestIndex + QUOTE_REQUESTS_PER_PAGE);
  const requestPages = visiblePages(requestPageCount, currentRequestPage);

  const requestPageHref = (page) => page > 1 ? `/account?section=quotes&page=${page}` : '/account?section=quotes';
  const goToRequestPage = (event, page) => {
    event.preventDefault();
    if (page < 1 || page > requestPageCount || page === currentRequestPage) return;

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('section', 'quotes');
    if (page === 1) nextSearchParams.delete('page');
    else nextSearchParams.set('page', String(page));
    setSearchParams(nextSearchParams);
  };

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
    <main className="min-h-full bg-muted/60">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 pb-24 sm:px-6 sm:py-8 lg:px-8">
        <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
          <AccountSidebar
            customer={customer}
            counts={{ policies: myPolicies.length, quotes: myRequests.length, certificates: pendingPolicies.length, claims: myClaims.length }}
            activeSection={activeSection}
            onNewQuote={resetJourney}
          />

          <div className="min-w-0">
            <section className="scroll-mt-28">
              <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">My InsurShield</Badge>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                {activeSection === 'overview' ? `Welcome back, ${customer?.fullName?.split(' ')[0] || 'there'}.` : sectionCopy.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {activeSection === 'overview'
                  ? 'Your policies, quote requests, renewals and claims — all in one secure place.'
                  : sectionCopy.description}
              </p>
            </section>

            <MobileQuickActions onNewQuote={resetJourney} />
            <MobileAccountNavigation activeSection={activeSection} />

        {activeSection === 'overview' && <section aria-label="Account summary" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          {summary.map(([label, value, icon]) => (
            <Card key={label} size="sm" className="gap-3 border-border shadow-none">
              <CardHeader className="grid-cols-[1fr_auto] items-center gap-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                <span className="material-symbols-outlined rounded-lg bg-primary/10 p-2 text-[18px] text-primary" aria-hidden="true">{icon}</span>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{value}</p>
                <p className="mt-2 text-xs text-muted-foreground">{label === 'Quote requests' ? 'Track each insurer response' : label === 'Claims' ? 'Notifications linked to your account' : 'Policies currently in force'}</p>
              </CardContent>
            </Card>
          ))}
        </section>}

        {activeSection === 'overview' && (
          <section aria-label="Account overview" className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
            <Card className="gap-0 border-border shadow-none">
              <CardHeader className="border-b">
                <CardTitle>What needs your attention</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Continue where you left off or check the latest update from your insurers.</p>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  <Link to={pendingPolicies.length ? '/account?section=certificates' : '/account?section=policies'} className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileCheck2 className="size-4" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{pendingPolicies.length ? 'Certificate being prepared' : 'Your policy documents'}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{pendingPolicies.length ? `${pendingPolicies.length} paid quote${pendingPolicies.length === 1 ? '' : 's'} awaiting the insurer’s certificate.` : 'Open certificates, cover guides and road tax discs for your active cover.'}</span>
                    </span>
                    <span className="text-sm font-medium text-primary">View</span>
                  </Link>
                  <Link to="/account?section=quotes" className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="size-4" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">Quote activity</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{myRequests.length ? `${myRequests.length} request${myRequests.length === 1 ? '' : 's'} to review, compare or follow up.` : 'Start a quote to compare cover from active insurers.'}</span>
                    </span>
                    <span className="text-sm font-medium text-primary">View</span>
                  </Link>
                  <Link to="/claims" className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><HeartPulse className="size-4" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">Claims &amp; NCD</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{myClaims.length ? `${myClaims.length} claim${myClaims.length === 1 ? '' : 's'} linked to your account.` : 'Notify your insurer or apply for a No Claim Discount when you need to.'}</span>
                    </span>
                    <span className="text-sm font-medium text-primary">Open</span>
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="gap-0 border-primary/20 shadow-none">
              <CardHeader className="border-b border-primary/10 bg-primary/[0.025]">
                <CardTitle className="text-primary">Your cover at a glance</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Everything remains attached to your account.</p>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 pt-5">
                {[
                  ['Active cover', myPolicies.length],
                  ['Certificates pending', pendingPolicies.length],
                  ['Quote requests', myRequests.length],
                  ['Claims', myClaims.length],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-primary/15 bg-primary/[0.035] p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-primary tabular-nums">{value}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {activeSection === 'certificates' && (
          <Card id="certificates" className="mt-6 scroll-mt-28 gap-4 border-primary/20 shadow-none">
            <CardHeader className="grid-cols-[1fr_auto] items-start gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="material-symbols-outlined mt-0.5 rounded-lg bg-primary/10 p-2 text-[18px] text-primary" aria-hidden="true">pending_actions</span>
                <div><CardTitle>Certificate being prepared</CardTitle><p className="mt-1 text-sm text-muted-foreground">Your insurer is preparing the official document for each paid quote below.</p></div>
              </div>
              <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">{pendingPolicies.length} pending</Badge>
            </CardHeader>
            <CardContent>
              {pendingPolicies.length ? (
                <ul className="grid gap-3 md:grid-cols-2">
                  {pendingPolicies.map((policy) => (
                    <li key={policy.policyNumber} className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
                      <span className="material-symbols-outlined rounded-lg bg-background p-2 text-[18px] text-primary" aria-hidden="true">description</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{policy.insurer}</p>
                            <p className="mt-1 text-xs text-muted-foreground">Paid quote <span className="font-mono text-foreground">{policy.quoteRequestId}</span></p>
                          </div>
                          <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">Preparing</Badge>
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">We will place the official certificate under Policies as soon as your insurer issues it.</p>
                        {/* The certificate can take days; what the customer has already paid for is readable meanwhile. */}
                        {(policy.coverGuide?.planName || policy.quoteDocument) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {policy.coverGuide?.planName && (
                              <Button type="button" variant="outline" size="sm" onClick={() => setReadingGuide(policy)}>
                                <span className="material-symbols-outlined" aria-hidden="true">description</span>Cover guide
                              </Button>
                            )}
                            {policy.quoteDocument && (
                              <Button type="button" variant="outline" size="sm" onClick={() => openDocument(policy.quoteDocument)}>
                                <span className="material-symbols-outlined" aria-hidden="true">open_in_new</span>Quotation
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <Empty text="No paid quotes are waiting for a policy certificate." />}
            </CardContent>
          </Card>
        )}

        {/* ── Policies and requests ────────────────────────────── */}
        {(activeSection === 'policies' || activeSection === 'quotes') && (
        <section className="mt-6 max-w-5xl">
          {activeSection === 'policies' && <Card className="gap-0 border-border shadow-none">
            <CardHeader className="grid-cols-[1fr_auto] items-center border-b">
              <div>
                <CardTitle>Policies</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Certificates and documents for cover that is active.</p>
              </div>
              {myPolicies.length > 0 && (
                <Button asChild variant="ghost" size="sm"><Link to="/renewal">Renew</Link></Button>
              )}
            </CardHeader>

            {myPolicies.length ? (
              <CardContent className="pt-5">
              <ul className="overflow-hidden rounded-xl border border-border">
                {myPolicies.map((policy, index) => (
                  <li key={policy.policyNumber} className={`p-4 sm:p-5 ${index === 0 ? '' : 'border-t border-border'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{policy.insurer}</p>
                        <Meta className="mt-1.5 block truncate text-primary">{policy.policyNumber}</Meta>
                        <p className="mt-1 truncate text-[12px] text-ink-muted">
                          {policy.vehicle}{policy.vehicleDetails?.plateNumber ? ` · ${policy.vehicleDetails.plateNumber}` : ''}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 border-primary/20 bg-primary/10 text-primary">Active</Badge>
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

                    <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
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
                      {/* What the policy actually covers, as it read when it
                          was bought — not as the insurer words it today. */}
                      {policy.coverGuide?.planName && (
                        <button type="button" onClick={() => setReadingGuide(policy)} className={documentButton}>
                          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">description</span>
                          Cover guide
                        </button>
                      )}
                      {policy.quoteDocument && (
                        <button type="button" onClick={() => openDocument(policy.quoteDocument)} className={documentButton}>
                          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span>
                          Quotation
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              </CardContent>
            ) : (
              <CardContent><Empty text="Policies you buy through InsurShield will appear here." /></CardContent>
            )}
          </Card>}

          {activeSection === 'quotes' && <Card className="gap-0 border-border shadow-none">
            <CardHeader className="border-b">
              <CardTitle>Quote activity</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Your latest requests, guide choices and insurer quotations.</p>
            </CardHeader>

            {myRequests.length ? (
              <CardContent className="pt-5">
              <ul className="overflow-hidden rounded-xl border border-border">
                {displayedRequests.map((request, index) => {
                  const total = request.insurers?.length || 0;
                  const status = requestStatus(request);
                  const choosingGuides = needsCoverGuideSelection(request);
                  const [tone, label] = {
                    expired: ['border-line-strong text-ink-faint', 'Expired'],
                    expiring: ['border-primary/30 bg-primary/10 text-primary', `Expiring · ${status.validQuotes} valid`],
                    quoted: ['border-primary/30 bg-primary/10 text-primary', `${status.replies}/${total} replied`],
                    pending: ['border-line-strong text-ink-muted', `${status.replies}/${total} replied`],
                  }[status.status];
                  const statusTone = choosingGuides ? 'border-primary/30 bg-primary/10 text-primary' : tone;
                  const statusLabel = choosingGuides ? 'Choose cover guides' : label;

                  return (
                    <li key={request.id} className={`p-4 sm:p-5 ${index === 0 ? '' : 'border-t border-border'} ${status.status === 'expired' ? 'bg-muted/40' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{request.vehicle}</p>
                          <Meta className="mt-1.5 block truncate text-primary">{request.id}</Meta>
                          <p className="mt-1 text-[12px] leading-[1.45] text-ink-muted">
                            {choosingGuides
                              ? 'Cover guides are ready. Choose the insurers that should prepare a final quote.'
                              : `Sent ${formatDate(request.quotesRequestedAt || request.submittedAt)} to ${total} insurer${total === 1 ? '' : 's'}`}
                            {request.requotedAs ? ` · re-requested as ${request.requotedAs}` : ''}
                          </p>
                        </div>
                        <Badge variant="outline" className={`shrink-0 whitespace-nowrap ${statusTone}`}>{statusLabel}</Badge>
                      </div>

                      {choosingGuides ? (
                        <button type="button" onClick={() => openRequest(request)} className="group mt-4 inline-flex items-center gap-2 text-[14px] font-medium text-primary underline-offset-4 hover:underline">
                          Choose cover guides
                          <span className="material-symbols-outlined text-[16px] transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
                        </button>
                      ) : status.status === 'expired' ? (
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
              </CardContent>
            ) : (
              <CardContent><Empty
                text="Complete your vehicle details to compare cover guides, then request final quotes from the insurers you choose."
                action={<Link to="/insurance-type" className="text-primary underline-offset-4 hover:underline">Start a quote</Link>}
              /></CardContent>
            )}
            {requestPageCount > 1 && (
              <CardFooter className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {firstRequestIndex + 1}–{Math.min(firstRequestIndex + QUOTE_REQUESTS_PER_PAGE, myRequests.length)} of {myRequests.length} requests
                </p>
                <Pagination className="mx-0 w-auto sm:ml-auto">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href={requestPageHref(currentRequestPage - 1)}
                        className={currentRequestPage === 1 ? 'pointer-events-none opacity-45' : undefined}
                        aria-disabled={currentRequestPage === 1}
                        onClick={(event) => goToRequestPage(event, currentRequestPage - 1)}
                      />
                    </PaginationItem>
                    {requestPages.map((page) => (
                      typeof page === 'number' ? (
                        <PaginationItem key={page}>
                          <PaginationLink
                            href={requestPageHref(page)}
                            isActive={page === currentRequestPage}
                            onClick={(event) => goToRequestPage(event, page)}
                          >
                            {page}
                          </PaginationLink>
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={page}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )
                    ))}
                    <PaginationItem>
                      <PaginationNext
                        href={requestPageHref(currentRequestPage + 1)}
                        className={currentRequestPage === requestPageCount ? 'pointer-events-none opacity-45' : undefined}
                        aria-disabled={currentRequestPage === requestPageCount}
                        onClick={(event) => goToRequestPage(event, currentRequestPage + 1)}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </CardFooter>
            )}
          </Card>}
        </section>
        )}

        {/* ── The account itself ───────────────────────────────── */}
        {activeSection === 'overview' && !isDemoAccount && (
          <Card className="mt-6 gap-3 border-border shadow-none">
            <CardHeader className="grid-cols-[1fr_auto] items-center">
              <div>
                <CardTitle>Account details</CardTitle>
                {/* A phone number is not collected at sign-up, so it is only shown once there is one. */}
                <p className="mt-1 text-sm text-muted-foreground">
                {[customer?.fullName, customer?.email, customer?.phone].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingRemoval(true)} className="text-primary hover:bg-primary/10 hover:text-primary">Close account</Button>
            </CardHeader>
          </Card>
        )}
          </div>
        </div>
      </div>

      {readingGuide && (
        <CoverGuideReader
          guide={readingGuide.coverGuide}
          insurerName={readingGuide.insurer}
          onClose={() => setReadingGuide(null)}
        />
      )}

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


function Empty({ text, action }) {
  return (
    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 border border-dashed border-line-strong p-6 text-[13px] leading-[1.6] text-ink-muted">
      {text}
      {action && <> {action}</>}
    </motion.p>
  );
}

function AccountSidebar({ customer, counts, activeSection, onNewQuote }) {
  const initials = (customer?.fullName || 'InsurShield')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  const sections = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'certificates', label: 'Certificates', icon: FileCheck2, count: counts.certificates },
    { id: 'policies', label: 'Policies', icon: ShieldCheck, count: counts.policies },
    { id: 'quotes', label: 'Quote activity', icon: FileText, count: counts.quotes },
  ];

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 flex min-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">
              {initials || 'I'}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{customer?.fullName || 'My account'}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Customer workspace</p>
            </div>
          </div>
        </div>

        <nav aria-label="My account sections" className="p-2">
          <p className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Workspace</p>
          <div className="space-y-1">
            {sections.map(({ id, label, icon: Icon, count }) => (
              <Link
                key={id}
                to={id === 'overview' ? '/account' : `/account?section=${id}`}
                aria-current={activeSection === id ? 'page' : undefined}
                className={`flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${activeSection === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {count > 0 && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">{count}</span>}
              </Link>
            ))}
            <Link to="/claims" className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <HeartPulse className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Claims &amp; NCD</span>
              {counts.claims > 0 && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">{counts.claims}</span>}
            </Link>
          </div>
        </nav>

        <div className="mt-3 border-t border-border p-3">
          <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Quick actions</p>
          <div className="space-y-1">
            <Link to="/insurance-type" onClick={onNewQuote} className="flex min-h-10 items-center gap-3 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              <Plus className="size-4" aria-hidden="true" /> New quote
            </Link>
            <Link to="/renewal" className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <RefreshCw className="size-4" aria-hidden="true" /> Renew a policy
            </Link>
            <Link to="/claims?action=claim" className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <HeartPulse className="size-4" aria-hidden="true" /> Start a claim
            </Link>
            <Link to="/claims?action=ncd" className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <BadgePercent className="size-4" aria-hidden="true" /> Apply for NCD
            </Link>
          </div>
        </div>
        <div className="mt-auto border-t border-border p-3">
          <Link to="/support" className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <LifeBuoy className="size-4" aria-hidden="true" />
            Help &amp; support
          </Link>
        </div>
      </div>
    </aside>
  );
}

function MobileQuickActions({ onNewQuote }) {
  return (
    <section aria-label="Quick actions" className="mt-6 lg:hidden">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Quick actions</p>
      <div className="grid grid-cols-2 gap-2">
        <Button asChild className="justify-start"><Link to="/insurance-type" onClick={onNewQuote}><Plus aria-hidden="true" />New quote</Link></Button>
        <Button asChild variant="outline" className="justify-start"><Link to="/renewal"><RefreshCw aria-hidden="true" />Renew</Link></Button>
        <Button asChild variant="outline" className="justify-start"><Link to="/claims?action=claim"><HeartPulse aria-hidden="true" />New claim</Link></Button>
        <Button asChild variant="outline" className="justify-start"><Link to="/claims?action=ncd"><BadgePercent aria-hidden="true" />Apply for NCD</Link></Button>
      </div>
    </section>
  );
}

function MobileAccountNavigation({ activeSection }) {
  const sections = [
    ['overview', 'Overview'],
    ['certificates', 'Certificates'],
    ['policies', 'Policies'],
    ['quotes', 'Quotes'],
    ['claims', 'Claims & NCD', '/claims'],
  ];

  return (
    <nav aria-label="My account sections" className="mt-4 -mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:hidden">
      <div className="flex min-w-max gap-2 pb-1">
        {sections.map(([id, label, path]) => (
          <Link
            key={id}
            to={path || (id === 'overview' ? '/account' : `/account?section=${id}`)}
            aria-current={path ? undefined : activeSection === id ? 'page' : undefined}
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${!path && activeSection === id ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:text-foreground'}`}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
