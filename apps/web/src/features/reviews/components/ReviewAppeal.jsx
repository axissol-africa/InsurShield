import { useId, useState } from 'react';
import { useReviewAppeals } from '../hooks/useReviewAppeals';
import { reviewLabel } from '../presentation';
import { Button } from '@/components/ui/primitives/button';
import { Textarea } from '@/components/ui/primitives/textarea';

export default function ReviewAppeal({ reviewId, decisionId }) {
  const id = useId();
  const { appeals, error, busy, submit: save, reload } = useReviewAppeals(reviewId, decisionId);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const appeal = appeals?.find((entry) => entry.decisionId === decisionId && entry.party === 'CUSTOMER');
  const submit = async (event) => {
    event.preventDefault();
    if (!reason.trim()) return;
    await save({ reason: reason.trim(), ...(evidence.trim() ? { evidence: evidence.trim() } : {}) });
  };
  return <div className="space-y-3 rounded-lg border p-4">
    <h4 className="font-medium">Review appeals</h4>
    {error && <p role="alert">{error}</p>}
    {!appeals && (error ? <Button variant="outline" onClick={reload}>Retry appeal status</Button> : <p role="status">Loading appeal status…</p>)}
    {appeals?.filter((entry) => entry.party === 'CUSTOMER').map((appeal) => <div key={appeal.id} role="status" className="space-y-2 text-sm"><p>Appeal: {reviewLabel(appeal.outcome) || 'Awaiting decision'}</p><p>Decision due: {appeal.dueAt}</p>{appeal.outcomeReason && <p>{reviewLabel(appeal.outcomeReason)}</p>}</div>)}
    {appeals?.length === 0 && !decisionId && <p className="text-sm">No appeals submitted.</p>}
    {decisionId && !appeal && appeals && <form className="space-y-3" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">Your reason and evidence are private. Submitting an appeal does not change publication status. The service checks whether this decision is still eligible for appeal.</p>
      <label htmlFor={`${id}-reason`} className="block text-sm font-medium">Appeal reason (required)</label><Textarea id={`${id}-reason`} required maxLength={2000} disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} />
      <label htmlFor={`${id}-evidence`} className="block text-sm font-medium">Supporting evidence (optional)</label><Textarea id={`${id}-evidence`} maxLength={10000} disabled={busy} value={evidence} onChange={(event) => setEvidence(event.target.value)} />
      <Button disabled={busy || !reason.trim()} type="submit">{busy ? 'Submitting appeal…' : 'Submit appeal'}</Button>
    </form>}
  </div>;
}
