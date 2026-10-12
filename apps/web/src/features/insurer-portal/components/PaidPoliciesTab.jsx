import { Download, ExternalLink, FilePenLine, ShieldCheck } from 'lucide-react';
import { formatZMW } from '@/domain/premiumEngine';
import { coverPeriodLabel } from '@/domain/coverPeriod';
import { openDocument } from '@/lib/files';
import { downloadPolicyCertificate } from '@/lib/policyDocuments';
import { timeAgo } from '@/lib/time';
import { AWAITING_CERTIFICATE, policyPaidAt, waitingLongestFirst } from '@/features/insurer-portal/portal';
import { useWorkList } from '@/features/insurer-portal/hooks/useWorkList';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import { DataTable } from '@/components/ui/data-table';
import { Detail, EmptyPanel, Fact, PageHeader, StatusBadge } from './ui';

const PAGE_SIZE = 8;
const policyId = (policy) => policy.policyNumber;

/** The moment that matters for each list: how long a paying customer has waited, or when their policy was issued. */
const lastEvent = (policy) => (policy.status !== AWAITING_CERTIFICATE && policy.issuedAt
  ? `Issued ${timeAgo(policy.issuedAt)}`
  : `Paid ${timeAgo(policyPaidAt(policy)) || 'just now'}`);

/** The request a policy came from, and the insurer's own reference for it when they gave one. */
const References = ({ policy }) => (
  <>
    <Detail className="break-all font-mono">{policy.quoteRequestId || 'Legacy policy — quote reference unavailable'}</Detail>
    {policy.insurerQuoteReference && <Detail>Your ref: <span className="break-all font-mono">{policy.insurerQuoteReference}</span></Detail>}
  </>
);

/** What both lists show about a paid policy; each list adds its own last column. */
const policyColumns = [
  {
    accessorKey: 'policyNumber',
    header: 'Policy / request',
    cell: ({ row }) => (
      <div className="min-w-44 max-w-64 whitespace-normal">
        <p className="font-mono font-medium text-foreground">{row.original.policyNumber}</p>
        <References policy={row.original} />
      </div>
    ),
  },
  {
    accessorKey: 'customerName',
    header: 'Customer',
    cell: ({ row }) => (
      <div className="min-w-36 max-w-56 whitespace-normal">
        <p className="font-medium">{row.original.customerName || 'Customer'}</p>
        <Detail>{row.original.customerPhone || row.original.customerEmail || 'Contact not supplied'}</Detail>
      </div>
    ),
  },
  {
    accessorKey: 'vehicle',
    header: 'Vehicle / cover',
    cell: ({ row }) => (
      <div className="min-w-44 max-w-64 whitespace-normal">
        <p className="font-medium">{row.original.vehicle || 'Vehicle'} <span className="font-mono font-normal text-muted-foreground">· {row.original.vehicleDetails?.plateNumber || 'Plate not supplied'}</span></p>
        <Detail>{row.original.coverage || row.original.plan || 'Policy cover'} · {coverPeriodLabel(row.original.policyDates)}</Detail>
      </div>
    ),
  },
  {
    accessorKey: 'premium',
    header: 'Premium paid',
    cell: ({ row }) => (
      <div className="min-w-28 whitespace-normal">
        <p className="font-medium tabular-nums">{formatZMW(row.original.premium || 0)}</p>
        <Detail>{lastEvent(row.original)}</Detail>
      </div>
    ),
  },
];

/** One policy on a phone: the same facts as a table row, stacked, with its action full width underneath. */
function PolicyCard({ policy, status = false, children }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-all font-mono font-medium text-foreground">{policy.policyNumber}</p>
          <References policy={policy} />
        </div>
        {status && <StatusBadge status={policy.status} />}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Customer" value={<>{policy.customerName || 'Customer'}<Detail>{policy.customerPhone || policy.customerEmail || 'Contact not supplied'}</Detail></>} />
        <Fact label="Premium paid" value={<><span className="tabular-nums">{formatZMW(policy.premium || 0)}</span><Detail>{lastEvent(policy)}</Detail></>} />
        <Fact wide label="Vehicle / cover" value={<>{policy.vehicle || 'Vehicle'} · <span className="font-mono">{policy.vehicleDetails?.plateNumber || 'Plate not supplied'}</span><Detail>{policy.coverage || policy.plan || 'Policy cover'} · {coverPeriodLabel(policy.policyDates)}</Detail></>} />
      </dl>
      {children}
    </div>
  );
}

