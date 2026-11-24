import { useEffect, useId, useState } from 'react';
import { MessageCircleQuestion, NotebookPen, TriangleAlert, XCircle } from 'lucide-react';
import { canAskCustomer, canDecline, PORTAL_STATUS_LABELS } from '@/domain/quoteWorkflow';
import { formatDate } from '@/domain/premiumEngine';
import { usePortalAction } from '@/features/insurer-portal/hooks/usePortalAction';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/primitives/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/primitives/field';
import { Input } from '@/components/ui/primitives/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { Spinner } from '@/components/ui/primitives/spinner';
import { Textarea } from '@/components/ui/primitives/textarea';
import { TaskPanel } from './TaskScreen';

/** The API's own words when it gives them, otherwise the caller's plain fallback. */
const messageOf = (fallback) => (caught) => (caught?.code && caught?.message ? caught.message : fallback);

/**
 * What the insurer can do with one chosen product besides quoting it: ask the
 * customer something (the reply clock stops until they answer), decline it
 * with an approved reason, and keep internal notes the customer never sees.
 */
export default function ProductWorkflowPanel({ request, api, onChanged, session }) {
  const workflow = request.workflow;
  const [open, setOpen] = useState(null);
  const status = workflow?.status;
  const asked = workflow?.informationRequests ?? [];
  const waitingFor = asked.find((question) => !question.closedAt && !question.answeredAt && question.open !== false);

  return (
    <TaskPanel title="This product" description="Ask the customer for more information or decline this product. Notes stay inside your team.">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Status</span>
          <Badge variant="outline">{PORTAL_STATUS_LABELS[status] ?? 'New'}</Badge>
          {workflow?.priority === 'HIGH' && <Badge variant="destructive">Urgent</Badge>}
        </div>

        <Ownership request={request} api={api} session={session} onChanged={onChanged} />

        {status === 'INSPECTION_REQUIRED' && (
          <Alert>
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>This product needs a vehicle inspection before it can be quoted.</AlertTitle>
            <AlertDescription>Book and record it under Inspections. Until it passes you can decline the product, but not quote it.</AlertDescription>
          </Alert>
        )}

        {waitingFor && (
          <Alert>
            <MessageCircleQuestion aria-hidden="true" />
            <AlertTitle>Waiting for the customer to answer</AlertTitle>
            <AlertDescription>
              <p>“{waitingFor.message}”</p>
              <p>Answer due {formatDate(waitingFor.dueAt)}. Your reply deadline is paused until they answer.</p>
            </AlertDescription>
          </Alert>
        )}

        {asked.filter((question) => question.answer).map((question) => (
          <div key={question.id} className="rounded-xl bg-muted/60 p-3 text-sm">
            <p className="text-muted-foreground">You asked: {question.message}</p>
            <p className="mt-1 text-foreground">Customer answered: {question.answer}</p>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          {canAskCustomer(status) && (
            <Button type="button" variant="outline" aria-expanded={open === 'ask'} onClick={() => setOpen(open === 'ask' ? null : 'ask')}>
              <MessageCircleQuestion aria-hidden="true" /> Ask the customer
            </Button>
          )}
          {canDecline(status) && (
            <Button type="button" variant="outline" aria-expanded={open === 'decline'} onClick={() => setOpen(open === 'decline' ? null : 'decline')}>
              <XCircle aria-hidden="true" /> Decline this product
            </Button>
          )}
        </div>

        {open === 'ask' && (
          <AskCustomerForm
            onCancel={() => setOpen(null)}
            onSubmit={async (question) => {
              await api.quotes.requestInformation(request.id, request.productVersionId, question);
              setOpen(null);
              await onChanged?.('asked');
            }}
          />
        )}
        {open === 'decline' && (
          <DeclineForm
            loadReasons={api.quotes.declineReasons}
            onCancel={() => setOpen(null)}
            onSubmit={async (decision) => {
              await api.quotes.decline(request.id, request.productVersionId, decision);
              setOpen(null);
              await onChanged?.('declined');
            }}
          />
        )}

        <InternalNotes request={request} api={api} />
      </div>
    </TaskPanel>
  );
}

/** The roles that quote, as the staff list words them. Only they can own a product. */
const QUOTING_ROLE_LABELS = ['Insurer administrator', 'Quote officer', 'Insurer portal user'];

/**
 * Who owns this product. Anyone on the quoting team can take an unowned one;
 * the insurer's administrator can also give it to a colleague and mark it urgent.
 */
function Ownership({ request, api, session, onChanged }) {
  const id = useId();
  const workflow = request.workflow;
  const owner = workflow?.owner;
  const isAdmin = session?.staffRole === 'INSURER_ADMIN';
  const open = canDecline(workflow?.status);
  const [team, setTeam] = useState(null);
  const act = usePortalAction(async (change) => {
    await change();
    await onChanged?.('assigned');
  }, messageOf('That change could not be saved. Please try again.'));

  useEffect(() => {
    if (!isAdmin || !open) return undefined;
    let current = true;
    api.staff.listUsers()
      .then((users) => { if (current) setTeam(users.filter((user) => user.isActive !== false && QUOTING_ROLE_LABELS.includes(user.role))); })
      .catch(() => { if (current) setTeam([]); });
    return () => { current = false; };
  }, [api, isAdmin, open]);

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="text-muted-foreground">Owner </span>
        <span className="font-medium">{owner ? (owner.id === session?.id ? 'You' : owner.name) : 'Nobody yet'}</span>
      </p>
      {/* Nothing to offer an officer once the product is owned; no empty row for them. */}
      {open && (!owner || isAdmin) && (
        <div className="flex flex-wrap items-end gap-2">
          {!owner && (
            <Button type="button" variant="outline" size="sm" disabled={act.pending} onClick={() => act.run(() => api.quotes.claim(request.id, request.productVersionId))}>
              Take this product
            </Button>
          )}
          {isAdmin && team && (
            <div className="space-y-1">
              <FieldLabel htmlFor={`${id}-owner`}>Assign to</FieldLabel>
              <NativeSelect
                id={`${id}-owner`}
                size="sm"
                value={owner?.id ?? ''}
                disabled={act.pending}
                onChange={(event) => {
                  const staffId = event.target.value || null;
                  void act.run(() => api.quotes.assign(request.id, request.productVersionId, staffId));
                }}
              >
                <NativeSelectOption value="">Nobody</NativeSelectOption>
                {team.map((member) => <NativeSelectOption key={member.id} value={member.id}>{member.fullName}</NativeSelectOption>)}
              </NativeSelect>
            </div>
          )}
          {isAdmin && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={act.pending}
              onClick={() => act.run(() => api.quotes.setPriority(request.id, request.productVersionId, workflow?.priority === 'HIGH' ? 'NORMAL' : 'HIGH'))}
            >
              {workflow?.priority === 'HIGH' ? 'Mark as normal' : 'Mark as urgent'}
            </Button>
          )}
        </div>
      )}
      {act.error && <p role="alert" className="text-sm text-destructive">{act.error}</p>}
    </div>
  );
}

function AskCustomerForm({ onSubmit, onCancel }) {
  const id = useId();
  const [message, setMessage] = useState('');
  const [dueInDays, setDueInDays] = useState('3');
  const sending = usePortalAction(onSubmit, messageOf('Your question could not be sent. Please try again.'));
  const tooShort = message.trim().length < 5;

  return (
    <form
      aria-label="Ask the customer"
      className="rounded-2xl border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (tooShort) return;
        void sending.run({ message: message.trim(), dueInDays: Number(dueInDays) });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${id}-message`}>What do you need from the customer? *</FieldLabel>
          <Textarea id={`${id}-message`} rows={3} required maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} aria-describedby={`${id}-message-hint`} />
          <FieldDescription id={`${id}-message-hint`}>The customer reads this exactly as written.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-days`}>Days to answer</FieldLabel>
          <Input id={`${id}-days`} type="number" inputMode="numeric" min="1" max="14" required className="sm:max-w-32" value={dueInDays} onChange={(event) => setDueInDays(event.target.value)} />
        </Field>
        {sending.error && <p role="alert" className="text-sm text-destructive">{sending.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={sending.pending || tooShort} aria-busy={sending.pending}>
            {sending.pending && <Spinner aria-hidden="true" />} Send question
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={sending.pending}>Cancel</Button>
        </div>
      </FieldGroup>
    </form>
  );
}

function DeclineForm({ loadReasons, onSubmit, onCancel }) {
  const id = useId();
  const [reasons, setReasons] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const sending = usePortalAction(onSubmit, messageOf('This product could not be declined. Please try again.'));
  const reason = reasons?.find((candidate) => candidate.code === reasonCode);

  useEffect(() => {
    let current = true;
    loadReasons()
      .then((loaded) => { if (current) setReasons(loaded); })
      .catch(() => { if (current) setLoadError('The decline reasons could not be loaded. Reload the page and try again.'); });
    return () => { current = false; };
  }, [loadReasons]);

  return (
    <form
      aria-label="Decline this product"
      className="rounded-2xl border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!reason) return;
        void sending.run({ reasonCode, customerNote: customerNote.trim() || undefined, internalNote: internalNote.trim() || undefined });
      }}
    >
      <FieldGroup>
        {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
        <Field>
          <FieldLabel htmlFor={`${id}-reason`}>Reason *</FieldLabel>
          <NativeSelect id={`${id}-reason`} required value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} className="w-full" disabled={!reasons}>
            <NativeSelectOption value="">{reasons ? 'Choose a reason' : 'Loading reasons…'}</NativeSelectOption>
            {(reasons ?? []).map((candidate) => (
              <NativeSelectOption key={candidate.code} value={candidate.code}>{candidate.internalText}</NativeSelectOption>
            ))}
          </NativeSelect>
          {reason && <FieldDescription>The customer will read: “{reason.customerText}”</FieldDescription>}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-customer-note`}>Note to the customer</FieldLabel>
          <Textarea id={`${id}-customer-note`} rows={2} maxLength={1000} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} aria-describedby={`${id}-customer-note-hint`} />
          <FieldDescription id={`${id}-customer-note-hint`}>Optional. Shown to the customer under the reason.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-internal-note`}>Internal note</FieldLabel>
          <Textarea id={`${id}-internal-note`} rows={2} maxLength={4000} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} aria-describedby={`${id}-internal-note-hint`} />
          <FieldDescription id={`${id}-internal-note-hint`}>Optional. Kept with your team’s notes; the customer never sees it.</FieldDescription>
        </Field>
        {sending.error && <p role="alert" className="text-sm text-destructive">{sending.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="destructive" disabled={sending.pending || !reason} aria-busy={sending.pending}>
            {sending.pending && <Spinner aria-hidden="true" />} Decline product
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={sending.pending}>Cancel</Button>
        </div>
      </FieldGroup>
    </form>
  );
}

