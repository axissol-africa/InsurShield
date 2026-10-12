import { useState } from 'react';
import { BadgePercent, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api';
import { hydrateInsurerPortal } from '@/api/sync';
import { timeAgo } from '@/lib/time';
import { expectedNcdDiscount, isOpenNcdApplication, waitingLongestFirst } from '@/features/insurer-portal/portal';
import { usePortalAction } from '@/features/insurer-portal/hooks/usePortalAction';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import { DataTable } from '@/components/ui/data-table';
import DecisionDialog from './DecisionDialog';
import { ContactLinks, EmptyPanel, Fact, PageHeader, StatusBadge } from './ui';

const PAGE_SIZE = 8;
const years = (count, unit = 'yr') => `${count} ${unit}${count === 1 ? '' : 's'}`;
const applicationNumber = (application) => application.applicationNumber || application.id;
const applied = (application) => (application.submittedAt ? `Applied ${timeAgo(application.submittedAt)}` : null);

const Detail = ({ children, className = '' }) => <span className={`mt-1 block text-xs text-muted-foreground ${className}`}>{children}</span>;

/**
 * What the insurer can decide, each with what it does. Approving and
 * rejecting close the application for good; rejection is deliberately not
 * styled as an emergency — it is a routine outcome. An application already
 * under review is not offered that outcome again.
 */
const decisionsFor = (application) => [
  {
    value: 'Approved',
    title: 'Approve',
    description: `Issues a ${expectedNcdDiscount(application.yearsClaimFree)}% no-claim discount code to ${application.fullName}. This cannot be undone here.`,
    confirm: 'Approve & issue code',
    done: 'Application approved',
    doneDetail: 'The discount code is listed under Decided.',
  },
  {
    value: 'Under Review',
    title: 'Keep under review',
    description: 'Stays in your open list while you check your records. You can decide later.',
    confirm: 'Mark under review',
    done: 'Marked under review',
    doneDetail: `${application.fullName}’s application stays in your open list.`,
  },
  {
    value: 'Rejected',
    title: 'Reject',
    description: 'Closes the application without a discount code. This cannot be undone here.',
    confirm: 'Reject application',
    done: 'Application rejected',
    doneDetail: 'It is listed under Decided.',
  },
].filter((decision) => decision.value !== application.status);

const applicationColumns = [
  {
    accessorKey: 'fullName',
    header: 'Applicant',
    cell: ({ row }) => (
      <div className="min-w-40 max-w-60 whitespace-normal">
        <p className="font-medium text-foreground">{row.original.fullName}</p>
        <Detail className="break-all font-mono">{applicationNumber(row.original)}</Detail>
      </div>
    ),
  },
  { accessorKey: 'policyNumber', header: 'Policy to check', cell: ({ row }) => <span className="font-mono">{row.original.policyNumber}</span> },
  {
    accessorKey: 'yearsClaimFree',
    header: 'Claim-free',
    cell: ({ row }) => (
      <div className="min-w-28 whitespace-normal">
        <p className="font-medium tabular-nums">{years(row.original.yearsClaimFree)}</p>
        <Detail>{expectedNcdDiscount(row.original.yearsClaimFree)}% discount</Detail>
      </div>
    ),
  },
];

const Outcome = ({ application }) => (
  <div className="flex min-w-32 flex-col items-start whitespace-normal">
    <StatusBadge status={application.status} />
    {application.approvedCode
      ? <Detail>Code issued: <span className="font-mono font-medium text-foreground">{application.approvedCode}</span></Detail>
      : isOpenNcdApplication(application) && applied(application) && <Detail>{applied(application)}</Detail>}
  </div>
);

/** One application on a phone: the same facts as a table row, stacked, with its action full width underneath. */
function ApplicationCard({ application, children }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{application.fullName}</p>
          <Detail className="break-all font-mono">{applicationNumber(application)}</Detail>
        </div>
        <Outcome application={application} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Policy to check" value={<span className="font-mono">{application.policyNumber}</span>} />
        <Fact label="Claim-free" value={`${years(application.yearsClaimFree)} · ${expectedNcdDiscount(application.yearsClaimFree)}% discount`} />
      </dl>
      {children}
    </div>
  );
}

/**
 * No-claim-discount applications. The open ones are a work queue, longest
 * wait first; each is reviewed and decided on one surface, because the
 * insurer has to check its own records before any outcome.
 */
