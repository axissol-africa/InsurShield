import { useEffect, useRef, useState } from 'react';
import { api as defaultApi } from '@/api';
import { useStore } from '@/store';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Badge } from '@/components/ui/primitives/badge';
import { Textarea } from '@/components/ui/primitives/textarea';

const ACTIONS = {
  PIA_FLOOR_CHANGE: 'Change PIA minimum rate', INSURER_ACTIVATE: 'Activate insurer',
  INSURER_DEACTIVATE: 'Deactivate insurer', INSURER_SUSPEND: 'Suspend insurer',
  INSURER_DELETE: 'Delete insurer', INSURER_RESTORE: 'Restore insurer',
};
const STATUSES = { PENDING: 'Pending review', EXECUTED: 'Approved and executed', REJECTED: 'Rejected', EXPIRED: 'Expired' };
const text = (value) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';

/** Receives the same adapter as the dashboard. onChanged refreshes affected catalogue/config data. */
export default function AdminApprovalInbox({ api = defaultApi, onChanged, onBack }) {
  const session = useStore((state) => state.staffSession);
  // Remounting drops protected records and decision drafts when identity changes.
  const identity = session?.id || session?.staffId || session?.userId || session?.email || session?.name || '';
  return <ApprovalInbox key={identity} api={api} session={session} onChanged={onChanged} onBack={onBack} />;
}

function ApprovalInbox({ api, session, onChanged, onBack }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(null);
  const busy = useRef(false);
  const active = useRef(true);
  const identity = session?.id || session?.staffId || session?.userId || session?.email;
  const role = session?.staffRole || session?.role;
  const canReview = ['SUPER_ADMIN', 'ADMIN', 'admin'].includes(role);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!canReview) return;
    api.admin.approvals.list().then((result) => {
      if (!cancelled) setRecords(result);
    }).catch(() => {
      if (!cancelled) setError('Could not load approval requests. Refresh to try again.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, revision, canReview]);

  const refresh = () => {
    setLoading(true);
    setError('');
    setRevision((value) => value + 1);
  };

  const decide = async (record, outcome, reason) => {
    if (busy.current) return;
    busy.current = true;
    setPending(record.id);
    setError('');
    setNotice('');
    try {
      const result = await api.admin.approvals[outcome](record.id, { reason: reason.trim() });
      if (!active.current) return;
      setRecords((current) => current.map((item) => item.id === record.id ? result : item));
      setNotice(outcome === 'approve' ? 'Request approved and executed.' : 'Request rejected. No change was applied.');
      try { await onChanged?.(); }
      catch { if (active.current) setError('Decision recorded, but related data could not refresh. Refresh the dashboard.'); }
    } catch {
      if (active.current) {
        setError('Decision could not be confirmed. Refresh the inbox before trying again; another reviewer may have acted or the request may have expired.');
        setRevision((value) => value + 1);
      }
    } finally {
      busy.current = false;
      if (active.current) setPending(null);
    }
  };

  if (!canReview) return <p role="alert">An administrator session is required to review approvals.</p>;

  return (
    <section aria-labelledby="approval-inbox-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="approval-inbox-title" className="text-xl font-semibold">Approval inbox</h2><p className="mt-1 text-sm text-muted-foreground">An independent administrator must review each proposal before it changes the platform.</p></div>
        <div className="flex flex-wrap gap-2">{onBack && <Button variant="outline" onClick={onBack}>Back</Button>}<Button variant="outline" onClick={refresh} disabled={loading || Boolean(pending)}>Refresh</Button></div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {loading && <p role="status">Loading approval requests…</p>}
      {!loading && !error && records.length === 0 && <p className="rounded-xl border p-6 text-sm text-muted-foreground">No approval requests are waiting for review.</p>}
      <div className="grid min-w-0 gap-4 xl:grid-cols-2" aria-busy={loading}>
        {records.map((record) => <ApprovalCard key={record.id} record={record} identity={identity} superAdmin={role === 'SUPER_ADMIN' || session?.isSuperAdmin} disabled={loading || Boolean(pending)} pending={pending === record.id} onDecision={decide} />)}
      </div>
    </section>
  );
}

function ApprovalCard({ record, identity, superAdmin, disabled, pending, onDecision }) {
  const [reason, setReason] = useState('');
  const [now, setNow] = useState(Date.now);
  const expiresAt = Date.parse(record.expiresAt);
  const expired = expiresAt <= now;
  useEffect(() => {
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(expiresAt - now, 2147483647));
    return () => clearTimeout(timer);
  }, [expiresAt, now]);
  const own = Boolean(identity && record.requestedByStaffId === identity);
  const restricted = ['INSURER_DELETE', 'INSURER_RESTORE'].includes(record.action) && !superAdmin;
  const actionable = record.status === 'PENDING' && !expired && !own && Boolean(ACTIONS[record.action]);
  const proposal = record.proposal || {};
  return (
    <Card className="min-w-0 gap-4 shadow-none">
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-2"><CardTitle>{ACTIONS[record.action] || 'Approval request'}</CardTitle><Badge variant="outline">{STATUSES[expired && record.status === 'PENDING' ? 'EXPIRED' : record.status] || 'Unknown status'}</Badge></div></CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Fact label="Target" value={record.targetId} /><Fact label="Requested by" value={record.requestedByName || record.requestedByStaffId} />
          <Fact label="Request reason" value={record.requestedReason} /><Fact label="Requested at" value={date(record.createdAt)} />
          <Fact label="Expires" value={date(record.expiresAt)} />
          {record.action === 'PIA_FLOOR_CHANGE' && Number.isFinite(proposal.piaRatePercentage) && <Fact label="Proposed minimum rate" value={`${proposal.piaRatePercentage}%`} />}
          {record.action === 'INSURER_ACTIVATE' && <><Fact label="Effective from" value={proposal.effectiveFrom} /><Fact label="Renewal date" value={proposal.renewalDate} /><Fact label="Conditions" value={proposal.conditions} /></>}
          {record.action === 'INSURER_SUSPEND' && <Fact label="Suspension reason" value={proposal.reason} />}
        </dl>
        {(record.decidedAt || record.decisionReason || record.executedAt) && <div className="border-t pt-3"><h3 className="mb-2 text-sm font-medium">Decision history</h3><dl className="grid gap-3 text-sm sm:grid-cols-2"><Fact label="Decided by" value={record.decidedByStaffId} /><Fact label="Decided at" value={date(record.decidedAt)} /><Fact label="Decision reason" value={record.decisionReason} />{record.executedAt && <Fact label="Executed at" value={date(record.executedAt)} />}</dl></div>}
        {own && record.status === 'PENDING' && <p className="text-sm text-muted-foreground">A different administrator must review your request.</p>}
        {restricted && record.status === 'PENDING' && <p className="text-sm text-muted-foreground">A super administrator must approve this action.</p>}
        {actionable && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (!restricted) onDecision(record, 'approve', reason); }}>
          <label className="block text-sm font-medium"><span className="mb-2 block">Decision reason (optional)</span><Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} disabled={disabled} placeholder="Record the context for your decision. Do not include credentials or document contents." /></label>
          <div className="flex flex-col gap-2 sm:flex-row"><Button type="submit" disabled={disabled || restricted}>{pending ? 'Recording decision…' : 'Approve'}</Button><Button type="button" variant="outline" disabled={disabled} onClick={() => onDecision(record, 'reject', reason)}>Reject</Button></div>
        </form>}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }) {
  return <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text(value) || 'Not provided'}</dd></div>;
}