function InternalNotes({ request, api }) {
  const id = useId();
  const [notes, setNotes] = useState(null);
  const [body, setBody] = useState('');
  const [loadError, setLoadError] = useState('');
  const saving = usePortalAction(async (text) => {
    const saved = await api.quotes.addNote(request.id, request.productVersionId, text);
    setNotes((current) => [saved, ...(current ?? [])]);
    setBody('');
  }, messageOf('The note could not be saved. Please try again.'));

  useEffect(() => {
    let current = true;
    api.quotes.notes(request.id, request.productVersionId)
      .then((loaded) => { if (current) setNotes(loaded); })
      .catch(() => { if (current) setLoadError('Notes could not be loaded.'); });
    return () => { current = false; };
  }, [api, request.id, request.productVersionId]);

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 border-t border-border pt-4">
      <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-medium">
        <NotebookPen className="size-4" aria-hidden="true" /> Internal notes
      </h3>
      <p className="text-xs text-muted-foreground">Only your team sees these. Notes cannot be edited or removed once saved.</p>
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
      {notes?.length ? (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-xl bg-muted/60 p-3 text-sm">
              <p className="whitespace-pre-wrap">{note.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{note.author || 'Your team'} · {formatDate(note.createdAt)}</p>
            </li>
          ))}
        </ul>
      ) : notes && <p className="text-sm text-muted-foreground">No notes yet.</p>}
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim()) void saving.run(body.trim());
        }}
      >
        <FieldLabel htmlFor={`${id}-note`}>Add a note</FieldLabel>
        <Textarea id={`${id}-note`} rows={2} maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} />
        {saving.error && <p role="alert" className="text-sm text-destructive">{saving.error}</p>}
        <Button type="submit" variant="outline" size="sm" disabled={saving.pending || !body.trim()} aria-busy={saving.pending}>
          {saving.pending && <Spinner aria-hidden="true" />} Save note
        </Button>
      </form>
    </section>
  );
}
