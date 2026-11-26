import { useCallback, useState } from 'react';
import { api } from '@/api';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/primitives/native-select';
import { Textarea } from '@/components/ui/primitives/textarea';
import { useStaffResource } from '@/features/reviews/staff/useStaffResource';
import { WorkspaceFeedback, WorkspaceField, WorkspacePages, WorkspaceState } from './WorkspaceState';
import { statusLabel } from './statusLabel';
import { useWorkspaceAction } from './useWorkspaceAction';

const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const metadataNotice = 'Metadata-only outcome: recording a review does not change the quote, reconciliation item, payment, or underlying workflow.';

function accessMessage(error) {
  if (error.status === 401) return new Error('Your session has expired. Sign in again to review risks.');
  if (error.status === 403) return new Error('You do not have access to risk reviews. Contact an administrator.');
  return error;
}

export default function RiskWorkspace({ staffId, transport = api.riskReview }) {
  return <RiskQueue key={staffId || 'anonymous'} staffId={staffId} transport={transport} />;
}

function RiskQueue({ staffId, transport }) {
  const [status, setStatus] = useState('');
  const [cursors, setCursors] = useState([undefined]);
  const cursor = cursors.at(-1);
  const load = useCallback(async () => {
    try {
      return await transport.list({ limit: 20, ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) });
    } catch (error) { throw accessMessage(error); }
  }, [transport, status, cursor]);
  const reviews = useStaffResource(load);

  function refreshFirstPage() {
    setCursors([undefined]);
    reviews.reload();
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Risk review</h2>
        <p className="text-sm text-muted-foreground">Refer a workflow for review, record an accountable reviewer, and document the outcome.</p>
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-sm">{metadataNotice}</p>
      </div>
      {!reviews.loading && !reviews.error && <Card className="border-border shadow-none">
          <CardHeader><CardTitle>Create a risk referral</CardTitle></CardHeader>
          <CardContent><RiskReferral transport={transport} reload={refreshFirstPage} /></CardContent>
        </Card>}
      <Card className="border-border shadow-none">
        <CardHeader><CardTitle>Review queue</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <WorkspaceField label="Review status">
            <NativeSelect value={status} onChange={(event) => { setStatus(event.target.value); setCursors([undefined]); }}>
              <NativeSelectOption value="">All statuses</NativeSelectOption>
              {['OPEN', 'IN_PROGRESS', 'RESOLVED'].map((value) => <NativeSelectOption key={value} value={value}>{statusLabel(value)}</NativeSelectOption>)}
            </NativeSelect>
          </WorkspaceField>
          <WorkspaceState {...reviews}>
            {!reviews.data?.items.length && <p className="text-sm text-muted-foreground">No risk reviews match this status.</p>}
            {reviews.data?.items.map((item) => <RiskCase key={`${item.id}:${item.version}`} item={item} staffId={staffId} transport={transport} reload={reviews.reload} />)}
            <WorkspacePages page={cursors.length} hasMore={Boolean(reviews.data?.next)} onPage={(page) => setCursors((previous) => page < previous.length ? previous.slice(0, -1) : [...previous, reviews.data.next])} />
          </WorkspaceState>
        </CardContent>
      </Card>
    </div>
  );
}

function RiskReferral({ transport, reload }) {
  const action = useWorkspaceAction();
  const [workflowType, setWorkflowType] = useState('QUOTE');
  const [workflowId, setWorkflowId] = useState('');
  const evidenceReference = `${workflowType === 'QUOTE' ? 'quote' : 'reconciliation'}:${workflowId.trim().toLowerCase()}`;

  function submit(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    action.run(async () => {
      const reason = fields.reason.trim();
      const nextAction = fields.nextAction.trim();
      if (reason.length < 10 || nextAction.length < 3) throw new Error('Enter a reason of at least 10 characters and a next action of at least 3 characters.');
      try {
        return await transport.refer({ workflowType, workflowId: workflowId.trim(), evidenceReference, severity: fields.severity, reason, nextAction });
      } catch (error) { throw accessMessage(error); }
    }, { onSuccess: reload });
  }

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-3">
      <fieldset disabled={action.busy} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <WorkspaceField label="Workflow type"><NativeSelect className="w-full" value={workflowType} onChange={(event) => setWorkflowType(event.target.value)}><NativeSelectOption value="QUOTE">Quote</NativeSelectOption><NativeSelectOption value="RECONCILIATION_ITEM">Reconciliation item</NativeSelectOption></NativeSelect></WorkspaceField>
          <WorkspaceField label="Severity"><NativeSelect name="severity" className="w-full" defaultValue="MEDIUM">{['LOW', 'MEDIUM', 'HIGH'].map((value) => <NativeSelectOption key={value} value={value}>{statusLabel(value)}</NativeSelectOption>)}</NativeSelect></WorkspaceField>
        </div>
        <WorkspaceField label="Workflow ID"><Input required pattern={uuidPattern} maxLength={36} value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} title="Enter a version 4 UUID" /></WorkspaceField>
        <WorkspaceField label="Evidence reference"><Input readOnly value={workflowId ? evidenceReference : ''} /></WorkspaceField>
        <WorkspaceField label="Referral reason"><Textarea name="reason" required minLength={10} maxLength={1000} rows={3} /></WorkspaceField>
        <WorkspaceField label="Referral next action"><Textarea name="nextAction" required minLength={3} maxLength={500} rows={2} /></WorkspaceField>
        <Button type="submit">{action.busy ? 'Recording…' : 'Create referral'}</Button>
      </fieldset>
      <WorkspaceFeedback error={action.error} />
    </form>
  );
}

