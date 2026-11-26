import { api } from '@/api';
import { useCallback, useRef, useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/primitives/button';
import { Textarea } from '@/components/ui/primitives/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Badge } from '@/components/ui/primitives/badge';
import { canModerate } from '@/features/reviews/staff/permissions';
import { useStaffResource } from '@/features/reviews/staff/useStaffResource';

const formatDate = (value) => new Date(value).toLocaleString('en-ZM', { dateStyle: 'medium', timeStyle: 'short' });

export default function BadgeGovernance({ insurers = [], transport = api.badgeGovernance }) {
  const session = useStore((state) => state.staffSession);
  if (!canModerate(session?.staffRole)) return <p role="alert">You do not have permission to manage performance badges.</p>;
  return <BadgeWorkspace key={`${session.id}:${session.staffRole}`} insurers={insurers} transport={transport} />;
}

function BadgeWorkspace({ insurers, transport }) {
  const [insurerId, setInsurerId] = useState('');
  const selected = insurers.find((insurer) => insurer.id === insurerId);
  return <section className="max-w-2xl space-y-5">
    <div><h2 className="text-2xl font-semibold tracking-tight">Badge governance</h2><p className="mt-2 text-sm text-muted-foreground">Review performance evaluations and suspend or resume an insurer’s badge eligibility.</p></div>
    {!insurers.length ? <p className="text-sm text-muted-foreground">No insurers are available to manage.</p> : <label className="block space-y-2"><span className="text-sm font-medium">Insurer</span><NativeSelect className="w-full" value={selected ? insurerId : ''} onChange={(event) => setInsurerId(event.target.value)}><NativeSelectOption value="">Choose an insurer</NativeSelectOption>{insurers.map((insurer) => <NativeSelectOption key={insurer.id} value={insurer.id}>{insurer.name}</NativeSelectOption>)}</NativeSelect></label>}
    {selected ? <BadgeResource key={insurerId} insurerId={insurerId} transport={transport} /> : insurers.length > 0 && <p className="text-sm text-muted-foreground">Choose an insurer to view its last evaluation and governance status.</p>}
  </section>;
}

function BadgeResource({ insurerId, transport }) {
  const load = useCallback(() => transport.get(insurerId), [insurerId, transport]);
  const resource = useStaffResource(load);
  if (resource.loading) return <p role="status">Loading badge governance…</p>;
  if (resource.error) return <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{resource.error}</p><Button variant="outline" onClick={resource.reload}>Retry</Button></div>;
  if (!resource.data) return <p>No badge governance record is available.</p>;
  return <BadgeRecord key={resource.data.generation} initial={resource.data} insurerId={insurerId} transport={transport} onRefresh={resource.reload} />;
}

function BadgeRecord({ initial, insurerId, transport, onRefresh }) {
  const [record, setRecord] = useState(initial);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const lock = useRef(false);
  const suspended = Boolean(record.suspendedAt);
  const latest = record.latest;
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current || needsRefresh || !reason.trim()) return;
    lock.current = true;
    setPending(true); setError(''); setNotice('');
    try {
      const updated = await transport.update(insurerId, { suspended: !suspended, reason: reason.trim(), expectedGeneration: record.generation });
      setRecord(updated); setReason('');
      setNotice(updated.suspendedAt ? 'Badge eligibility suspended.' : 'Badge eligibility resumed. A new qualifying calculation is required before the badge can appear again.');
    } catch (caught) {
      setNeedsRefresh(caught.code === 'BADGE_STATE_CHANGED');
      setError(caught.message || 'The badge decision could not be saved. Try again.');
    } finally { lock.current = false; setPending(false); }
  };
  return <Card className="gap-0 border-border shadow-none">
    <CardHeader className="border-b"><CardTitle>Performance badge</CardTitle><Badge variant="outline" className="w-fit border-primary/20 bg-primary/10 text-primary">{suspended ? 'Eligibility suspended' : 'Eligibility not suspended'}</Badge></CardHeader>
    <CardContent className="space-y-6 pt-6">
      <dl className="space-y-3 text-sm">
        {record.suspendedAt && <div><dt className="font-medium">Suspended at</dt><dd className="text-muted-foreground">{formatDate(record.suspendedAt)}</dd></div>}
        <div><dt className="font-medium">Suspension reason</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{record.suspensionReason || 'No suspension reason recorded.'}</dd></div>
      </dl>
      <div><h3 className="font-semibold">Last evaluation</h3>{latest ? <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
        {[
          ['Result', latest.qualifies ? 'Qualified at last calculation' : 'Did not qualify'],
          ['Calculated at', formatDate(latest.calculatedAt)],
          ['Expires at', formatDate(latest.expiresAt)],
          ['Sample count', latest.sampleCount], ['On-time count', latest.onTimeCount], ['Rule version', latest.ruleVersion],
        ].map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="break-words text-muted-foreground">{value}</dd></div>)}
      </dl> : <p className="mt-2 text-sm text-muted-foreground">No performance evaluation has been calculated yet.</p>}</div>
      <form onSubmit={submit} className="space-y-4 border-t border-border pt-5">
        <div><h3 className="font-semibold">{suspended ? 'Resume badge eligibility' : 'Suspend badge eligibility'}</h3><p id="badge-consequence" className="mt-2 text-sm text-muted-foreground">{suspended ? 'Resuming does not restore the badge immediately. A new qualifying calculation is required before it can appear again.' : 'Suspending hides the performance badge until eligibility is resumed and a new calculation qualifies.'}</p></div>
        <label className="block space-y-2"><span className="text-sm font-medium">Decision reason</span><Textarea required value={reason} disabled={pending} aria-describedby="badge-consequence" onChange={(event) => setReason(event.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
        {needsRefresh && <Button type="button" variant="outline" onClick={onRefresh}>Refresh badge status</Button>}
        <Button type="submit" disabled={pending || needsRefresh || !reason.trim()}>{pending ? 'Saving decision…' : suspended ? 'Confirm resume' : 'Confirm suspension'}</Button>
      </form>
    </CardContent>
  </Card>;
}
