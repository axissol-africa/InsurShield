import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, Eye, FileCheck2, MessageSquareText, ShieldAlert, X } from 'lucide-react';
import { api as defaultApi } from '@/api';
import CoverGuideDocument from '@/components/cover-guide/CoverGuideDocument';
import { Alert, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Field, FieldLabel } from '@/components/ui/primitives/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { Spinner } from '@/components/ui/primitives/spinner';
import { Textarea } from '@/components/ui/primitives/textarea';

const FILTERS = [
  ['SUBMITTED', 'Awaiting review'],
  ['', 'All product versions'],
  ['APPROVED', 'Approved versions'],
  ['REJECTED', 'Returned versions'],
  ['WITHDRAWN', 'Withdrawn versions'],
];
const STATUS_LABELS = { DRAFT: 'Draft', SUBMITTED: 'Awaiting review', APPROVED: 'Approved', REJECTED: 'Changes requested', WITHDRAWN: 'Withdrawn' };
const statusClass = {
  DRAFT: 'border-primary/20 bg-primary/10 text-primary',
  SUBMITTED: 'border-primary/20 bg-primary/10 text-primary',
  APPROVED: 'border-foreground/15 bg-muted text-foreground',
  REJECTED: 'border-primary/20 bg-primary/10 text-primary',
  WITHDRAWN: 'border-border bg-background text-muted-foreground',
};

/**
 * The platform review queue contains submitted product versions only by
 * default. It is intentionally separate from maker/checker approvals: product
 * review is the ordinary insurer terms workflow defined in Batch 9.
 */