/**
 * A work queue of paid quotes waiting for the insurer's official certificate,
 * longest wait first, and beside it the policies already issued. The work to
 * do opens first; each row carries the quote request it came from.
 */
export default function PaidPoliciesTab({ policies, onIssue }) {
  // A customer who has paid has no cover document until the certificate is
  // uploaded, so whoever paid first is served first.
  const awaiting = policies.filter((policy) => policy.status === AWAITING_CERTIFICATE).sort(waitingLongestFirst(policyPaidAt));
  const issued = policies.filter((policy) => policy.status !== AWAITING_CERTIFICATE);
  const [list, setList] = useWorkList('awaiting', 'issued', awaiting.length > 0);

  const issueAction = (policy, className) => (
    <Button type="button" onClick={() => onIssue(policy)} className={className}>
      <FilePenLine aria-hidden="true" />Review &amp; issue policy
    </Button>
  );
  const certificateAction = (policy, className) => policy.certificateDocument ? (
    <Button type="button" variant="outline" onClick={() => openDocument(policy.certificateDocument)} className={className}>
      <ExternalLink aria-hidden="true" />View certificate
    </Button>
  ) : (
    <Button type="button" variant="outline" onClick={() => downloadPolicyCertificate(policy)} className={className}>
      <Download aria-hidden="true" />Download certificate
    </Button>
  );

  const awaitingColumns = [
    ...policyColumns,
    {
      id: 'issue',
      header: 'Certificate',
      cell: ({ row }) => issueAction(row.original),
    },
  ];
  const issuedColumns = [
    ...policyColumns,
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    { id: 'certificate', header: 'Certificate', cell: ({ row }) => certificateAction(row.original) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Paid policies" description="These customers have paid and are waiting for cover. Upload your certificate to make each policy active; the longest wait is listed first.">
        {awaiting.length > 0
          ? <StatusBadge tone="open" className="px-3 py-1">{awaiting.length} {awaiting.length === 1 ? 'certificate' : 'certificates'} to issue</StatusBadge>
          : policies.length > 0 && <StatusBadge tone="settled" className="px-3 py-1">All certificates issued</StatusBadge>}
      </PageHeader>

      {policies.length === 0 ? (
        <EmptyPanel
          icon={ShieldCheck}
          title="No paid policies received yet"
          description="When a customer pays for your accepted quote, the paid request appears here for your team to issue the official certificate."
        />
      ) : (
        <Tabs value={list} onValueChange={setList} className="gap-4">
          <TabsList>
            <TabsTrigger value="awaiting">Awaiting certificate <Badge variant="secondary">{awaiting.length}</Badge></TabsTrigger>
            <TabsTrigger value="issued">Issued <Badge variant="secondary">{issued.length}</Badge></TabsTrigger>
          </TabsList>
          <TabsContent value="awaiting">
            <Card className="min-w-0 gap-0 py-0">
              <DataTable
                columns={awaitingColumns}
                data={awaiting}
                label="Policies awaiting a certificate"
                emptyMessage="Every paid policy has its certificate. New payments appear here."
                pageSize={PAGE_SIZE}
                getRowId={policyId}
                renderCard={(policy) => <PolicyCard policy={policy}>{issueAction(policy, 'w-full')}</PolicyCard>}
              />
            </Card>
          </TabsContent>
          <TabsContent value="issued">
            <Card className="min-w-0 gap-0 py-0">
              <DataTable
                columns={issuedColumns}
                data={issued}
                label="Issued policies"
                emptyMessage="No policy has been issued yet."
                pageSize={PAGE_SIZE}
                getRowId={policyId}
                renderCard={(policy) => <PolicyCard policy={policy} status>{certificateAction(policy, 'w-full')}</PolicyCard>}
              />
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
