import { useEffect, useRef, useState } from 'react';
import { CircleCheck, FileText, Inbox, PhoneIncoming, Search, ShieldAlert, TriangleAlert } from 'lucide-react';
import { api } from '@/api';
import { hydrateInsurerPortal } from '@/api/sync';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/time';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePortalAction } from '@/features/insurer-portal/hooks/usePortalAction';
import { Alert, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/primitives/input-group';
import { Separator } from '@/components/ui/primitives/separator';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/primitives/item';
import { Spinner } from '@/components/ui/primitives/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/primitives/toggle-group';
import { BackButton, ContactLinks, EmptyPanel, Fact, FactGroup, PageHeader, StatusBadge, StepTrack } from './ui';

const NEW = 'Notified';
const RECEIVED = 'Received by insurer';

const FILTERS = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'new', label: 'New', matches: (claim) => claim.status === NEW },
  { id: 'received', label: 'Received', matches: (claim) => claim.status === RECEIVED },
];

const matchesQuery = (claim, query) =>
  [claim.claimNumber, claim.id, claim.fullName, claim.plate, claim.phone].some((value) => String(value || '').toLowerCase().includes(query));

/** Claims still waiting for a call first, then the most recent notification. */
const callsFirst = (first, second) =>
  (second.status === NEW) - (first.status === NEW) || new Date(second.submittedAt || 0) - new Date(first.submittedAt || 0);

const claimNumber = (claim) => claim.claimNumber || claim.id;
const listItemId = (claim) => `claim-${claim.id}`;

/**
 * First-notification inbox. The insurer looks up the claim number a customer
 * quotes on the phone and marks it received; assessment and settlement then
 * continue in the insurer's own claims system.
 */
