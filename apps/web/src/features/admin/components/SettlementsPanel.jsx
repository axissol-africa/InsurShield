import { useEffect, useId, useState } from 'react';
import { api as defaultApi } from '@/api';
import { formatZMW } from '@/domain/premiumEngine';
import { downloadCsv } from '@/lib/downloadCsv';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { NativeSelect } from '@/components/ui/primitives/native-select';
import { Textarea } from '@/components/ui/primitives/textarea';

const STATUSES = { DRAFT: 'Draft', PROPOSED: 'Waiting for approval', FINALISED: 'Finalised' };
const LINE_KINDS = { PAYMENT: 'Payment', REFUND: 'Refund', ADJUSTMENT: 'Adjustment' };
const ADJUSTMENT_KINDS = [
  ['SETTLEMENT_CORRECTION', 'Correct an earlier settlement'],
  ['REVERSAL_RECOVERY', 'Recover a reversed payment'],
  ['FEE_CORRECTION', 'Correct a charge'],
  ['OTHER', 'Another reason'],
];

const messageOf = (fallback) => (caught) => (caught?.code && caught?.message ? caught.message : fallback);

/** The last month that has ended, as YYYY-MM: the one usually settled next. */
function lastMonth(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * What InsurShield owes each insurer, month by month. A draft is worked out
 * from the payments, refunds and adjustments; a second administrator approves
 * it in Approvals, after which it never changes.
 */
export default function SettlementsPanel({ api = defaultApi, insurers = [] }) {
  const id = useId();
  const [insurerId, setInsurerId] = useState(insurers[0]?.id || '');
  const [period, setPeriod] = useState(lastMonth());
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    api.admin.settlements.list()
      .then((rows) => { if (current) setList(rows); })
      .catch((caught) => { if (current) setError(messageOf('Settlements could not be loaded. Refresh to try again.')(caught)); });
    return () => { current = false; };
  }, [api, version]);

  const act = async (work, fallback) => {
    setPending(true);
    setError('');
    try {
      const result = await work();
      setVersion((value) => value + 1);
      return result;
    } catch (caught) {
      setError(messageOf(fallback)(caught));
      return null;
    } finally {
      setPending(false);
    }
  };

  const drawUp = async (event) => {
    event.preventDefault();
    const drafted = await act(() => api.admin.settlements.draft(insurerId, period), 'The settlement could not be drawn up.');
    if (drafted) setOpen(drafted);
  };
  const show = async (row) => {
    const full = await act(() => api.admin.settlements.get(row.id), 'The settlement could not be opened.');
    if (full) setOpen(full);
  };

  return (
    <section aria-labelledby="settlements-title" className="space-y-6">
      <div>
        <h2 id="settlements-title" className="text-xl font-semibold">Settlements</h2>
        <p className="mt-1 text-sm text-muted-foreground">What InsurShield owes each insurer for a month: premium for cover that stands, less refunds and commission, plus approved adjustments. A second administrator finalises it in Approvals; after that it cannot change.</p>
      </div>

      <form onSubmit={drawUp} aria-label="Draw up a settlement" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-insurer`} className="block text-xs font-medium">Insurer</label>
          <NativeSelect id={`${id}-insurer`} value={insurerId} onChange={(event) => setInsurerId(event.target.value)}>
            {insurers.map((insurer) => <option key={insurer.id} value={insurer.id}>{insurer.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-period`} className="block text-xs font-medium">Month</label>
          <Input id={`${id}-period`} type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="w-44" />
        </div>
        <Button type="submit" disabled={!insurerId || !period || pending} aria-busy={pending}>Draw up</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {open && <SettlementDetail settlement={open} api={api} pending={pending} act={act} onChanged={(next) => setOpen(next)} />}

      <div className="space-y-2">
        <h3 className="font-medium">All settlements</h3>
        {list === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
        {list?.length === 0 && <p className="text-sm text-muted-foreground">None drawn up yet.</p>}
        <ul className="divide-y rounded-xl border">
          {list?.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span><strong>{row.insurer}</strong> · {row.period} · <span className="font-mono">{row.reference}</span></span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{formatZMW(row.netPayable)}</span>
                <Badge variant="outline">{STATUSES[row.status]}</Badge>
                <Button type="button" size="sm" variant="ghost" onClick={() => show(row)}>Open</Button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <AdjustmentForm api={api} insurers={insurers} />
    </section>
  );
}