function RiskCase({ item, staffId, transport, reload }) {
  const action = useWorkspaceAction();
  const [blocked, setBlocked] = useState(false);
  const [expanded, setExpanded] = useState(false);

  function submit(event, operation) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    action.run(async () => {
      const nextAction = fields.nextAction.trim();
      if (nextAction.length < 3) throw new Error('Enter a next action of at least 3 characters.');
      const body = { expectedVersion: item.version, nextAction };
      if (operation === 'assign') body.staffId = fields.staffId.trim();
      else {
        body.outcome = fields.outcome;
        body.reason = fields.reason.trim();
        if (body.reason.length < 10) throw new Error('Enter a resolution reason of at least 10 characters.');
      }
      try { return await transport[operation](item.id, body); }
      catch (error) {
        if (error.status === 409 || ['RISK_REVIEW_STALE', 'RISK_REVIEW_RESOLVED'].includes(error.code)) {
          setBlocked(true);
          throw new Error('This review changed. Reload reviews and check the latest version before saving again.', { cause: error });
        }
        if ([401, 403].includes(error.status)) setBlocked(true);
        throw accessMessage(error);
      }
    }, { onSuccess: reload });
  }

  return (
    <article className="min-w-0 space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="font-medium">{statusLabel(item.workflowType)} review</h3><p className="break-all text-xs text-muted-foreground">{item.id} · Version {item.version}</p></div>
        <div className="flex flex-wrap gap-2"><Badge variant={item.severity === 'HIGH' ? 'default' : 'secondary'}>{statusLabel(item.severity)} severity</Badge><Badge variant="outline">{statusLabel(item.status)}</Badge></div>
      </div>
      <p className="break-all text-sm">Evidence · {item.evidenceReference}</p>
      <p className="whitespace-pre-wrap break-words text-sm">Reason · {item.reason}</p>
      <p className="break-all text-sm">Accountable reviewer · {item.ownerStaffId || 'Unassigned'}</p>
      <p className="whitespace-pre-wrap break-words text-sm">Next action · {item.nextAction}</p>
      {item.status === 'RESOLVED' ? <div className="space-y-2 border-t pt-3 text-sm"><p>Outcome · {statusLabel(item.outcome)} (metadata only)</p><p className="whitespace-pre-wrap break-words">{item.resolutionReason}</p><p className="break-all">Resolved by · {item.resolvedByStaffId}</p></div> : <>
        <Button type="button" variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Review actions<span className="sr-only"> {item.id}</span></Button>
        {expanded && <div className="grid gap-5 border-t pt-4 lg:grid-cols-2">
          <form onSubmit={(event) => submit(event, 'assign')}>
            <fieldset disabled={action.busy || blocked} className="space-y-3">
              <legend className="mb-3 font-medium">Assign an accountable reviewer</legend>
              <WorkspaceField label="Reviewer staff ID"><Input name="staffId" required pattern={uuidPattern} maxLength={36} defaultValue={item.ownerStaffId || staffId || ''} title="Enter an active administrator's version 4 UUID" /></WorkspaceField>
              <WorkspaceField label="Assignment next action"><Textarea name="nextAction" required minLength={3} maxLength={500} defaultValue={item.nextAction} /></WorkspaceField>
              <Button type="submit" variant="outline">Save assignment</Button>
            </fieldset>
          </form>
          <form onSubmit={(event) => submit(event, 'resolve')}>
            <fieldset disabled={action.busy || blocked} className="space-y-3">
              <legend className="mb-3 font-medium">Record resolution</legend>
              <WorkspaceField label="Resolution outcome"><NativeSelect name="outcome" className="w-full"><NativeSelectOption value="NO_ACTION">No action</NativeSelectOption><NativeSelectOption value="REFERRED">Referred</NativeSelectOption></NativeSelect></WorkspaceField>
              <WorkspaceField label="Resolution reason"><Textarea name="reason" required minLength={10} maxLength={1000} /></WorkspaceField>
              <WorkspaceField label="Resolution next action"><Textarea name="nextAction" required minLength={3} maxLength={500} /></WorkspaceField>
              <p className="text-xs text-muted-foreground">{metadataNotice}</p>
              <Button type="submit">Save resolution</Button>
            </fieldset>
          </form>
        </div>}
        <WorkspaceFeedback error={action.error} />
        {action.error && <Button type="button" variant="outline" onClick={reload}>Reload reviews</Button>}
      </>}
    </article>
  );
}
