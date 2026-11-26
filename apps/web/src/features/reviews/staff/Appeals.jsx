import { useCallback, useRef, useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Textarea } from '@/components/ui/primitives/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { staffReviews } from './transport';
import { canModerate } from './permissions';
import { Pagination, ResourceState } from './shared';
import { useStaffResource } from './useStaffResource';

export function AppealForm({ decisionId, transport, onSaved }) {
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current || !reason.trim()) return;
    lock.current = true; setBusy(true); setError('');
    try { await transport.appeal({ decisionId, reason: reason.trim(), ...(evidence.trim() ? { evidence: evidence.trim() } : {}) }); setSaved(true); onSaved?.(); }
    catch (caught) { setError(caught.message || 'Could not submit your appeal.'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (saved) return <p role="status">Appeal submitted for independent review.</p>;
  return <form className="space-y-3" onSubmit={submit}><label className="block space-y-2"><span className="text-sm font-medium">Private appeal reason</span><Textarea required maxLength={2000} disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} /></label><label className="block space-y-2"><span className="text-sm font-medium">Supporting evidence (optional)</span><Textarea maxLength={10000} disabled={busy} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<Button variant="outline" disabled={busy || !reason.trim()}>{busy ? 'Submitting…' : 'Submit appeal'}</Button></form>;
}

export default function Appeals({ admin = false, transport = staffReviews }) {
  const session = useStore((state) => state.staffSession);
  if (admin ? !canModerate(session?.staffRole) : session?.staffRole !== 'INSURER_ADMIN') return <p role="alert">You do not have access to review appeals.</p>;
  return <AppealList key={`${session.id}:${session.insurerId}:${admin}`} admin={admin} transport={transport} />;
}
function AppealList({ admin, transport }) {
  const [page, setPage] = useState(1);
  const load = useCallback(() => transport.listAppeals(admin, page), [transport, admin, page]);
  const resource = useStaffResource(load);
  return (
    <section className="space-y-5">
      <h2 className="text-2xl font-semibold">Review appeals</h2>
      <p className="text-sm text-muted-foreground">Appeals are private. A different moderator reviews the appeal.</p>
      <ResourceState resource={resource}>
        {resource.data && <>
          {!resource.data.length && <p>No review appeals on this page.</p>}
          {resource.data.map((appeal) => (
            <Card key={appeal.id}>
              <CardHeader>
                <CardTitle>{appeal.outcome || 'Awaiting independent review'}</CardTitle>
                <p className="text-sm">Due {appeal.dueAt} · {appeal.party}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="whitespace-pre-wrap break-words">{appeal.reason}</p>
                {appeal.evidence && <p className="whitespace-pre-wrap break-words">Evidence: {appeal.evidence}</p>}
                {appeal.outcomeReason && <p className="whitespace-pre-wrap break-words">Decision: {appeal.outcomeReason}</p>}
                {admin && !appeal.decidedAt && <ResolveAppeal appeal={appeal} transport={transport} onSaved={resource.reload} />}
              </CardContent>
            </Card>
          ))}
          <Pagination page={page} hasMore={resource.data.length === 20} onPage={setPage} />
        </>}
      </ResourceState>
    </section>
  );
}
function ResolveAppeal({ appeal, transport, onSaved }) {
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current || !outcome || !reason.trim()) return;
    lock.current = true; setBusy(true); setError('');
    try { await transport.resolveAppeal(appeal.id, { outcome, reason: reason.trim() }); onSaved(); }
    catch (caught) { setError(caught.message || 'Could not resolve this appeal.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <form className="space-y-3" onSubmit={submit}><label className="block space-y-2"><span className="text-sm font-medium">Appeal outcome</span><NativeSelect required disabled={busy} value={outcome} onChange={(event) => setOutcome(event.target.value)}><NativeSelectOption value="">Choose an outcome</NativeSelectOption><NativeSelectOption value="UPHELD">Uphold original decision</NativeSelectOption><NativeSelectOption value="OVERTURNED">Overturn original decision</NativeSelectOption></NativeSelect></label><label className="block space-y-2"><span className="text-sm font-medium">Outcome reason</span><Textarea required maxLength={2000} disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} /></label><p className="text-sm text-muted-foreground">Overturning may change public visibility. Withdrawal and publication policy still apply.</p>{error && <p role="alert">{error}</p>}<Button disabled={busy || !outcome || !reason.trim()}>{busy ? 'Saving…' : 'Resolve appeal'}</Button></form>;
}