export default function ClaimsTab({ claims }) {
  const [query, setQuery] = useState('');
  const [filterId, setFilterId] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const lastOpenedId = useRef(null);

  const trimmed = query.trim().toLowerCase();
  const filter = FILTERS.find((candidate) => candidate.id === filterId);
  const visible = claims.filter((claim) => filter.matches(claim) && (!trimmed || matchesQuery(claim, trimmed))).sort(callsFirst);
  const selected = claims.find((claim) => claim.id === selectedId) || null;
  const notReceived = claims.filter((claim) => claim.status === NEW).length;

  // On a phone the claim replaces the list, so coming back has to put the
  // person where they were rather than at the top of the page.
  useEffect(() => {
    if (selectedId === null && lastOpenedId.current) document.getElementById(lastOpenedId.current)?.focus();
  }, [selectedId]);

  const select = (claim) => {
    lastOpenedId.current = listItemId(claim);
    setSelectedId(claim.id);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Claims"
        description="First notifications from your policyholders. Find the claim number a customer quotes on the phone and mark it received; assessment and settlement continue in your own claims system."
      >
        {notReceived > 0
          ? <StatusBadge tone="open" className="px-3 py-1">{notReceived} not yet received</StatusBadge>
          : claims.length > 0 && <StatusBadge tone="settled" className="px-3 py-1">All received</StatusBadge>}
      </PageHeader>

      {claims.length === 0 ? (
        <EmptyPanel icon={Inbox} title="No claims yet" description="When a policyholder notifies a claim, it appears here with the claim number they will quote when they call." />
      ) : (
        <Card className="min-w-0 gap-0 py-0 md:grid md:min-h-[34rem] md:grid-cols-[20rem_minmax(0,1fr)]">
          {/* ── Inbox ─────────────────────────────────────────────── */}
          <div className={cn('min-w-0 flex-col md:flex md:border-r md:border-border', selected ? 'hidden' : 'flex')}>
            <div className="space-y-3 border-b border-border p-4">
              <InputGroup>
                <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
                <InputGroupInput
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Claim number, name or plate"
                  aria-label="Find by claim number, name or plate"
                />
              </InputGroup>
              <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={filterId} onValueChange={(next) => next && setFilterId(next)} aria-label="Show claims" className="w-full">
                {FILTERS.map(({ id, label, matches }) => (
                  <ToggleGroupItem key={id} value={id} className="flex-1 gap-1.5 data-[state=on]:bg-primary/10 data-[state=on]:text-primary">
                    {label} <span className="tabular-nums opacity-70">{claims.filter(matches).length}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {visible.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {trimmed ? `No notification matches “${query.trim()}”.` : `No ${filter.label.toLowerCase()} notifications.`}
              </p>
            ) : (
              <ul aria-label="Claim notifications" className="flex-1 space-y-1 overflow-y-auto p-2 md:max-h-[34rem]">
                {visible.map((claim) => (
                  <li key={claim.id}>
                    <ClaimListItem claim={claim} active={claim.id === selectedId} onSelect={() => select(claim)} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Detail ────────────────────────────────────────────── */}
          {selected ? (
            <ClaimDetail key={selected.id} claim={selected} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="hidden items-center justify-center md:flex">
              <EmptyPanel
                icon={ShieldAlert}
                title="Select a notification"
                description="Look up the claim number a customer quotes on the phone and mark it received."
                className="border-0"
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ClaimListItem({ claim, active, onSelect }) {
  return (
    <Item asChild size="sm" className={cn('items-start text-left hover:bg-muted', active && 'border-primary/30 bg-primary/5 hover:bg-primary/5')}>
      <button type="button" id={listItemId(claim)} onClick={onSelect} aria-current={active ? 'true' : undefined}>
        <ItemContent className="min-w-0">
          <ItemTitle className="w-full justify-between">
            <span className="truncate">{claim.type}</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground">{timeAgo(claim.submittedAt)}</span>
          </ItemTitle>
          <span className="truncate font-mono text-xs text-muted-foreground">{claimNumber(claim)}</span>
          <span className="truncate text-sm text-muted-foreground">{claim.fullName}</span>
          <StatusBadge status={claim.status} className="mt-1" />
        </ItemContent>
      </button>
    </Item>
  );
}

function ClaimDetail({ claim, onBack }) {
  const region = useRef(null);
  const isMobile = useIsMobile();
  const received = claim.status === RECEIVED;
  const number = claimNumber(claim);
  const documents = claim.supportingDocs || [];
  const marking = usePortalAction(async () => {
    await api.claims.markReceived(number);
    await hydrateInsurerPortal();
  }, 'This claim could not be marked as received. Please try again.');

  // The list is hidden behind the claim on a phone; take the keyboard and
  // screen-reader position with it.
  // Its top is brought below the fixed header rather than left wherever focus
  // would scroll it.
  useEffect(() => {
    if (!isMobile) return;
    region.current?.focus({ preventScroll: true });
    region.current?.scrollIntoView?.({ block: 'start' });
  }, [isMobile]);

  const steps = [
    { id: 'notified', label: 'Notified by the customer', state: 'done', note: timeAgo(claim.submittedAt) },
    received
      ? { id: 'received', label: 'Received by you', state: 'done', note: timeAgo(claim.receivedAt) }
      : { id: 'received', label: 'Mark it received', state: 'current', note: 'Your step' },
    { id: 'handled', label: 'Handled in your claims system', state: received ? 'current' : 'next' },
  ];

  return (
    <section ref={region} tabIndex={-1} aria-label={`Claim ${number}`} className="flex min-w-0 scroll-mt-20 flex-col outline-none">
      <div className="flex items-start gap-3 border-b border-border p-4 sm:p-6">
        <div className="md:hidden"><BackButton onClick={onBack} label="Back to notifications" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-base font-medium">{number}</span>
            <StatusBadge status={claim.status} />
          </div>
          <h2 className="mt-2 text-lg font-semibold tracking-tight">{claim.type}</h2>
        </div>
      </div>

      <div className="flex-1 space-y-6 p-4 sm:p-6">
        <StepTrack label="Where this claim stands" steps={steps} />
        <Separator />

        {/* The caller quotes the claim number; these are the details to check them against. */}
        <FactGroup title="Who is calling">
          <Fact label="Policyholder" value={claim.fullName || '—'} />
          {(claim.phone || claim.email) && <Fact label="Contact" value={<ContactLinks phone={claim.phone} email={claim.email} />} />}
          <Fact label="Vehicle" value={<>{claim.vehicle || '—'} {claim.plate && <Badge variant="outline" className="ml-1 font-mono">{claim.plate}</Badge>}</>} />
          {(claim.policyNumber || claim.coverageType) && <Fact label="Policy / cover" value={claim.policyNumber || claim.coverageType} />}
        </FactGroup>
        <Separator />

        <FactGroup title="What happened">
          <Fact label="Incident date" value={formatDate(claim.incidentDate)} />
          {claim.location && <Fact label="Location" value={claim.location} />}
          {claim.estimatedLoss && <Fact label="Estimated loss" value={<span className="tabular-nums">{formatZMW(parseFloat(claim.estimatedLoss))}</span>} />}
          {claim.lateReason && <Fact label="Late notification reason" value={claim.lateReason} />}
          {claim.description && <Fact wide label="In the customer’s words" value={<span className="leading-relaxed">{claim.description}</span>} />}
        </FactGroup>
        <Separator />

        <FactGroup title="Evidence">
          <Fact label="Police report" value={claim.policeReport ? `Reported — ${claim.policeReportNumber || 'number not given'}` : 'No police report'} />
          <Fact
            label="Documents"
            value={documents.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {documents.map((doc, index) => (
                  <li key={`${doc.name}-${index}`}>
                    <Badge variant="outline" className="h-auto max-w-full py-1"><FileText aria-hidden="true" /><span className="truncate">{doc.name || doc.fileName || 'Document'}</span></Badge>
                  </li>
                ))}
              </ul>
            ) : 'No documents attached'}
          />
        </FactGroup>
      </div>

      <div className="space-y-3 border-t border-border bg-muted/40 p-4 sm:p-6">
        {received ? (
          <Item variant="outline" size="sm" className="bg-card">
            <ItemMedia variant="icon"><CircleCheck className="text-primary" aria-hidden="true" /></ItemMedia>
            <ItemContent>
              <ItemDescription className="text-foreground">Received — this claim continues in your own claims system.</ItemDescription>
            </ItemContent>
          </Item>
        ) : (
          <>
            <p id="mark-received-hint" className="text-sm leading-relaxed text-muted-foreground">
              Once you have spoken to the customer, mark the claim received so they can see it reached you.
              Assessment and settlement continue in your own claims system.
            </p>
            {marking.error && (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden="true" />
                <AlertTitle>{marking.error}</AlertTitle>
              </Alert>
            )}
            <Button type="button" size="lg" onClick={() => marking.run()} disabled={marking.pending} aria-busy={marking.pending} aria-describedby="mark-received-hint" className="w-full sm:w-auto">
              {marking.pending ? <Spinner aria-hidden="true" /> : <PhoneIncoming aria-hidden="true" />}
              {marking.pending ? 'Saving…' : 'Mark as received'}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
