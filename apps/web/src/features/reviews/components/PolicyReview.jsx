import { useId, useState } from 'react';
import { usePolicyReview } from '../hooks/usePolicyReview';
import ReviewAppeal from './ReviewAppeal';
import { useStore } from '@/store';
import { reviewLabel } from '../presentation';
import { Button } from '@/components/ui/primitives/button';
import { Textarea } from '@/components/ui/primitives/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/primitives/radio-group';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/primitives/alert-dialog';

export default function PolicyReview({ policyNumber }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const account = useStore((state) => state.customer?.email);
  return <div className="mt-4">
    <Button variant="outline" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>{open ? 'Close review' : 'Manage review'}</Button>
    {open && <div id={id}><PolicyReviewDetails key={`${account}:${policyNumber}`} policyNumber={policyNumber} /></div>}
  </div>;
}
function PolicyReviewDetails({ policyNumber }) {
  const review = usePolicyReview(policyNumber);
  if (!review.state) return <section className="mt-5 space-y-3 border-t pt-4"><h3 className="font-semibold">Your insurer review</h3>{review.error ? <><p role="alert">{review.error}</p><Button variant="outline" onClick={review.reload}>Retry review</Button></> : <p role="status">Loading review eligibility…</p>}</section>;
  return <ReviewEditor state={review.state} save={review.save} busy={review.saving} error={review.saveError} />;
}

function ReviewEditor({ state, save, busy, error }) {
  const id = useId();
  const revision = state.review?.pending || state.review?.published;
  const [rating, setRating] = useState(revision?.rating == null ? '' : String(revision.rating));
  const [text, setText] = useState(revision?.text || '');
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const act = async (operation) => {
    setMessage('');
    if (await save(operation, { rating: Number(rating), text })) {
      setMessage(operation === 'withdraw' ? 'Your review has been withdrawn.' : 'Your review has been sent for moderation.');
      setConfirm(false);
    }
  };
  const latest = state?.review?.pending;
  const appealDecision = !state.review?.withdrawnAt && latest?.decisionId && ['REJECTED', 'REMOVED'].includes(latest.status) ? latest.decisionId : null;
  return <section className="mt-5 space-y-3 border-t pt-4" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`} className="font-semibold">Your insurer review</h3>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {state && <>
      {state.review && <div className="space-y-2 text-sm">
        <p>Review status: {reviewLabel(state.review.status)}</p>
        {latest && <div><p>Latest submission: {reviewLabel(latest.status)}{latest.rating != null && ` · ${latest.rating} out of 5 stars`}</p><p className="whitespace-pre-wrap break-words">{latest.text}</p>{latest.reason && <p>Moderation reason: {reviewLabel(latest.reason)}</p>}</div>}
        {state.review.published && <div><p>Published version: {state.review.published.rating} out of 5 stars</p><p className="whitespace-pre-wrap break-words">{state.review.published.text}</p></div>}
      </div>}
      {(state.canSubmit || state.canEdit) ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (rating) act(state.canSubmit ? 'submit' : 'edit'); }}>
        <p className="text-sm text-muted-foreground">Reviews and edits require moderation. Keep names, policy numbers and other personal details out of your review.</p>
        <fieldset disabled={busy} className="space-y-2"><legend className="text-sm font-medium">Rating (required)</legend>
          <RadioGroup name={`${id}-rating`} aria-label="Rating" required value={rating} onValueChange={setRating} className="grid grid-cols-5 gap-1">
            {[1, 2, 3, 4, 5].map((value) => <label key={value} className="flex min-h-11 items-center justify-center gap-1 text-sm" htmlFor={`${id}-${value}`}><RadioGroupItem id={`${id}-${value}`} value={String(value)} /><span>{value} <span aria-hidden="true">★</span><span className="sr-only">{value === 1 ? 'star' : 'stars'}</span></span></label>)}
          </RadioGroup>
          <label htmlFor={`${id}-text`} className="block text-sm font-medium">Written review (optional)</label>
          <Textarea id={`${id}-text`} value={text} onChange={(event) => setText(event.target.value)} />
        </fieldset>
        <Button type="submit" disabled={busy || !rating}>{busy ? 'Saving…' : state.canSubmit ? 'Submit review' : 'Submit edited review'}</Button>
      </form> : !state.review && <p className="text-sm text-muted-foreground">This policy is not currently eligible for a review.</p>}
      {state.canWithdraw && <Button variant="outline" disabled={busy} onClick={() => setConfirm(true)}>Withdraw review</Button>}
    </>}
    {state.review?.id && <ReviewAppeal key={`${state.review.id}:${appealDecision}`} reviewId={state.review.id} decisionId={appealDecision} />}
    <AlertDialog open={confirm} onOpenChange={(open) => { if (!busy) setConfirm(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Withdraw your review?</AlertDialogTitle><AlertDialogDescription>This removes your public review and any insurer response. You cannot submit another review for this policy.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep review</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); act('withdraw'); }}>Confirm withdrawal</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