function SettlementDetail({ settlement, api, pending, act, onChanged }) {
  const id = useId();
  const [reason, setReason] = useState('');
  const send = async () => {
    const sent = await act(() => api.admin.settlements.finalise(settlement.id, reason.trim()), 'The settlement could not be sent for approval.');
    if (sent) onChanged({ ...settlement, status: sent.status });
  };
  const download = async () => {
    const text = await act(() => api.admin.settlements.exportCsv(settlement.id), 'The export could not be downloaded.');
    if (text) downloadCsv(`${settlement.reference}-${settlement.period}.csv`, text);
  };
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle><h3>{settlement.insurer}, {settlement.period}</h3></CardTitle>
          <Badge variant="outline">{STATUSES[settlement.status]}</Badge>
        </div>
        <CardDescription className="font-mono">{settlement.reference}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Totals settlement={settlement} />
        <Lines lines={settlement.lines || []} />
        <div className="flex flex-wrap items-end gap-3">
          <Button type="button" variant="outline" onClick={download} disabled={pending}>Download CSV</Button>
        </div>
        {settlement.status === 'DRAFT' && (
          <div className="space-y-2 rounded-xl border p-3">
            <label htmlFor={`${id}-reason`} className="block text-xs font-medium">What you checked, for the approver *</label>
            <Textarea id={`${id}-reason`} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
            <Button type="button" disabled={reason.trim().length < 10 || pending} onClick={send}>Send for approval</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Totals({ settlement }) {
  const rows = [
    ['Gross premium', settlement.grossPremium],
    ['Refunds', -settlement.refunds],
    ['Adjustments', settlement.adjustments],
    [`Commission (${(settlement.commissionBps / 100).toFixed(2)}%)`, -settlement.commission],
  ];
  return (
    <dl className="max-w-md space-y-1">
      {rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="tabular-nums">{formatZMW(value)}</dd></div>)}
      <div className="flex justify-between gap-4 border-t pt-1 font-semibold"><dt>Net payable</dt><dd className="tabular-nums">{formatZMW(settlement.netPayable)}</dd></div>
      <div className="flex justify-between gap-4 text-muted-foreground"><dt>Charges collected for others</dt><dd className="tabular-nums">{formatZMW(settlement.fees)}</dd></div>
    </dl>
  );
}

export function Lines({ lines }) {
  if (lines.length === 0) return <p className="text-muted-foreground">Nothing to settle in this month.</p>;
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Settlement lines</caption>
      <thead><tr><th scope="col">Kind</th><th scope="col">Reference</th><th scope="col">Date</th><th scope="col" className="text-right">Amount</th></tr></thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.reference}-${index}`} className="border-t">
            <td>{LINE_KINDS[line.kind]}</td>
            <td className="font-mono">{line.reference}</td>
            <td>{new Date(line.occurredAt).toLocaleDateString('en-ZM')}</td>
            <td className="text-right tabular-nums">{formatZMW(line.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Money moved into or out of an insurer's next settlement; it exists only once a second administrator approves it. */
function AdjustmentForm({ api, insurers }) {
  const id = useId();
  const [insurerId, setInsurerId] = useState(insurers[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const value = Number(amount);
  const ready = insurerId && amount !== '' && value !== 0 && Number.isFinite(value) && kind && reason.trim().length >= 10;
  const submit = async (event) => {
    event.preventDefault();
    if (!ready) return;
    setError('');
    try {
      await api.admin.reconciliation.proposeAdjustment({ insurerId, amount: value, kind, reason: reason.trim() });
      setMessage('Sent for approval. It counts in the insurer’s next settlement once approved.');
      setAmount('');
      setReason('');
    } catch (caught) {
      setError(messageOf('The adjustment could not be proposed.')(caught));
    }
  };
  return (
    <form onSubmit={submit} aria-label="Propose an adjustment" className="space-y-3 rounded-xl border p-4">
      <h3 className="font-medium">Propose an adjustment</h3>
      <p className="text-sm text-muted-foreground">A positive amount pays the insurer more; a negative one takes money back in its next settlement.</p>
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-insurer`} className="block text-xs font-medium">Insurer *</label>
          <NativeSelect id={`${id}-insurer`} value={insurerId} onChange={(event) => setInsurerId(event.target.value)}>
            {insurers.map((insurer) => <option key={insurer.id} value={insurer.id}>{insurer.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-amount`} className="block text-xs font-medium">Amount (ZMW) *</label>
          <Input id={`${id}-amount`} type="number" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-kind`} className="block text-xs font-medium">Kind *</label>
          <NativeSelect id={`${id}-kind`} value={kind} onChange={(event) => setKind(event.target.value)}>
            <option value="">Choose a kind</option>
            {ADJUSTMENT_KINDS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-reason`} className="block text-xs font-medium">Why, for the approver *</label>
        <Textarea id={`${id}-reason`} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <Button type="submit" disabled={!ready}>Send for approval</Button>
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
