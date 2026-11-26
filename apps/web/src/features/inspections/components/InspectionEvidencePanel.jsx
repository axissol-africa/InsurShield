import { useEffect, useRef, useState } from 'react';
import { api as defaultApi } from '@/api';
import { getIdentityBinding } from '@/app/identity';
import { useStore } from '@/store';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { INSPECTION_PHOTO_SLOTS, inspectionClosed, inspectionStatus } from '@/domain/inspectionWorkflow';
import InspectionDocuments from './InspectionDocuments';

const identity = () => getIdentityBinding() || JSON.stringify([useStore.getState().customer?.email, useStore.getState().staffSession]);

export default function InspectionEvidencePanel({ inspection, staff = false, api = defaultApi, onChanged }) {
  const [evidence, setEvidence] = useState(null);
  const [version, setVersion] = useState(0);
  const [files, setFiles] = useState({});
  const [reportFile, setReportFile] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const mounted = useRef(false);
  const busy = useRef(false);
  const uploaded = useRef(new Map());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!staff) return;
    let current = true;
    const owner = identity();
    Promise.resolve().then(() => api.inspections.evidence(inspection.id))
      .then((result) => { if (current && owner === identity() && !useStore.getState().leaving) { setEvidence(result); setError(''); } })
      .catch(() => { if (current && owner === identity()) setError('Evidence could not be loaded. Refresh before recording an outcome.'); });
    return () => { current = false; };
  }, [api, inspection.id, staff, version]);

  const report = staff ? evidence?.report : inspection.report;
  const photos = staff ? evidence?.postLoss : (Array.isArray(inspection.photos) ? inspection.photos : []);
  const editable = !inspectionClosed(inspection) && inspectionStatus(inspection) !== 'REPORT_READY' && !report && (!staff || evidence !== null);
  const canPublish = inspection.method === 'SELF_CAPTURE'
    ? INSPECTION_PHOTO_SLOTS.every(([slot]) => photos?.some((photo) => photo.slot === slot))
    : ['SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(inspectionStatus(inspection));
  const documentKind = inspection.purpose === 'CLAIM_ASSESSMENT' ? 'CLAIM_ATTACHMENT' : 'INSPECTION_PHOTO';
  const execute = async (reporting) => {
    if (busy.current || !editable || (reporting && !canPublish)) return;
    const owner = identity();
    const current = () => mounted.current && owner === identity() && !useStore.getState().leaving;
    busy.current = true; setPending(true); setError(''); setSaved('');
    try {
      const upload = async (file, kind) => {
        if (!uploaded.current.has(file)) {
          const document = await api.documents.upload(file, kind);
          if (!current()) throw new Error('Your session changed.');
          uploaded.current.set(file, document.id);
        }
        return uploaded.current.get(file);
      };
      if (reporting) {
        const documentId = await upload(reportFile, inspection.purpose === 'CLAIM_ASSESSMENT' ? 'CLAIM_ATTACHMENT' : 'INSPECTION_REPORT');
        if (!current()) return;
        await api.inspections.attachReport(inspection.id, documentId);
      } else {
        const submittedPhotos = [];
        for (const [slot, file] of Object.entries(files)) submittedPhotos.push({ slot, documentId: await upload(file, documentKind) });
        if (!current()) return;
        await (staff ? api.inspections.submitInsurerEvidence : api.inspections.submitEvidence)(inspection.id, { photos: submittedPhotos });
      }
      if (!current()) return;
      setFiles({}); setReportFile(null); uploaded.current.clear();
      setSaved(reporting ? 'Report published. It cannot be replaced.' : 'Evidence submitted to the insurer.');
      setVersion((value) => value + 1);
      await onChanged?.();
    } catch (failure) {
      if (current()) setError(failure.message || 'This evidence could not be saved. Please try again.');
    } finally {
      busy.current = false;
      if (current()) setPending(false);
    }
  };

  return <section aria-label="Inspection evidence and report" className="space-y-4 rounded-xl border border-border p-4">
    <h3 className="font-semibold">Inspection evidence and report</h3>
    {staff && !evidence && !error && <p role="status">Loading evidence…</p>}
    {error && <div role="alert" className="space-y-2"><p>{error}</p>{staff && <Button variant="outline" disabled={pending} onClick={() => setVersion((value) => value + 1)}>Refresh evidence</Button>}</div>}
    {saved && <p role="status">{saved}</p>}
    {staff && evidence && <InspectionDocuments label="Pre-loss evidence" items={evidence.preLoss || []} />}
    {(!staff || evidence) && <InspectionDocuments label={inspection.purpose === 'CLAIM_ASSESSMENT' ? 'Post-loss evidence' : 'Inspection photos'} items={photos || []} />}
    {report && <InspectionDocuments label="Published report" items={[{ document: report }]} />}
    {editable && <>
      <p className="text-sm text-muted-foreground">Select the requested photos, then submit them. Selected files are not saved until submission. Each saved view is permanent. A new inspection is needed to record a replacement.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{INSPECTION_PHOTO_SLOTS.map(([slot, label]) => <label key={`${slot}-${version}`} className="min-w-0 space-y-1 text-sm">
        <span>{label}{photos?.some((photo) => photo.slot === slot) ? ' — saved' : ''}</span><Input type="file" accept="image/jpeg,image/png" capture="environment" disabled={pending || photos?.some((photo) => photo.slot === slot)} onChange={(event) => {
          const file = event.target.files?.[0];
          setFiles((previous) => { const next = { ...previous }; if (file) next[slot] = file; else delete next[slot]; return next; });
          setSaved('');
        }} />
      </label>)}</div>
      <Button disabled={pending || !Object.keys(files).length} onClick={() => execute(false)}>{pending ? 'Saving…' : 'Submit inspection photos'}</Button>
      {staff && <div className="space-y-3 border-t pt-4">
        <p className="text-sm">Attach the final assessment report after reviewing the evidence. Publishing makes it immutable and ready for an outcome.</p>
        <label className="block text-sm">Final inspection report<Input key={version} type="file" accept="application/pdf,image/jpeg,image/png" disabled={pending} onChange={(event) => setReportFile(event.target.files?.[0] || null)} /></label>
        <p className="text-sm text-muted-foreground">{!canPublish && (inspection.method === 'SELF_CAPTURE' ? 'All six saved photo slots are required before publishing the report.' : 'Schedule the physical inspection before publishing the report.')}</p>
        <Button variant="outline" disabled={pending || !reportFile || !canPublish} onClick={() => execute(true)}>Publish final report</Button>
      </div>}
    </>}
    {!editable && !report && <p className="text-sm text-muted-foreground">Evidence for this attempt is read-only.</p>}
  </section>;
}
