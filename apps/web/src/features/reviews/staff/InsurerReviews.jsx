import { AppealForm } from './Appeals';
import { useCallback, useRef, useState } from 'react';
import { useStore } from '@/store';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Textarea } from '@/components/ui/primitives/textarea';
import { useStaffResource } from './useStaffResource';
import { staffReviews } from './transport';
import { Pagination, ResourceState } from './shared';

export default function InsurerReviews({ transport = staffReviews }) {
  const session = useStore((state) => state.staffSession);
  if (session?.staffRole !== 'INSURER_ADMIN') return <p role="alert">Review replies are restricted to insurer administrators.</p>;
  return <ReviewList key={`${session.id}:${session.insurerId}`} transport={transport} />;
}
function ReviewList({ transport }) {
  const [page, setPage] = useState(1);
  const load = useCallback(() => transport.listInsurer({ page }), [transport, page]);
  const resource = useStaffResource(load);
  const [notice, setNotice] = useState('');
  return <section className="space-y-5"><div><h2 className="text-2xl font-semibold">Customer reviews</h2><p className="mt-2 text-sm text-muted-foreground">Reply to published reviews. Replies and edits require moderation; your approved response stays visible while an edit is reviewed.</p></div>
    {notice && <p role="status">{notice}</p>}
    <ResourceState resource={resource}>{resource.data && <>
      {!resource.data.items.length && <p>No published customer reviews yet.</p>}
      {resource.data.items.map((item) => <ReplyCard key={`${item.id}:${item.latestResponse?.id || ''}`} item={item} transport={transport} onSaved={() => { setNotice('Response submitted for moderation.'); resource.reload(); }} />)}
      <Pagination page={page} hasMore={resource.data.hasMore} onPage={setPage} />
    </>}</ResourceState>
  </section>;
}
function ReplyCard({ item, transport, onSaved }) {
  const [text, setText] = useState(item.latestResponse?.text ?? item.response?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const pending = item.latestResponse?.status === 'PENDING';
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current || !text.trim() || pending) return;
    lock.current = true; setBusy(true); setError('');
    try { await transport.respond(item.id, text.trim()); onSaved(); }
    catch (caught) { setError(caught.message || 'Could not submit your response. Your draft has been kept.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Card className="shadow-none"><CardHeader><CardTitle>{item.rating} out of 5 stars</CardTitle><p className="text-sm text-muted-foreground">Published {new Date(item.publishedAt).toLocaleDateString('en-ZM')}</p></CardHeader><CardContent className="space-y-4">
    <p className="whitespace-pre-wrap break-words">{item.text || 'No written review.'}</p>
    {item.response && <div className="rounded-lg border p-4"><h3 className="text-sm font-semibold">Published response</h3><p className="mt-2 whitespace-pre-wrap break-words">{item.response.text}</p></div>}
    {item.latestResponse && <div className="text-sm"><p>Latest response: {item.latestResponse.status}</p>{item.latestResponse.reason && <p>Moderation reason: {item.latestResponse.reason.replaceAll('_', ' ')}</p>}</div>}
    <form onSubmit={submit} className="space-y-3"><label className="block space-y-2"><span className="text-sm font-medium">Your response</span><Textarea value={text} disabled={busy || pending} required onChange={(event) => setText(event.target.value)} /></label><p className="text-sm text-muted-foreground">Do not include customer names, policy numbers or other personal information.</p>{error && <p role="alert">{error}</p>}<Button disabled={busy || pending || !text.trim()} type="submit">{busy ? 'Submitting…' : pending ? 'Awaiting moderation' : 'Submit response'}</Button></form>
    {item.publicationDecisionId && <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Appeal review publication</summary><div className="pt-4"><AppealForm decisionId={item.publicationDecisionId} transport={transport} /></div></details>}
    {item.latestResponse?.decisionId && <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Appeal response decision</summary><div className="pt-4"><AppealForm decisionId={item.latestResponse.decisionId} transport={transport} /></div></details>}
  </CardContent></Card>;
}
