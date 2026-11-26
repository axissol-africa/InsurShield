import { useEffect, useId, useState } from 'react';
import { api as defaultApi } from '@/api';
import { useStore } from '@/store';
import { formatDate, formatZMW } from '@/domain/premiumEngine';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { NativeSelect } from '@/components/ui/primitives/native-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import { Textarea } from '@/components/ui/primitives/textarea';
import StatementImport from './StatementImport';

/** What each kind of item means, in the words an administrator acts on. */
const KINDS = {
  REFUND_REQUIRED: 'Refund owed',
  AMOUNT_MISMATCH: 'Wrong amount taken',
  REVERSAL: 'Payment reversed by the provider',
  UNMATCHED_PROVIDER_EVENT: 'Provider event with no record',
  STATE_CONFLICT: 'Provider event that does not fit',
  ISSUANCE_FAILED: 'Policy not issued',
  ISSUANCE_OVERDUE: 'Policy issuing overdue',
  PENDING_TOO_LONG: 'Payment stuck',
  STATEMENT_UNMATCHED: 'Statement line with no record',
  MISSING_FROM_STATEMENT: 'Payment missing from statement',
  DUPLICATE: 'Duplicate',
};
const STATUSES = { OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved' };
const REFUND_STATUSES = {
  PROPOSED: 'Waiting for approval', APPROVED: 'Approved, sending', SUBMITTED: 'With the provider',
  COMPLETED: 'Refunded', REJECTED: 'Rejected', EXPIRED: 'Approval expired', FAILED: 'Provider refused',
};
const OUTCOMES = [
  ['REFUNDED', 'Refunded'],
  ['ISSUED', 'Policy issued'],
  ['ADJUSTED', 'Adjusted'],
  ['NO_ACTION', 'No action needed'],
  ['WRITTEN_OFF', 'Written off'],
];
const REFUND_REASONS = [
  ['ISSUANCE_FAILED', 'The policy was not issued'],
  ['INSURER_UNAVAILABLE', 'The insurer became unavailable'],
  ['DUPLICATE_PAYMENT', 'Paid twice'],
  ['AMOUNT_MISMATCH', 'The wrong amount was taken'],
  ['CUSTOMER_REQUEST', 'The customer asked'],
  ['OTHER', 'Another reason'],
];
const REFUND_FOR_KIND = { ISSUANCE_FAILED: 'ISSUANCE_FAILED', REFUND_REQUIRED: 'INSURER_UNAVAILABLE', AMOUNT_MISMATCH: 'AMOUNT_MISMATCH', DUPLICATE: 'DUPLICATE_PAYMENT' };

const messageOf = (fallback) => (caught) => (caught?.code && caught?.message ? caught.message : fallback);

/**
 * InsurShield's queue of money to account for: every case where money was
 * taken without a policy following, oldest first. Resolving an item records
 * what happened; only a refund, approved by a second administrator, moves money.
 */
export default function ReconciliationQueue({ api = defaultApi }) {
  const me = useStore((state) => state.staffSession?.id);
  const [status, setStatus] = useState('OPEN');
  const [items, setItems] = useState(null);
  const [next, setNext] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    api.admin.reconciliation.list({ status })
      .then((page) => {
        if (!current) return;
        setItems(page.items);
        setNext(page.next);
        setError('');
      })
      .catch((caught) => { if (current) setError(messageOf('The queue could not be loaded. Refresh to try again.')(caught)); });
    return () => { current = false; };
  }, [api, status, version]);

  const more = async () => {
    try {
      const page = await api.admin.reconciliation.list({ status, cursor: next });
      setItems((shown) => [...shown, ...page.items]);
      setNext(page.next);
    } catch (caught) {
      setError(messageOf('More items could not be loaded.')(caught));
    }
  };
  const changed = () => setVersion((value) => value + 1);

  return (
    <section aria-labelledby="reconciliation-title" className="space-y-6">
      <div>
        <h2 id="reconciliation-title" className="text-xl font-semibold">Reconciliation</h2>
        <p className="mt-1 text-sm text-muted-foreground">Money taken that has not become a policy, and anything the provider said that does not match our records. Oldest first. A refund needs a second administrator to approve it in Approvals.</p>
      </div>
      <StatementImport api={api} onImported={changed} />
      <Tabs value={status} onValueChange={(value) => { setItems(null); setStatus(value); }}>
        <TabsList aria-label="Item status">
          {Object.entries(STATUSES).map(([value, label]) => <TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {items === null && !error && <p className="text-sm text-muted-foreground">Loading the queue…</p>}
      {items?.length === 0 && <p className="text-sm text-muted-foreground">Nothing here. Every payment is accounted for.</p>}
      <ul className="space-y-4">
        {items?.map((item) => <li key={item.id}><ItemCard item={item} me={me} api={api} onChanged={changed} /></li>)}
      </ul>
      {next && <Button type="button" variant="outline" onClick={more}>Show more</Button>}
    </section>
  );
}

function ItemCard({ item, me, api, onChanged }) {
  const [step, setStep] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const open = item.status !== 'RESOLVED';
  const refundInFlight = item.refunds.some((refund) => ['PROPOSED', 'APPROVED', 'SUBMITTED'].includes(refund.status));
  const remaining = item.payment ? Math.round((item.payment.amount - item.payment.refunded) * 100) / 100 : 0;
  const canRefund = open && item.payment?.refundable === true && remaining > 0 && !refundInFlight;

  const act = async (work, fallback) => {
    setPending(true);
    setError('');
    try {
      await work();
      setStep(null);
      onChanged();
    } catch (caught) {
      setError(messageOf(fallback)(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle><h3>{KINDS[item.kind] || item.kind}</h3></CardTitle>
          <div className="flex flex-wrap gap-2">
            {item.amount !== null && <Badge variant="secondary">{formatZMW(item.amount)}</Badge>}
            <Badge variant="outline">{STATUSES[item.status]}{item.outcome ? `: ${OUTCOMES.find(([code]) => code === item.outcome)?.[1] || item.outcome}` : ''}</Badge>
          </div>
        </div>
        <CardDescription>
          Opened {formatDate(item.openedAt)} ({item.ageDays === 0 ? 'today' : `${item.ageDays} day${item.ageDays === 1 ? '' : 's'} ago`})
          {item.insurer && <> · {item.insurer}</>}
          {item.owner ? <> · Owner: {item.owner.name}</> : <> · Nobody owns it yet</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{item.reason}</p>
        <dl className="grid gap-2 sm:grid-cols-3">
          {item.payment && <Fact label="Payment" value={<span className="font-mono">{item.payment.transactionId}</span>} />}
          {item.payment && <Fact label="Paid / refunded" value={`${formatZMW(item.payment.amount)} / ${formatZMW(item.payment.refunded)}`} />}
          {item.policyNumber && <Fact label="Policy" value={<span className="font-mono">{item.policyNumber}</span>} />}
        </dl>
        {item.refunds.length > 0 && (
          <ul aria-label="Refunds" className="space-y-1">
            {item.refunds.map((refund) => (
              <li key={refund.id}>Refund {formatZMW(refund.amount)}: <strong>{REFUND_STATUSES[refund.status] || refund.status}</strong>{refund.failureReason ? ` (${refund.failureReason})` : ''}</li>
            ))}
          </ul>
        )}
        {open && item.payment?.requiresExternalRefund && <p className="text-muted-foreground">This payment was taken before payments went through a provider. Refund it outside InsurShield, then resolve the item.</p>}
        {item.resolutionNote && <p><span className="text-muted-foreground">Resolution: </span>{item.resolutionNote}</p>}

        {open && (
          <div className="flex flex-wrap gap-2">
            {item.owner?.id !== me && me && (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => act(() => api.admin.reconciliation.assign(item.id, me), 'The item could not be taken.')}>Take it</Button>
            )}
            {canRefund && <Button type="button" size="sm" onClick={() => setStep('refund')}>Propose a refund</Button>}
            {item.insurerId && <Button type="button" size="sm" variant="outline" onClick={() => setStep('adjust')}>Propose an adjustment</Button>}
            <Button type="button" size="sm" variant="outline" onClick={() => setStep('resolve')}>Resolve</Button>
          </div>
        )}
        {step === 'refund' && (
          <RefundForm
            item={item}
            remaining={remaining}
            pending={pending}
            onCancel={() => setStep(null)}
            onSubmit={(refund) => act(() => api.admin.reconciliation.proposeRefund(item.payment.transactionId, { ...refund, reconciliationItemId: item.id }), 'The refund could not be proposed.')}
          />
        )}
        {step === 'adjust' && (
          <AdjustForm
            item={item}
            pending={pending}
            onCancel={() => setStep(null)}
            onSubmit={(adjustment) => act(() => api.admin.reconciliation.proposeAdjustment({ ...adjustment, insurerId: item.insurerId, reconciliationItemId: item.id }), 'The adjustment could not be proposed.')}
          />
        )}
        {step === 'resolve' && (
          <ResolveForm
            pending={pending}
            onCancel={() => setStep(null)}
            onSubmit={(outcome, note) => act(() => api.admin.reconciliation.resolve(item.id, outcome, note), 'The item could not be resolved.')}
          />
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function RefundForm({ item, remaining, pending, onSubmit, onCancel }) {
  const id = useId();
  const [amount, setAmount] = useState(String(remaining));
  const [reasonCode, setReasonCode] = useState(REFUND_FOR_KIND[item.kind] || '');
  const [reason, setReason] = useState('');
  const value = Number(amount);
  const ready = value > 0 && value <= remaining && reasonCode && reason.trim().length >= 10;
  return (
    <form
      aria-label="Propose a refund"
      className="space-y-3 rounded-xl border border-border p-3"
      onSubmit={(event) => { event.preventDefault(); if (ready) void onSubmit({ amount: value, reasonCode, reason: reason.trim() }); }}
    >
      <p className="font-medium">Propose a refund</p>
      <p className="text-muted-foreground">Up to {formatZMW(remaining)}. A different administrator approves it before the provider is asked.</p>
      <div className="space-y-1">
        <label htmlFor={`${id}-amount`} className="block text-xs font-medium">Amount (ZMW) *</label>
        <Input id={`${id}-amount`} type="number" min="0.01" step="0.01" max={remaining} value={amount} onChange={(event) => setAmount(event.target.value)} className="sm:max-w-48" />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-code`} className="block text-xs font-medium">Reason *</label>
        <NativeSelect id={`${id}-code`} value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} className="w-full">
          <option value="">Choose a reason</option>
          {REFUND_REASONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-reason`} className="block text-xs font-medium">What happened, for the approver *</label>
        <Textarea id={`${id}-reason`} rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ready || pending} aria-busy={pending}>Send for approval</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>Back</Button>
      </div>
    </form>
  );
}

/** Money moved in the insurer's next settlement; the item resolves as adjusted once a second administrator approves it. */
function AdjustForm({ item, pending, onSubmit, onCancel }) {
  const id = useId();
  const [amount, setAmount] = useState(item.amount ? String(-item.amount) : '');
  const [kind, setKind] = useState(item.kind === 'REVERSAL' ? 'REVERSAL_RECOVERY' : 'SETTLEMENT_CORRECTION');
  const [reason, setReason] = useState('');
  const value = Number(amount);
  const ready = amount !== '' && Number.isFinite(value) && value !== 0 && reason.trim().length >= 10;
  return (
    <form
      aria-label="Propose an adjustment"
      className="space-y-3 rounded-xl border border-border p-3"
      onSubmit={(event) => { event.preventDefault(); if (ready) void onSubmit({ amount: value, kind, reason: reason.trim() }); }}
    >
      <p className="font-medium">Propose an adjustment to {item.insurer}</p>
      <p className="text-muted-foreground">Negative takes money back in its next settlement; positive pays it more. A different administrator approves it.</p>
      <div className="space-y-1">
        <label htmlFor={`${id}-amount`} className="block text-xs font-medium">Amount (ZMW) *</label>
        <Input id={`${id}-amount`} type="number" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="sm:max-w-48" />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-kind`} className="block text-xs font-medium">Kind *</label>
        <NativeSelect id={`${id}-kind`} value={kind} onChange={(event) => setKind(event.target.value)} className="w-full">
          <option value="SETTLEMENT_CORRECTION">Correct an earlier settlement</option>
          <option value="REVERSAL_RECOVERY">Recover a reversed payment</option>
          <option value="FEE_CORRECTION">Correct a charge</option>
          <option value="OTHER">Another reason</option>
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-reason`} className="block text-xs font-medium">Why, for the approver *</label>
        <Textarea id={`${id}-reason`} rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ready || pending} aria-busy={pending}>Send for approval</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>Back</Button>
      </div>
    </form>
  );
}

function ResolveForm({ pending, onSubmit, onCancel }) {
  const id = useId();
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const ready = outcome && note.trim().length >= 10;
  return (
    <form
      aria-label="Resolve the item"
      className="space-y-3 rounded-xl border border-border p-3"
      onSubmit={(event) => { event.preventDefault(); if (ready) void onSubmit(outcome, note.trim()); }}
    >
      <p className="font-medium">Resolve the item</p>
      <p className="text-muted-foreground">This records what happened. It does not move any money.</p>
      <div className="space-y-1">
        <label htmlFor={`${id}-outcome`} className="block text-xs font-medium">Outcome *</label>
        <NativeSelect id={`${id}-outcome`} value={outcome} onChange={(event) => setOutcome(event.target.value)} className="w-full">
          <option value="">Choose the outcome</option>
          {OUTCOMES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-note`} className="block text-xs font-medium">What was done *</label>
        <Textarea id={`${id}-note`} rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!ready || pending} aria-busy={pending}>Resolve</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>Back</Button>
      </div>
    </form>
  );
}

function Fact({ label, value }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>;
}
