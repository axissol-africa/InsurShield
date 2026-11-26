import { statusLabel } from '@/features/compliance/statusLabel';
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
import { useWorkspaceAction } from './useWorkspaceAction';

const kinds = {
  ACCESS: 'Access to my data',
  CORRECTION: 'Correct my data',
  ERASURE: 'Review data for erasure',
  RESTRICTION: 'Restrict use of my data',
  RETENTION_REVIEW: 'Review how long my data is kept',
};
const affectedTypes = ['CUSTOMER', 'DOCUMENT', 'POLICY', 'CLAIM', 'PAYMENT', 'REVIEW', 'SERVICE_REQUEST'];
const nextAction = { SUBMITTED: 'VERIFIED', VERIFIED: 'DECIDED', DECIDED: 'COMPLETED' };
const actionLabels = { VERIFIED: 'Record identity verification', DECIDED: 'Record decision', COMPLETED: 'Complete request', HOLD: 'Apply retention hold', RELEASE: 'Release retention hold' };

export function CustomerPrivacyRequests({ transport = api.privacyRequests }) {
  const [page, setPage] = useState(1);
  const load = useCallback(() => transport.mine({ page }), [transport, page]);
  const requests = useStaffResource(load);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy requests</CardTitle>
        <p className="text-sm text-muted-foreground">Ask for a review of how your information is handled and follow your request here.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <PrivacyIntake onSubmit={transport.submit} onSaved={requests.reload} />
        <WorkspaceState {...requests}>
          {!requests.data?.items.length && <p className="text-sm text-muted-foreground">You have no privacy requests yet.</p>}
          {requests.data?.items.map((item) => <PrivacyRow key={item.id} item={item} />)}
          {requests.data?.items.length > 0 && <WorkspacePages page={page} hasMore={requests.data?.items.length === requests.data?.pageSize} onPage={setPage} />}
        </WorkspaceState>
      </CardContent>
    </Card>
  );
}

export default function PrivacyWorkspace({ staffId, transport = api.privacyRequests }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [customerId, setCustomerId] = useState('');
  const load = useCallback(() => transport.list({ page, ...(customerId ? { customerId } : {}) }), [transport, page, customerId]);
  const requests = useStaffResource(load);
  if (selected) return (
    <PrivacyCase key={selected} id={selected} staffId={staffId} transport={transport} onBack={() => {
      setSelected(null);
      requests.reload();
    }} />
  );

  return (
    <div className="space-y-4">
      <Card className="border-border shadow-none">
        <CardHeader><CardTitle>Record a privacy request</CardTitle></CardHeader>
        <CardContent><PrivacyIntake staff onSubmit={transport.create} onSaved={(item) => setSelected(item.id)} /></CardContent>
      </Card>
      <Card className="border-border shadow-none">
        <CardHeader><CardTitle>Privacy review queue</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form className="grid max-w-xl gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(event) => {
            event.preventDefault();
            setCustomerId(String(new FormData(event.currentTarget).get('customerId')).trim());
            setPage(1);
          }}>
            <WorkspaceField label="Filter by customer ID"><Input name="customerId" type="text" maxLength={36} /></WorkspaceField>
            <Button type="submit" variant="outline">Filter requests</Button>
          </form>
          <WorkspaceState {...requests}>
            {!requests.data?.items.length && <p className="text-sm text-muted-foreground">No privacy requests match these filters.</p>}
            {requests.data?.items.map((item) => <PrivacyRow key={item.id} item={item} onOpen={() => setSelected(item.id)} />)}
            <WorkspacePages page={page} hasMore={requests.data?.items.length === requests.data?.pageSize} onPage={setPage} />
          </WorkspaceState>
        </CardContent>
      </Card>
    </div>
  );
}

function PrivacyIntake({ onSubmit, onSaved, staff }) {
  const action = useWorkspaceAction();

  function submit(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    return action.run(() => onSubmit(fields), { onSuccess: onSaved, message: 'Privacy request recorded.' });
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-3">
      {staff && <WorkspaceField label="Customer ID"><Input name="customerId" required maxLength={36} /></WorkspaceField>}
      <WorkspaceField label="Request type">
        <NativeSelect name="kind" className="w-full">{Object.entries(kinds).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect>
      </WorkspaceField>
      <WorkspaceFeedback error={action.error} notice={action.notice} />
      <Button type="submit" disabled={action.busy}>{action.busy ? 'Recording…' : 'Submit privacy request'}</Button>
    </form>
  );
}

function PrivacyRow({ item, onOpen }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{kinds[item.kind]}</p>
        <p className="break-all text-xs text-muted-foreground">{item.id}</p>
      </div>
      <Badge variant="outline">{statusLabel(item.status)}</Badge>
      {item.held && <Badge variant="secondary">Hold active</Badge>}
      {onOpen && <Button type="button" size="sm" variant="outline" aria-label={`Open request ${item.id}`} onClick={onOpen}>Open request</Button>}
    </div>
  );
}