export default function NcdTab({ applications }) {
  const open = applications.filter(isOpenNcdApplication).sort(waitingLongestFirst((application) => application.submittedAt));
  const decided = applications.filter((application) => !isOpenNcdApplication(application));
  // Until the person picks a list, show the one with work in it.
  const [chosenList, setChosenList] = useState(null);
  const list = chosenList ?? (open.length > 0 || decided.length === 0 ? 'open' : 'decided');
  const [reviewingId, setReviewingId] = useState(null);
  const reviewing = open.find((application) => application.id === reviewingId);
  const deciding = usePortalAction(async (application, status) => {
    await api.ncd.decide(application.id, status);
    await hydrateInsurerPortal();
  }, 'That decision could not be saved. Please try again.');

  const startReview = (application) => {
    deciding.clearError();
    setReviewingId(application.id);
  };

  const decide = async (decision) => {
    if (!(await deciding.run(reviewing, decision.value))) return;
    setReviewingId(null);
    toast.success(decision.done, { description: decision.doneDetail });
  };

  const reviewAction = (application, className) => (
    <Button type="button" onClick={() => startReview(application)} aria-label={`Review & decide ${application.fullName}’s application`} className={className}>
      <ClipboardCheck aria-hidden="true" />Review &amp; decide
    </Button>
  );

  const openColumns = [
    ...applicationColumns,
    { id: 'status', header: 'Status', cell: ({ row }) => <Outcome application={row.original} /> },
    { id: 'decision', header: 'Decision', cell: ({ row }) => reviewAction(row.original) },
  ];
  const decidedColumns = [
    ...applicationColumns,
    { id: 'outcome', header: 'Outcome', cell: ({ row }) => <Outcome application={row.original} /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="NCD applications"
        description="Policyholders asking you to confirm their claim-free years. Check each against your own records; approving one issues the customer’s discount code. The longest wait is listed first."
      >
        {open.length > 0
          ? <StatusBadge tone="open" className="px-3 py-1">{open.length} awaiting a decision</StatusBadge>
          : applications.length > 0 && <StatusBadge tone="settled" className="px-3 py-1">All decided</StatusBadge>}
      </PageHeader>

      {applications.length === 0 ? (
        <EmptyPanel icon={BadgePercent} title="No NCD applications yet" description="When a policyholder applies for a no-claim discount with you, the application appears here for your decision." />
      ) : (
        <Tabs value={list} onValueChange={setChosenList} className="gap-4">
          <TabsList>
            <TabsTrigger value="open">Open <Badge variant="secondary">{open.length}</Badge></TabsTrigger>
            <TabsTrigger value="decided">Decided <Badge variant="secondary">{decided.length}</Badge></TabsTrigger>
          </TabsList>
          <TabsContent value="open">
            <Card className="min-w-0 gap-0 py-0">
              <DataTable
                columns={openColumns}
                data={open}
                label="Open NCD applications"
                emptyMessage="Every application has a decision. New applications appear here."
                pageSize={PAGE_SIZE}
                renderCard={(application) => <ApplicationCard application={application}>{reviewAction(application, 'w-full')}</ApplicationCard>}
              />
            </Card>
          </TabsContent>
          <TabsContent value="decided">
            <Card className="min-w-0 gap-0 py-0">
              <DataTable
                columns={decidedColumns}
                data={decided}
                label="Decided NCD applications"
                emptyMessage="No application has been decided yet."
                pageSize={PAGE_SIZE}
                renderCard={(application) => <ApplicationCard application={application} />}
              />
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {reviewing && (
        <DecisionDialog
          key={reviewing.id}
          title={`Decide ${reviewing.fullName}’s application`}
          description={<>Check policy <span className="font-mono text-foreground">{reviewing.policyNumber}</span> in your own system before you decide.</>}
          options={decisionsFor(reviewing)}
          pending={deciding.pending}
          error={deciding.error}
          onDecide={decide}
          onClose={() => setReviewingId(null)}
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl border border-border bg-muted/40 p-4">
            <Fact label="Applicant" value={<>{reviewing.fullName}<ContactLinks phone={reviewing.phone} email={reviewing.email} className="mt-1" /></>} />
            <Fact label="Application" value={<><span className="font-mono">{applicationNumber(reviewing)}</span>{applied(reviewing) && <Detail>{applied(reviewing)}</Detail>}</>} />
            <Fact label="Claim-free period claimed" value={years(reviewing.yearsClaimFree, 'year')} />
            <Fact label="Discount if approved" value={`${expectedNcdDiscount(reviewing.yearsClaimFree)}%`} />
          </dl>
        </DecisionDialog>
      )}
    </div>
  );
}
