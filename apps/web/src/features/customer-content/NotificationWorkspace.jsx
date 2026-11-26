import { statusLabel } from '@/features/compliance/statusLabel';
import { useCallback, useState } from 'react';
import { api } from '@/api';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { Textarea } from '@/components/ui/primitives/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import { useStaffResource } from '@/features/reviews/staff/useStaffResource';
import { WorkspaceFeedback, WorkspaceField, WorkspacePages, WorkspaceState } from '@/features/compliance/WorkspaceState';
import { useWorkspaceAction } from '@/features/compliance/useWorkspaceAction';

const PAGE_SIZE = 20;
const atMidnight = (day) => `${day}T00:00:00+02:00`;
const lusakaDate = new Intl.DateTimeFormat('en-ZM', { dateStyle: 'medium', timeZone: 'Africa/Lusaka' });

export default function NotificationWorkspace({ staffId, transport = api.notificationGovernance }) {
  return (
    <Tabs defaultValue="templates" activationMode="manual" className="gap-4">
      <TabsList aria-label="Notification management">
        <TabsTrigger value="templates">Templates</TabsTrigger>
        <TabsTrigger value="exceptions">Delivery exceptions</TabsTrigger>
      </TabsList>
      <TabsContent value="templates"><NotificationQueue loadPage={transport.list} transport={transport} staffId={staffId} /></TabsContent>
      <TabsContent value="exceptions"><NotificationQueue loadPage={transport.exceptions} exceptions /></TabsContent>
    </Tabs>
  );
}

function NotificationQueue({ loadPage, transport, staffId, exceptions }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const load = useCallback(() => loadPage({ limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }), [loadPage, page]);
  const queue = useStaffResource(load);
  return (
    <Card className="border-border shadow-none">
      <CardHeader><CardTitle>{exceptions ? 'Delivery exceptions' : 'Notification templates'}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <WorkspaceState {...queue}>
          {!queue.data?.items.length && <p className="text-sm text-muted-foreground">{exceptions ? 'No delivery exceptions to review.' : 'No notification templates available.'}</p>}
          {queue.data?.items.slice(0, PAGE_SIZE).map((row) => exceptions ? (
            <div key={row.id} className="space-y-1 rounded-xl border p-3 text-sm">
              <p className="font-medium">{statusLabel(row.event)} · Version {row.version}</p>
              <p>{statusLabel(row.reason)} · {statusLabel(row.retryState)}</p>
              <p className="text-xs text-muted-foreground">{row.owner} · {statusLabel(row.channel)} · {row.attempt} of {row.maxAttempts} attempts</p>
              {row.nextAttemptAt && <p className="text-xs text-muted-foreground">Next attempt {new Date(row.nextAttemptAt).toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}</p>}
            </div>
          ) : (
            <div key={row.id} className="space-y-3 rounded-xl border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{row.subject}</p>
                  <p className="text-xs text-muted-foreground">{statusLabel(row.key)} · {statusLabel(row.channel)} · Version {row.version}</p>
                </div>
                <Badge variant="outline">{statusLabel(row.reviewStatus)}</Badge>
                <Button type="button" variant="outline" size="sm" aria-expanded={selected === row.id} onClick={() => setSelected(selected === row.id ? null : row.id)}>
                  {selected === row.id ? 'Hide' : 'View template'}
                </Button>
              </div>
              {selected === row.id && <TemplateActions row={row} staffId={staffId} transport={transport} onSaved={queue.reload} />}
            </div>
          ))}
          <WorkspacePages page={page} hasMore={queue.data?.items.length > PAGE_SIZE} onPage={setPage} />
        </WorkspaceState>
      </CardContent>
    </Card>
  );
}

function TemplateActions({ row, staffId, transport, onSaved }) {
  const [editing, setEditing] = useState(false);
  const action = useWorkspaceAction();
  const canApprove = row.reviewStatus === 'DRAFT' && row.createdBy !== staffId;

  function create(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    return action.run(() => transport.create(row.id, {
      expectedVersion: row.version, subject: fields.subject, body: fields.body, owner: fields.owner,
      effectiveFrom: atMidnight(fields.from), expiresAt: atMidnight(fields.to),
    }), { onSuccess: onSaved });
  }

  function decide(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const mode = event.nativeEvent.submitter?.value === 'approve' ? 'approve' : 'withdraw';
    return action.run(() => transport[mode](row.id, { expectedVersion: row.version, reason: fields.get('reason') }), { onSuccess: onSaved });
  }

  return (
    <div className="space-y-4 border-t pt-3 text-sm">
      <p className="whitespace-pre-wrap break-words">{row.body}</p>
      <p className="break-words text-muted-foreground">{row.owner} · {statusLabel(row.category)} · {row.mandatory ? 'Required notification' : 'Follows preferences'}</p>
      <dl className="grid gap-2 text-muted-foreground sm:grid-cols-2">
        <div><dt>Effective from</dt><dd className="font-medium text-foreground">{row.effectiveFrom ? lusakaDate.format(new Date(row.effectiveFrom)) : 'Unscheduled'}</dd></div>
        <div><dt>Expires at the start of</dt><dd className="font-medium text-foreground">{row.expiresAt ? lusakaDate.format(new Date(row.expiresAt)) : 'No expiry'}</dd></div>
      </dl>
      {row.allowedPlaceholders?.length > 0 && <p className="text-muted-foreground">Allowed fields · {row.allowedPlaceholders.map((field) => `{{${field}}}`).join(', ')}</p>}
      <Button type="button" variant="outline" onClick={() => setEditing(!editing)}>{editing ? 'Cancel draft' : 'Draft new version'}</Button>
      {editing && (
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
          <WorkspaceField label="Owner"><Input name="owner" required maxLength={120} defaultValue={row.owner} /></WorkspaceField>
          <WorkspaceField label="Subject"><Input name="subject" required maxLength={200} defaultValue={row.subject} /></WorkspaceField>
          <WorkspaceField label="Effective at start of this Lusaka date"><Input name="from" type="date" required /></WorkspaceField>
          <WorkspaceField label="Expires at start of this Lusaka date"><Input name="to" type="date" required /></WorkspaceField>
          <div className="space-y-3 sm:col-span-full">
            <WorkspaceField label="Message"><Textarea name="body" required maxLength={5000} defaultValue={row.body} rows={4} /></WorkspaceField>
            <Button type="submit" disabled={action.busy}>Save draft</Button>
          </div>
        </form>
      )}
      {row.reviewStatus !== 'WITHDRAWN' && (
        <form onSubmit={decide} className="max-w-xl space-y-3">
          <WorkspaceField label="Decision reason"><Input name="reason" required maxLength={500} /></WorkspaceField>
          <div className="flex flex-wrap gap-2">
            {canApprove && <Button type="submit" value="approve" disabled={action.busy}>Approve template</Button>}
            <Button type="submit" value="withdraw" variant="outline" disabled={action.busy}>Withdraw template</Button>
          </div>
        </form>
      )}
      <WorkspaceFeedback error={action.error} />
    </div>
  );
}