function PrivacyCase({ id, staffId, transport, onBack }) {
  const [page, setPage] = useState(1);
  const load = useCallback(() => transport.detail(id, { page }), [transport, id, page]);
  const details = useStaffResource(load);
  const item = details.data?.request;
  const resetAndReload = () => { setPage(1); details.reload(); };

  return (
    <div className="space-y-4">
      <Button type="button" variant="outline" onClick={onBack}>Back to privacy requests</Button>
      <WorkspaceState {...details}>
        {item && <Card className="border-border shadow-none">
          <CardHeader><CardTitle>Privacy case</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <PrivacyRow item={item} />
            <p className="break-all text-sm">Customer · {item.customerId}</p>
            <p className="break-all text-sm">Owner · {item.ownerStaffId || 'Unassigned'}</p>
            {item.status !== 'COMPLETED' && <PrivacyCaseActions key={item.version} item={item} staffId={staffId} transport={transport} reload={resetAndReload} />}
          </CardContent>
        </Card>}
        {item && <Card className="border-border shadow-none">
          <CardHeader><CardTitle>Case history</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {details.data.events.map((event) => (
              <article key={event.id} className="space-y-1 rounded-xl border p-3 text-sm">
                <p className="font-medium">{statusLabel(event.action)}</p>
                <p className="break-all text-xs text-muted-foreground">Version {event.version} · {event.actorStaffId || event.actorCustomerId} · {new Date(event.createdAt).toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}</p>
                {event.decisionReference && <p className="break-words">Decision · {event.decisionReference}</p>}
                {event.evidenceReference && <p className="break-words">Evidence · {event.evidenceReference}</p>}
                {event.rationale && <p className="whitespace-pre-wrap break-words">{event.rationale}</p>}
                {event.affectedRecords?.map((record) => <p key={record.type + record.id} className="break-all text-xs">{statusLabel(record.type)} · {record.id}</p>)}
              </article>
            ))}
            <WorkspacePages page={page} hasMore={details.data.events.length === details.data.pageSize} onPage={setPage} />
          </CardContent>
        </Card>}
      </WorkspaceState>
    </div>
  );
}

function PrivacyCaseActions({ item, staffId, transport, reload }) {
  const action = useWorkspaceAction();
  const [mode, setMode] = useState('');
  const [recordCount, setRecordCount] = useState(1);
  const transition = nextAction[item.status];
  function decide(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const body = { version: item.version, rationale: fields.rationale, evidenceReference: fields.evidenceReference };
    if (fields.decisionReference) body.decisionReference = fields.decisionReference;
    if (mode === 'DECIDED') {
      body.affectedRecords = Array.from({ length: recordCount }, (_, index) => ({ type: fields[`type-${index}`], id: fields[`id-${index}`] }));
    }
    return action.run(() => mode === 'HOLD' || mode === 'RELEASE'
      ? transport.hold(item.id, { ...body, held: mode === 'HOLD' })
      : transport.transition(item.id, { ...body, action: mode }), { onSuccess: reload });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {item.ownerStaffId !== staffId && <Button type="button" variant="outline" disabled={action.busy} onClick={() => action.run(() => transport.transition(item.id, { version: item.version, action: 'ASSIGNED', ownerStaffId: staffId }), { onSuccess: reload })}>Assign to me</Button>}
        {item.ownerStaffId && transition && !(transition === 'COMPLETED' && item.held) && <Button type="button" variant={mode === transition ? 'default' : 'outline'} onClick={() => setMode(transition)}>{actionLabels[transition]}</Button>}
        {item.identityVerifiedAt && item.ownerStaffId && <Button type="button" variant="outline" onClick={() => setMode(item.held ? 'RELEASE' : 'HOLD')}>{item.held ? 'Release retention hold' : 'Apply retention hold'}</Button>}
      </div>
      {mode && (
        <form key={mode} onSubmit={decide} className="max-w-2xl space-y-3 border-t pt-4">
          <p className="font-medium">{actionLabels[mode]}</p>
          {mode !== 'VERIFIED' && <WorkspaceField label="Decision reference"><Input name="decisionReference" required maxLength={200} /></WorkspaceField>}
          <WorkspaceField label="Evidence reference"><Input name="evidenceReference" required maxLength={200} /></WorkspaceField>
          <WorkspaceField label="Reason"><Textarea name="rationale" required maxLength={2000} rows={3} /></WorkspaceField>
          {mode === 'DECIDED' && (
            <fieldset className="space-y-3 rounded-xl border p-3">
              <legend className="px-1 text-sm font-medium">Affected records</legend>
              {Array.from({ length: recordCount }, (_, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-2">
                  <WorkspaceField label={`Record ${index + 1} type`}>
                    <NativeSelect name={`type-${index}`} className="w-full">{affectedTypes.map((type) => <NativeSelectOption key={type} value={type}>{statusLabel(type)}</NativeSelectOption>)}</NativeSelect>
                  </WorkspaceField>
                  <WorkspaceField label={`Record ${index + 1} reference`}><Input name={`id-${index}`} required maxLength={100} defaultValue={index === 0 ? item.customerId : ''} /></WorkspaceField>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={recordCount === 50} onClick={() => setRecordCount(recordCount + 1)}>Add record</Button>
                {recordCount > 1 && <Button type="button" variant="outline" size="sm" onClick={() => setRecordCount(recordCount - 1)}>Remove last record</Button>}
              </div>
            </fieldset>
          )}
          <Button type="submit" disabled={action.busy}>Save decision</Button>
        </form>
      )}
      <WorkspaceFeedback error={action.error} />
      {action.error && <Button type="button" size="sm" variant="outline" onClick={reload}>Reload case</Button>}
    </div>
  );
}
