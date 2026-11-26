import { useCallback, useRef, useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { Textarea } from '@/components/ui/primitives/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { staffReviews } from './transport';
import { canModerate } from './permissions';
import { ResourceState } from './shared';
import { useStaffResource } from './useStaffResource';
import { usePortalAction } from '@/features/insurer-portal/hooks/usePortalAction';

const FIELDS = [
  ['brandName', 'Brand name', 160, true], ['description', 'Description', 4000, true],
  ['serviceInformation', 'Service information', 4000, true], ['contactEmail', 'Contact email', 254, false, 'email'],
  ['contactPhone', 'Contact phone', 40], ['websiteUrl', 'Website URL', 2048, false, 'url'], ['logoUrl', 'Logo URL', 2048, false, 'url'],
];
export default function StaffProfiles({ admin = false, insurers = [], transport = staffReviews }) {
  const session = useStore((state) => state.staffSession);
  if (admin ? !canModerate(session?.staffRole) : session?.staffRole !== 'INSURER_ADMIN') return <p role="alert">You do not have access to profile administration.</p>;
  return <ProfileWorkspace key={`${session.id}:${session.insurerId}:${admin}`} admin={admin} insurers={insurers} transport={transport} />;
}
function ProfileWorkspace({ admin, insurers, transport }) {
  const [insurerId, setInsurerId] = useState('');
  return <section className="space-y-5"><h2 className="text-2xl font-semibold">Insurer profile</h2><p className="text-sm text-muted-foreground">Profile changes require approval. The approved profile stays public while a replacement is reviewed. Licence and product details come from the insurer’s existing records.</p>
    {admin && <label className="block space-y-2"><span className="text-sm font-medium">Insurer</span><NativeSelect value={insurerId} onChange={(event) => setInsurerId(event.target.value)}><NativeSelectOption value="">Choose an insurer</NativeSelectOption>{insurers.map((insurer) => <NativeSelectOption key={insurer.id} value={insurer.id}>{insurer.name}</NativeSelectOption>)}</NativeSelect></label>}
    {(!admin || insurerId) && <ProfileHistory key={insurerId} admin={admin} insurerId={insurerId} transport={transport} />}
  </section>;
}
function ProfileHistory({ admin, insurerId, transport }) {
  const load = useCallback(() => admin ? transport.adminProfiles(insurerId) : transport.ownProfiles(), [admin, insurerId, transport]);
  const resource = useStaffResource(load);
  const [notice, setNotice] = useState('');
  const saved = () => { setNotice(admin ? 'Profile decision saved.' : 'Profile submitted for approval.'); resource.reload(); };
  return <>{notice && <p role="status">{notice}</p>}<ResourceState resource={resource}>{resource.data && <div className="space-y-4">
    {!admin && (resource.data.some((revision) => revision.status === 'PENDING') ? <p>A profile revision is awaiting approval. You can submit another after it is decided.</p> : <ProfileForm key={resource.data[0]?.id || 'new'} profile={resource.data[0]?.profile} transport={transport} onSaved={saved} />)}
    {!resource.data.length && <p>No profile revisions yet.</p>}
    {resource.data.map((revision) => <Card key={revision.id}><CardHeader><CardTitle>{revision.profile.brandName}</CardTitle><p className="text-sm">Version {revision.versionNumber} · {revision.status}</p></CardHeader><CardContent className="space-y-4"><dl className="space-y-3">{FIELDS.map(([key, label]) => revision.profile[key] && <div key={key}><dt className="text-sm font-medium">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{revision.profile[key]}</dd></div>)}</dl>{revision.decision?.reason && <p>Decision reason: {revision.decision.reason}</p>}{admin && revision.status === 'PENDING' && <ProfileDecision revision={revision} insurerId={insurerId} transport={transport} onSaved={saved} />}</CardContent></Card>)}
    {resource.data.length === 20 && <p className="text-sm text-muted-foreground">Showing the 20 most recent profile revisions.</p>}
  </div>}</ResourceState></>;
}
function ProfileForm({ profile, transport, onSaved }) {
  const [draft, setDraft] = useState(Object.fromEntries(FIELDS.map(([key]) => [key, profile?.[key] || ''])));
  const mutation = usePortalAction((payload) => transport.submitProfile(payload), (error) => error.message || 'Could not submit the profile.');
  const lock = useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    try { if (await mutation.run(Object.fromEntries(FIELDS.map(([key, , , required]) => [key, draft[key].trim() || (required ? '' : null)])))) onSaved(); }
    finally { lock.current = false; }
  };
  return <form className="space-y-4 rounded-xl border p-5" onSubmit={submit}>{FIELDS.map(([key, label, maxLength, required, type = 'text']) => {
    const Control = key === 'description' || key === 'serviceInformation' ? Textarea : Input;
    return <label key={key} className="block space-y-2"><span className="text-sm font-medium">{label}{required ? ' (required)' : ' (optional)'}</span><Control type={type} required={required} maxLength={maxLength} pattern={type === 'url' ? 'https://.*' : undefined} value={draft[key]} disabled={mutation.pending} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>;
  })}<p className="text-sm text-muted-foreground">Website and logo URLs must use HTTPS.</p>{mutation.error && <p role="alert">{mutation.error}</p>}<Button disabled={mutation.pending || FIELDS.some(([key, , , required]) => required && !draft[key].trim())}>{mutation.pending ? 'Submitting…' : 'Submit profile for approval'}</Button></form>;
}
function ProfileDecision({ revision, insurerId, transport, onSaved }) {
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState('');
  const mutation = usePortalAction((payload) => transport.decideProfile(insurerId, revision.id, payload), (error) => error.message || 'Could not save the profile decision.');
  const lock = useRef(false);
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current || !reason.trim() || !decision) return;
    lock.current = true;
    try { if (await mutation.run({ decision, reason: reason.trim() })) onSaved(); }
    finally { lock.current = false; }
  };
  return <form className="space-y-3 border-t pt-4" onSubmit={submit}><label className="block space-y-2"><span className="text-sm font-medium">Profile decision</span><NativeSelect value={decision} disabled={mutation.pending} required onChange={(event) => setDecision(event.target.value)}><NativeSelectOption value="">Choose a decision</NativeSelectOption><NativeSelectOption value="APPROVE">Approve and publish profile</NativeSelectOption><NativeSelectOption value="REJECT">Reject profile changes</NativeSelectOption></NativeSelect></label><label className="block space-y-2"><span className="text-sm font-medium">Profile decision reason</span><Textarea value={reason} required maxLength={2000} disabled={mutation.pending} onChange={(event) => setReason(event.target.value)} /></label>{mutation.error && <p role="alert">{mutation.error}</p>}<Button disabled={mutation.pending || !reason.trim() || !decision}>Confirm profile decision</Button></form>;
}
