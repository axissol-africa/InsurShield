import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { Textarea } from '@/components/ui/primitives/textarea';
import { formatDate, formatZMW } from '@/domain/premiumEngine';
import { INSURER_STATUS_LABELS, canComplete, canMove, isOpen, typeLabel } from '@/domain/serviceRequests';
import FilePicker from '@/features/service-requests/components/FilePicker';
import Timeline from '@/features/service-requests/components/Timeline';
import { filesProblem, messageOf } from '@/features/service-requests/shared';
import { PageHeader, StatusBadge } from './ui';

const label = (status) => INSURER_STATUS_LABELS[status] ?? status;
const tone = (status) => (isOpen(status) ? 'open' : status === 'DECLINED' ? 'declined' : 'settled');

/**
 * What customers have asked about the insurer's policies: a queue, oldest
 * open request first, and one request at a time with its history and the
 * steps it allows. Roles that only read see the same without the steps.
 */
export default function ServiceRequestsTab({ api, canManage }) {
  const [rows, setRows] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');

  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    api.serviceRequests.insurer.list()
      .then((loaded) => { if (current) setRows(loaded); })
      .catch((caught) => { if (current) setError(messageOf(caught, 'Service requests could not be loaded. Refresh to try again.')); });
    return () => { current = false; };
  }, [api, version]);

  const show = async (reference) => {
    setError('');
    try {
      setOpen(await api.serviceRequests.insurer.get(reference));
    } catch (caught) {
      setError(messageOf(caught, 'This request could not be opened.'));
    }
  };
  const changed = (request) => {
    setOpen(request);
    setVersion((value) => value + 1);
  };

  if (open) {
    return <RequestScreen api={api} request={open} canManage={canManage} onBack={() => setOpen(null)} onChanged={changed} />;
  }

  const shown = (rows || []).filter((row) => showAll || isOpen(row.status));
  return (
    <div className="space-y-6">
      <PageHeader title="Service requests" description="Customers asking you to correct a detail, replace a document, cancel cover or help with a policy. The oldest open request is at the top." />
      <div role="group" aria-label="Show service requests" className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={showAll ? 'outline' : 'default'} aria-pressed={!showAll} onClick={() => setShowAll(false)}>Still open</Button>
        <Button type="button" size="sm" variant={showAll ? 'default' : 'outline'} aria-pressed={showAll} onClick={() => setShowAll(true)}>All</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {rows === null && !error && <p className="text-sm text-muted-foreground">Loading service requests…</p>}
      {rows && shown.length === 0 && <p className="text-sm text-muted-foreground">{showAll ? 'No customer has asked you for anything yet.' : 'Nothing is waiting on you.'}</p>}
      {shown.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {shown.map((row) => (
            <li key={row.reference} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{typeLabel(row.type)} · {row.customerName}</span>
                <span className="block text-muted-foreground">Policy {row.policyNumber} · <span className="font-mono">{row.reference}</span> · received {formatDate(row.createdAt)}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge status={row.status} tone={tone(row.status)}>{label(row.status)}</StatusBadge>
                <Button type="button" size="sm" variant="ghost" onClick={() => show(row.reference)}>Open</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestScreen({ api, request, canManage, onBack, onChanged }) {
  const [step, setStep] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (work, fallback) => {
    setBusy(true);
    setError('');
    try {
      onChanged(await work());
      setStep(null);
    } catch (caught) {
      setError(messageOf(caught, fallback));
    } finally {
      setBusy(false);
    }
  };
  const actions = api.serviceRequests.insurer;
  const open = isOpen(request.status);
  const steps = canManage && open
    ? [
        canMove('REVIEW', request.status) && { id: 'review', label: 'Take into review' },
        canMove('REQUEST_INFORMATION', request.status) && { id: 'ask', label: 'Ask the customer' },
        { id: 'update', label: 'Add an update' },
        canMove('APPROVE', request.status) && { id: 'approve', label: request.type === 'CANCELLATION' ? 'Approve the cancellation' : 'Approve' },
        canComplete(request) && { id: 'complete', label: request.type === 'CANCELLATION' ? 'Cancel the policy now' : 'Record it as done' },
        canMove('DECLINE', request.status) && { id: 'decline', label: 'Decline' },
      ].filter(Boolean)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title={typeLabel(request.type)} description={`${request.customer.fullName} · policy ${request.policyNumber} · ${request.reference}`} onBack={onBack} backLabel="Back to service requests">
        <StatusBadge status={request.status} tone={tone(request.status)} className="px-3 py-1">{label(request.status)}</StatusBadge>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle><h2>The request</h2></CardTitle>
          <CardDescription>Received {formatDate(request.createdAt)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Customer</dt><dd>{request.customer.fullName}</dd></div>
            <div><dt className="text-muted-foreground">Phone</dt><dd><a className="text-primary underline" href={`tel:${request.customer.phone}`}>{request.customer.phone}</a></dd></div>
            <div><dt className="text-muted-foreground">Email</dt><dd className="break-all"><a className="text-primary underline" href={`mailto:${request.customer.email}`}>{request.customer.email}</a></dd></div>
          </dl>
          {request.requestedEffectiveDate && <p>The customer asks for the cover to end on <strong>{formatDate(request.requestedEffectiveDate)}</strong>.</p>}
          {request.decision && (
            <p>
              {request.decision.outcome === 'APPROVED' ? 'Approved' : 'Declined'} on {formatDate(request.decision.decidedAt)}
              {request.decision.effectiveDate && <> · cover ends {formatDate(request.decision.effectiveDate)}</>}
              {request.decision.refundAmount !== null && request.decision.refundAmount !== undefined && <> · refund {formatZMW(request.decision.refundAmount)}</>}
            </p>
          )}
        </CardContent>
      </Card>

      {steps.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Steps">
          {steps.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              variant={entry.id === 'decline' ? 'outline' : step === entry.id ? 'default' : 'secondary'}
              disabled={busy}
              onClick={() => (entry.id === 'review' ? run(() => actions.review(request.reference), 'The request could not be taken into review.') : setStep(entry.id))}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {step === 'ask' && (
        <MessageStep
          title="Ask the customer"
          hint="The customer is told and replies from their account. The request waits for them."
          submitLabel="Send the question"
          busy={busy}
          minLength={10}
          onSubmit={({ message }) => run(() => actions.requestInformation(request.reference, message), 'The question could not be sent.')}
        />
      )}
      {step === 'update' && (
        <MessageStep
          title="Add an update"
          hint="Tell the customer how it is going, or keep a note for your team."
          submitLabel="Add the update"
          busy={busy}
          withFiles
          withVisibility
          onSubmit={({ message, files, visibleToCustomer }) => run(() => actions.postUpdate(request.reference, { message, visibleToCustomer, files }), 'The update could not be added.')}
        />
      )}
      {step === 'decline' && (
        <MessageStep
          title="Decline the request"
          hint="The customer reads this as written. Say why, and what they can do instead."
          submitLabel="Decline"
          busy={busy}
          minLength={10}
          onSubmit={({ message }) => run(() => actions.decline(request.reference, message), 'The request could not be declined.')}
        />
      )}
      {step === 'approve' && (
        <ApproveStep
          request={request}
          busy={busy}
          onSubmit={(decision) => run(() => actions.approve(request.reference, decision), 'The request could not be approved.')}
        />
      )}
      {step === 'complete' && (
        <MessageStep
          title={request.type === 'CANCELLATION' ? 'Cancel the policy' : 'Record what you did'}
          hint={request.type === 'CANCELLATION'
            ? 'The policy is cancelled now. When a refund is due, InsurShield opens it for two of its administrators to approve and pay.'
            : 'Tell the customer what was done. Attach a replacement certificate or document here.'}
          submitLabel={request.type === 'CANCELLATION' ? 'Cancel the policy' : 'Record it as done'}
          busy={busy}
          withFiles
          onSubmit={({ message, files }) => run(() => actions.complete(request.reference, { note: message, files }), 'The request could not be completed.')}
        />
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">History</h2>
        <Timeline updates={request.updates} insurer="Insurer" staffView />
      </section>
    </div>
  );
}

function MessageStep({ title, hint, submitLabel, busy, onSubmit, minLength = 2, withFiles = false, withVisibility = false }) {
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [visibleToCustomer, setVisibleToCustomer] = useState(true);
  const [problem, setProblem] = useState('');
  const submit = (event) => {
    event.preventDefault();
    const found = message.trim().length < minLength ? `Write at least ${minLength} characters.` : filesProblem(files);
    setProblem(found || '');
    if (!found) onSubmit({ message: message.trim(), files, visibleToCustomer });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>{title}</h2></CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <label htmlFor="sr-step-message" className="sr-only">{title}</label>
          <Textarea id="sr-step-message" rows={4} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} />
          {withVisibility && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!visibleToCustomer} onChange={(event) => setVisibleToCustomer(!event.target.checked)} />
              Internal note: do not show it to the customer
            </label>
          )}
          {withFiles && <FilePicker files={files} onChange={setFiles} hint="Optional. Up to 5 PDF, JPG or PNG files." />}
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ApproveStep({ request, busy, onSubmit }) {
  const cancellation = request.type === 'CANCELLATION';
  const [note, setNote] = useState('');
  const [refund, setRefund] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(request.requestedEffectiveDate || '');
  const [problem, setProblem] = useState('');
  const submit = (event) => {
    event.preventDefault();
    const amount = Number(refund);
    let found = note.trim().length < 2 ? 'Tell the customer what you approved.' : '';
    if (!found && cancellation && (refund === '' || !Number.isFinite(amount) || amount < 0)) found = 'Enter the refund in kwacha, 0 if none is due.';
    if (!found && cancellation && !effectiveDate) found = 'Choose the day the cover ends.';
    setProblem(found);
    if (found) return;
    onSubmit({ note: note.trim(), ...(cancellation ? { refundAmount: Math.round(amount * 100) / 100, effectiveDate } : {}) });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>{cancellation ? 'Approve the cancellation' : 'Approve the request'}</h2></CardTitle>
        <CardDescription>
          {cancellation
            ? 'State the refund you have worked out and the day the cover ends. Nothing changes on the policy until you cancel it.'
            : 'Tell the customer what you will do. Record it as done once it is.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="sr-approve-note" className="text-sm font-medium">Note to the customer</label>
            <Textarea id="sr-approve-note" rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
          </div>
          {cancellation && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="sr-refund" className="text-sm font-medium">Refund (ZMW)</label>
                <Input id="sr-refund" type="number" inputMode="decimal" min="0" step="0.01" value={refund} onChange={(event) => setRefund(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="sr-end" className="text-sm font-medium">Cover ends on</label>
                <Input id="sr-end" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
              </div>
            </div>
          )}
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Approve'}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
