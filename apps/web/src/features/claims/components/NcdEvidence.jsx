import { useRef, useState } from 'react';
import { api } from '@/api';
import { newIdempotencyKey } from '@/api/shared';
import { env } from '@/config/env';
import { openDocument } from '@/lib/files';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';

export function NcdEvidenceLinks({ evidence = [] }) {
  return evidence.length > 0 && <ul aria-label="Verification evidence" className="space-y-2 text-sm">
    {evidence.map((document) => <li key={document.id}>
      {document.url && /^(https?:\/\/|\/(?![\\/]))[^\s\\]*$/.test(document.url)
        ? <a href={document.url} target="_blank" rel="noopener noreferrer" className="break-all underline">{document.name || document.fileName || 'Evidence document'}</a>
        : env.apiMode === 'mock' && /^data:(application\/pdf|image\/(png|jpeg));base64,/.test(document.dataUrl || '')
          ? <Button variant="link" onClick={() => openDocument(document)}>{document.name || 'Evidence document'}</Button>
          : <span>{document.name || document.fileName || 'Evidence document'} — link unavailable</span>}
    </li>)}
  </ul>;
}

export default function NcdEvidence({ application, onUpdated, onRefresh }) {
  const [files, setFiles] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const commandKey = useRef(null);
  const uploaded = useRef(new Map());
  const submit = async () => {
    if (busy.current || !files.length) return;
    busy.current = true; setPending(true); setError('');
    try {
      for (const file of files) {
        if (!uploaded.current.has(file)) uploaded.current.set(file, (await api.documents.upload(file, 'NCD_EVIDENCE')).id);
      }
      commandKey.current ??= newIdempotencyKey();
      const updated = await api.ncd.submitEvidence(application.id, {
        verificationRevision: application.verificationRevision ?? 0,
        documentIds: files.map((file) => uploaded.current.get(file)),
      }, commandKey.current);
      commandKey.current = null;
      await onUpdated(updated);
      setFiles([]); uploaded.current.clear();
    } catch (failure) { if (failure.code === 'IDEMPOTENCY_KEY_REUSED') commandKey.current = null; setError(failure.message || 'Evidence could not be submitted. Please try again.'); }
    finally { busy.current = false; setPending(false); }
  };
  return <div className="my-5 space-y-3 rounded-xl border border-border p-4">
    {application.decisionNote && <p className="whitespace-pre-wrap break-words text-sm"><strong>Insurer reason: </strong>{application.decisionNote}</p>}
    <NcdEvidenceLinks evidence={application.evidence} />
    {application.status === 'Verification Required' && <>
      <p className="text-sm">Upload the evidence requested by your insurer to return this application for review.</p>
      <label className="block text-sm">Verification evidence files<Input type="file" multiple accept="application/pdf,image/jpeg,image/png" disabled={pending} onChange={(event) => { commandKey.current = null; setFiles(Array.from(event.target.files || [])); }} /></label>
      <Button disabled={pending || !files.length} onClick={submit}>{pending ? 'Submitting…' : 'Submit verification evidence'}</Button>
    </>}
    {error && <div role="alert" className="space-y-2 text-sm text-primary"><p>{error}</p><Button variant="outline" disabled={pending} onClick={onRefresh}>Refresh application</Button></div>}
  </div>;
}
