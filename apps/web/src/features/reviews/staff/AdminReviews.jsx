import LegalHold from './LegalHold';
import { useCallback, useRef, useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Badge } from '@/components/ui/primitives/badge';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/primitives/alert-dialog';
import { useStaffResource } from './useStaffResource';
import { canModerate } from './permissions';
import { staffReviews } from './transport';
import { Pagination, ResourceState } from './shared';

const REASONS = { APPROVED: 'Approved', IDENTIFYING_INFORMATION: 'Identifying information', ABUSE: 'Abuse', SPAM: 'Spam', IMPERSONATION: 'Impersonation', UNDISCLOSED_INCENTIVE: 'Undisclosed incentive', REVIEW_POLICY: 'Review policy' };
const ACTIONS = { PENDING: ['PUBLISH', 'REJECT'], PUBLISHED: ['REMOVE'], REMOVED: ['REINSTATE'] };
const LABELS = { PUBLISH: 'Publish', REJECT: 'Reject', REMOVE: 'Remove', REINSTATE: 'Reinstate' };

export default function AdminReviews({ transport = staffReviews }) {
  const session = useStore((state) => state.staffSession);
  if (!canModerate(session?.staffRole)) return <p role="alert">Review moderation is restricted to administrators.</p>;
  return <ModerationQueue key={`${session.id}:${session.staffRole}`} transport={transport} />;
}

function ModerationQueue({ transport }) {
  const [filter, setFilter] = useState({ page: 1, status: 'PENDING' });
  const load = useCallback(() => transport.listAdmin(filter), [transport, filter]);
  const resource = useStaffResource(load);
  const [notice, setNotice] = useState('');
  return <section className="space-y-5">
    <div><h2 className="text-2xl font-semibold">Review moderation</h2><p className="mt-2 text-sm text-muted-foreground">Review customer reviews and insurer responses. Every decision applies to the displayed revision.</p></div>
    <label className="block space-y-2"><span className="text-sm font-medium">Moderation status</span><NativeSelect aria-label="Moderation status" value={filter.status} onChange={(event) => setFilter({ page: 1, status: event.target.value })}>{['PENDING', 'PUBLISHED', 'REMOVED'].map((status) => <NativeSelectOption key={status} value={status}>{status}</NativeSelectOption>)}</NativeSelect></label>
    {notice && <p role="status">{notice}</p>}
    <ResourceState resource={resource}>
      {resource.data && <>
        {!resource.data.publicationEnabled && <p className="rounded-lg border p-4 text-sm">Publication is paused until the review policy is confirmed. You can still reject or remove content.</p>}
        {!resource.data.items.length && <p>No reviews or responses in this view.</p>}
        {resource.data.items.map((item) => <ModerationItem key={item.id} item={item} transport={transport} publicationEnabled={resource.data.publicationEnabled} onSaved={() => { setNotice('Moderation decision saved.'); resource.reload(); }} />)}
        <Pagination page={filter.page} hasMore={resource.data.hasMore} onPage={(page) => setFilter({ ...filter, page })} />
      </>}
    </ResourceState>
  </section>;
}

function ModerationItem({ item, transport, publicationEnabled, onSaved }) {
  const [reason, setReason] = useState('');
  const [action, setAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await transport.decide(item.reviewId, { revisionId: item.id, action, reason });
      setAction(''); onSaved();
    } catch (caught) { setError(caught.message || 'Could not save the decision. Refresh the queue if another moderator has acted.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Card className="shadow-none">
    <CardHeader><CardTitle>{item.insurerName}</CardTitle><div className="flex flex-wrap gap-2"><Badge variant="outline">{item.kind === 'RESPONSE' ? 'Insurer response' : 'Customer review'}</Badge><Badge variant="secondary">{item.status}</Badge></div></CardHeader>
    <CardContent className="space-y-4">
      {item.kind === 'REVIEW' && <p className="text-sm">{item.rating} out of 5 stars</p>}
      <p className="whitespace-pre-wrap break-words">{item.text || 'No written review.'}</p>
      <p className="text-sm text-muted-foreground">Submitted {new Date(item.createdAt).toLocaleDateString('en-ZM')}</p>
      <label className="block space-y-2"><span className="text-sm font-medium">Decision reason</span><NativeSelect aria-label={`Decision reason for ${item.id}`} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)}><NativeSelectOption value="">Choose a reason</NativeSelectOption>{Object.entries(REASONS).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></label>
      <div className="flex flex-wrap gap-2">{(ACTIONS[item.status] || []).map((value) => <Button key={value} variant={value === 'REJECT' || value === 'REMOVE' ? 'outline' : 'default'} disabled={busy || !reason || (!publicationEnabled && ['PUBLISH', 'REINSTATE'].includes(value)) || (['REJECT', 'REMOVE'].includes(value) && reason === 'APPROVED')} onClick={() => setAction(value)}>{LABELS[value]}</Button>)}</div>
      <LegalHold reviewId={item.reviewId} transport={transport} />
      <AlertDialog open={Boolean(action)} onOpenChange={(open) => { if (!open && !busy) setAction(''); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{LABELS[action]} this {item.kind === 'RESPONSE' ? 'response' : 'review'}?</AlertDialogTitle><AlertDialogDescription>{['PUBLISH', 'REINSTATE'].includes(action) ? 'This content will be visible publicly.' : 'This content will not be visible publicly. Removing a review also hides its insurer response.'} Recorded reason: {REASONS[reason]}.</AlertDialogDescription></AlertDialogHeader>{error && <p role="alert">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void save(); }}>{busy ? 'Saving…' : 'Confirm decision'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </CardContent>
  </Card>;
}
