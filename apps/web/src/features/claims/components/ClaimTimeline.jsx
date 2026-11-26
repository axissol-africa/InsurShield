import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { newIdempotencyKey } from '@/api/shared';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { Textarea } from '@/components/ui/primitives/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';

const actions = {
  'Received by insurer': [['START_REVIEW', 'Start review']],
  'Under review': [['REQUEST_EVIDENCE', 'Request evidence'], ['APPROVE', 'Approve'], ['DECLINE', 'Decline']],
  Approved: [['CLOSE', 'Close claim']],
  Declined: [['CLOSE', 'Close claim']],
};

export default function ClaimTimeline({ claimNumber, insurer = false, revision, onUpdated }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState('');
  const [request, setRequest] = useState('');
  const [files, setFiles] = useState([]);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const command = useRef(null);
  const displayedRevision = useRef(null);
  const [revisionChanged, setRevisionChanged] = useState(false);
  const acceptDetail = useCallback((data) => {
    if (displayedRevision.current !== data.revision) {
      command.current = null;
      setFiles([]);
    }
    displayedRevision.current = data.revision;
    setDetail(data);
    setRevisionChanged(false);
  }, []);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => insurer ? api.claims.insurerTimeline(claimNumber) : api.claims.timeline(claimNumber))
      .then((data) => { if (active) { acceptDetail(data); setError(''); } })
      .catch((failure) => { if (active) setError(failure.message || 'Could not load claim updates.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [claimNumber, insurer, revision, retry, acceptDetail]);

  const submit = async (action) => {
    if (busy.current || loading || revisionChanged || !detail?.revision) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const payload = insurer
        ? { expectedRevision: detail.revision, action, message: message.trim(), ...(action === 'REQUEST_EVIDENCE' ? { evidenceRequest: request.trim() } : {}) }
        : { expectedRevision: detail.revision };
      const fingerprint = JSON.stringify({ claimNumber, insurer, ...payload });
      if (!command.current || command.current.fingerprint !== fingerprint) {
        command.current = { fingerprint, key: newIdempotencyKey(), uploaded: new Map() };
      }
      const current = command.current;
      let next;
      if (insurer) {
        next = await api.claims.update(claimNumber, payload, current.key);
      } else {
        // Keep each successful upload even if a later upload or the POST fails.
        for (const file of files) {
          if (!current.uploaded.has(file)) {
            const document = await api.documents.upload(file, 'CLAIM_ATTACHMENT');
            current.uploaded.set(file, document.id);
          }
        }
        next = await api.claims.submitEvidence(claimNumber, { ...payload, documentIds: files.map((file) => current.uploaded.get(file)) }, current.key);
      }
      command.current = null;
      acceptDetail(next);
      setMessage(''); setRequest(''); setFiles([]);
      await onUpdated?.();
    } catch (failure) {
      if (failure.code === 'CLAIM_REVISION_CHANGED') {
        setRevisionChanged(true);
        command.current = null;
        setError('This claim has changed. Refresh updates and review the latest request before submitting again. Your message has been kept; evidence must be selected again for a new request.');
      } else {
        if (failure.code === 'IDEMPOTENCY_KEY_REUSED') command.current = null;
        setError(failure.message || 'Could not save this update. Please try again.');
      }
    } finally { busy.current = false; setPending(false); }
  };

  return <Card className="my-5 min-w-0">
    <CardHeader><CardTitle>Claim status and updates</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {loading && <p role="status">Loading claim updates…</p>}
      {error && <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} disabled={pending}>Refresh updates</Button></div>}
      {detail && <>
        <div className="space-y-1 text-sm"><div>Claim reference: {detail.claimNumber}</div><div>Current status: <strong>{detail.status}</strong></div>
          {detail.insurerClaimReference && <div>Insurer reference: {detail.insurerClaimReference}</div>}
          {detail.responseDueOn && <div>Response due: {detail.responseDueOn}</div>}
          {detail.lateSubmission && <div>Late notification — insurer review required</div>}
        </div>
        <ol aria-label="Claim updates" className="space-y-3">
          {detail.updates.map((update) => <li key={update.id} className="border-l-2 border-primary/30 pl-3 text-sm">
            <p className="font-medium">{update.status} · {update.actorKind}</p>
            <time dateTime={update.createdAt}>{new Date(update.createdAt).toLocaleString()}</time>
            <p className="whitespace-pre-wrap break-words">{update.message}</p>
            {update.evidenceRequest && <p className="whitespace-pre-wrap">Requested evidence: {update.evidenceRequest}</p>}
            {update.documents?.length > 0 && <ul>{update.documents.map((document) => <li key={document.id}>{document.url && /^(https?:\/\/|\/(?!\/))/.test(document.url) ? <a className="underline" href={document.url} target="_blank" rel="noreferrer">{document.name || document.fileName || 'Evidence document'}</a> : (document.name || document.fileName || 'Evidence document')}</li>)}</ul>}
          </li>)}
        </ol>
        {!detail.updates.length && <p>No updates yet.</p>}
        {insurer && actions[detail.status] && <div className="space-y-3">
          <label className="block">Message to customer<Textarea value={message} onChange={(event) => { command.current = null; setMessage(event.target.value); }} disabled={pending} /></label>
          {detail.status === 'Under review' && <label className="block">Evidence needed<Textarea value={request} onChange={(event) => { command.current = null; setRequest(event.target.value); }} disabled={pending} /></label>}
          <div className="flex flex-wrap gap-2">{actions[detail.status].map(([action, label]) => <Button key={action} disabled={pending || loading || revisionChanged || !detail.revision || !message.trim() || (action === 'REQUEST_EVIDENCE' && !request.trim())} onClick={() => submit(action)}>{label}</Button>)}</div>
        </div>}
        {!insurer && detail.status === 'Additional information required' && <div className="space-y-3">
          <p>Upload the evidence requested by your insurer to return this claim for review.</p>
          <label className="block">Requested evidence files<Input key={detail.revision} type="file" multiple disabled={pending} onChange={(event) => { command.current = null; setFiles(Array.from(event.target.files || [])); }} /></label>
          <Button disabled={pending || loading || revisionChanged || !detail.revision || files.length === 0} onClick={() => submit()}> {pending ? 'Submitting…' : 'Submit evidence'}</Button>
        </div>}
      </>}
    </CardContent>
  </Card>;
}
