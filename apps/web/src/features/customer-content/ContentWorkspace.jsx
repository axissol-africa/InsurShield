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
import { WorkspaceFeedback, WorkspaceField, WorkspacePages, WorkspaceState } from '@/features/compliance/WorkspaceState';
import { useWorkspaceAction } from '@/features/compliance/useWorkspaceAction';

const TYPES = { FAQ: 'FAQ', NOTICE: 'Notice', LEGAL: 'Legal information' };

export default function ContentWorkspace({ staffId, transport = api.customerContent }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const load = useCallback(() => transport.list(page), [transport, page]);
  const list = useStaffResource(load);

  if (selected) return (
    <ContentHistory key={selected} slug={selected} transport={transport} staffId={staffId} onBack={() => {
      setSelected(null);
      list.reload();
    }} />
  );

  return (
    <div className="space-y-4">
      <DraftContent transport={transport} onSaved={(row) => setSelected(row.slug)} />
      <Card className="border-border shadow-none">
        <CardHeader><CardTitle>Support content</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <WorkspaceState {...list}>
            {!list.data?.items.length && <p className="text-sm text-muted-foreground">No managed content yet.</p>}
            {list.data?.items.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">{row.title}</p>
                  <p className="break-all text-xs text-muted-foreground">{TYPES[row.type]} · {row.slug} · Version {row.version}</p>
                </div>
                <Badge variant="outline">{statusLabel(row.status)}</Badge>
                <Button type="button" variant="outline" size="sm" onClick={() => setSelected(row.slug)}>View versions<span className="sr-only"> of {row.title}</span></Button>
              </div>
            ))}
            <WorkspacePages page={page} hasMore={list.data?.hasMore} onPage={setPage} />
          </WorkspaceState>
        </CardContent>
      </Card>
    </div>
  );
}

function ContentHistory({ slug, staffId, transport, onBack }) {
  const load = useCallback(() => transport.history(slug), [transport, slug]);
  const history = useStaffResource(load);
  const latest = history.data?.items[0];

  return (
    <div className="space-y-4">
      <Button type="button" variant="outline" onClick={onBack}>Back to support content</Button>
      <WorkspaceState {...history}>
        {latest && <DraftContent key={latest.id} transport={transport} source={latest} onSaved={history.reload} />}
        {history.data?.items.map((item) => (
          <ContentVersion key={item.id} item={item} isLatest={item.id === latest?.id} staffId={staffId} transport={transport} onSaved={history.reload} />
        ))}
      </WorkspaceState>
    </div>
  );
}

function DraftContent({ transport, source, onSaved }) {
  const action = useWorkspaceAction();
  function submit(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const slug = source?.slug ?? fields.slug;
    return action.run(() => transport.create(slug, {
      type: source?.type ?? fields.type,
      title: fields.title,
      body: fields.body,
      effectiveFrom: fields.effectiveFrom,
      ...(fields.expiresOn ? { expiresOn: fields.expiresOn } : {}),
      expectedVersion: source?.version ?? 0,
    }), { onSuccess: onSaved });
  }

  return (
    <Card className="border-border shadow-none">
      <CardHeader><CardTitle>{source ? 'Draft a new version' : 'Draft support content'}</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {!source && <>
            <WorkspaceField label="Content key"><Input name="slug" required maxLength={100} pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*" placeholder="policy-downloads" /></WorkspaceField>
            <WorkspaceField label="Content type"><NativeSelect name="type" className="w-full">{Object.entries(TYPES).map(([type, label]) => <NativeSelectOption key={type} value={type}>{label}</NativeSelectOption>)}</NativeSelect></WorkspaceField>
          </>}
          <WorkspaceField label="Effective date"><Input name="effectiveFrom" type="date" required defaultValue={source?.effectiveFrom} /></WorkspaceField>
          <WorkspaceField label="Last day shown (optional)"><Input name="expiresOn" type="date" /></WorkspaceField>
          <div className="sm:col-span-full space-y-4">
            <WorkspaceField label="Title"><Input name="title" required maxLength={200} defaultValue={source?.title} /></WorkspaceField>
            <WorkspaceField label="Customer text"><Textarea name="body" required maxLength={20000} defaultValue={source?.body} rows={4} /></WorkspaceField>
            <WorkspaceFeedback error={action.error} />
            <Button type="submit" disabled={action.busy}>{action.busy ? 'Saving draft…' : 'Save draft'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ContentVersion({ item, isLatest, staffId, transport, onSaved }) {
  const action = useWorkspaceAction();
  const canApprove = isLatest && item.status === 'DRAFT' && staffId !== item.ownerStaffId;
  const canWithdraw = item.status !== 'WITHDRAWN';
  function withdraw(event) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    return action.run(() => transport.withdraw(item.slug, item.id, { reason }), { onSuccess: onSaved });
  }

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-wrap justify-between gap-2">
        <CardTitle>{item.title} · Version {item.version}</CardTitle>
        <Badge variant="outline">{statusLabel(item.status)}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="whitespace-pre-wrap break-words">{item.body}</p>
        <p className="text-xs text-muted-foreground">Effective {item.effectiveFrom}{item.expiresOn && ` through ${item.expiresOn}`} · Customer support</p>
        {item.withdrawalReason && <p className="break-words">Withdrawal reason · {item.withdrawalReason}</p>}
        {canApprove && <Button type="button" disabled={action.busy} onClick={() => action.run(() => transport.approve(item.slug, item.id), { onSuccess: onSaved })}>Approve version</Button>}
        {isLatest && item.status === 'DRAFT' && !canApprove && <p className="text-muted-foreground">A second administrator can approve this draft.</p>}
        {canWithdraw && (
          <form onSubmit={withdraw} className="grid max-w-xl gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <WorkspaceField label="Withdrawal reason"><Input name="reason" required maxLength={2000} /></WorkspaceField>
            <Button type="submit" variant="outline" disabled={action.busy}>Withdraw version</Button>
          </form>
        )}
        <WorkspaceFeedback error={action.error} />
      </CardContent>
    </Card>
  );
}