export default function ProductReviewQueue({ api = defaultApi, onBack }) {
  const [filter, setFilter] = useState('SUBMITTED');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (status = filter) => {
    setLoading(true);
    setError('');
    try {
      const records = await api.products.admin.list(status ? { status } : {});
      setItems(Array.isArray(records) ? records : []);
    } catch (caught) {
      setItems([]);
      setError(caught instanceof Error ? caught.message : 'Product versions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [api, filter]);

  useEffect(() => {
    const deferredLoad = window.setTimeout(() => { void load(filter); }, 0);
    return () => window.clearTimeout(deferredLoad);
  }, [filter, load]);

  const decide = async (item, action, payload) => {
    setPending(`${item.product.id}:${item.id}:${action}`);
    setError('');
    setNotice('');
    try {
      if (action === 'approve') await api.products.admin.approve(item.product.id, item.id, payload);
      if (action === 'reject') await api.products.admin.reject(item.product.id, item.id, payload);
      if (action === 'withdraw') await api.products.admin.withdraw(item.product.id, item.id, payload);
      setNotice(action === 'approve' ? `Approved ${item.insurer.name}’s version ${item.versionNumber}.` : action === 'reject' ? `Returned version ${item.versionNumber} to ${item.insurer.name} with your review note.` : `Withdrew version ${item.versionNumber}.`);
      await load(filter);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The review decision could not be saved.');
    } finally {
      setPending('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Button type="button" variant="outline" size="icon" onClick={onBack} aria-label="Back to admin overview"><ChevronDown className="size-4 -rotate-90" aria-hidden="true" /></Button>
          <div><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Product term reviews</h2><p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">Review the terms an active insurer has submitted. Approving makes a version eligible for the customer catalogue; returning it preserves the exact reviewer comment.</p></div>
        </div>
        <Field className="w-full sm:w-56"><FieldLabel htmlFor="product-review-filter">Show</FieldLabel><NativeSelect id="product-review-filter" value={filter} onChange={(event) => setFilter(event.target.value)}>{FILTERS.map(([value, label]) => <NativeSelectOption key={value || 'all'} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field>
      </div>

      {error && <Alert variant="destructive"><ShieldAlert aria-hidden="true" /><AlertTitle>{error}</AlertTitle></Alert>}
      {notice && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">{notice}</p>}

      {loading ? <Card><CardContent className="flex min-h-44 items-center justify-center gap-3 text-sm text-muted-foreground"><Spinner aria-hidden="true" />Loading submitted terms…</CardContent></Card>
        : items.length === 0 ? <Card><CardContent className="py-14 text-center"><FileCheck2 className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-medium">No product versions in this view</p><p className="mt-1 text-sm text-muted-foreground">Submitted insurer terms will appear here for a clear approve-or-return decision.</p></CardContent></Card>
          : <div className="space-y-4">{items.map((item) => <ReviewCard key={`${item.product.id}:${item.id}`} item={item} pending={pending} onDecide={decide} />)}</div>}
    </div>
  );
}

function ReviewCard({ item, pending, onDecide }) {
  const [comment, setComment] = useState(item.reviewComment || '');
  const key = (action) => `${item.product.id}:${item.id}:${action}`;
  const reviewing = Boolean(pending);
  const isSubmitted = item.status === 'SUBMITTED';
  const isApproved = item.status === 'APPROVED';
  const check = (action, text) => (
    <Button type="button" disabled={reviewing} onClick={() => void onDecide(item, action, action === 'withdraw' ? { reason: text } : { comment: text })}>
      {pending === key(action) ? <Spinner aria-hidden="true" /> : action === 'approve' ? <Check aria-hidden="true" /> : action === 'reject' ? <MessageSquareText aria-hidden="true" /> : <X aria-hidden="true" />}
      {action === 'approve' ? 'Approve version' : action === 'reject' ? 'Return for changes' : 'Withdraw version'}
    </Button>
  );
  return (
    <Card className="gap-0 border-border shadow-none">
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b">
        <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wider text-primary">{item.insurer.name}</p><CardTitle className="mt-2 truncate">{item.name}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{item.product.code} · Version {item.versionNumber} · {item.coverType === 'THIRD_PARTY' ? 'Third party only' : 'Comprehensive'} · Effective {item.effectiveFrom}</p></div>
        <Badge variant="outline" className={statusClass[item.status]}>{STATUS_LABELS[item.status] || item.status}</Badge>
      </CardHeader>
      <CardContent className="pt-6">
        {item.reviewComment && !isSubmitted && <p className="mb-5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm"><span className="font-medium">Review note: </span>{item.reviewComment}</p>}
        <dl className="grid gap-4 text-sm sm:grid-cols-3"><Fact label="Inspection" value={inspectionSummary(item.inspection)} /><Fact label="Submitted" value={item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('en-ZM') : 'Not submitted'} /><Fact label="Effective until" value={item.effectiveUntil || 'No expiry date'} /></dl>
        <details className="group mt-6 rounded-xl border border-border bg-muted/20"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-sm font-medium"><span className="flex items-center gap-2"><Eye className="size-4 text-primary" aria-hidden="true" />Read the customer cover guide</span><ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" /></summary><div className="border-t border-border p-4"><CoverGuideDocument guide={item.coverGuide || {}} coverType={item.coverType === 'THIRD_PARTY' ? 'ThirdParty' : 'Comprehensive'} insurerName={item.insurer.name} /></div></details>
        {(isSubmitted || isApproved) && <div className="mt-6 border-t border-border pt-5"><Field><FieldLabel htmlFor={`review-${item.id}`}>{isSubmitted ? 'Review comment (required to return, optional to approve)' : 'Withdrawal reason'}</FieldLabel><Textarea id={`review-${item.id}`} value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder={isSubmitted ? 'Explain any correction the insurer needs to make.' : 'Explain why this approved version is no longer available.'} /></Field><div className="mt-4 flex flex-wrap gap-2">{isSubmitted && check('approve', comment)}{isSubmitted && check('reject', comment)}{isApproved && check('withdraw', comment)}</div></div>}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }) { return <div><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 leading-snug">{value || 'Not stated'}</dd></div>; }
function inspectionSummary(inspection = {}) { return inspection.rule === 'NOT_REQUIRED' ? 'Not required' : `${inspection.rule === 'REQUIRED' ? 'Required' : 'Optional'} · ${(inspection.timing || '').replaceAll('_', ' ').toLowerCase()} · ${(inspection.method || '').replaceAll('_', ' ').toLowerCase()}`; }
