import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCheck, Clock3, RefreshCw, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Button } from '@/components/ui/primitives/button';
import { Textarea } from '@/components/ui/primitives/textarea';
import { EmptyPanel, Fact, PageHeader, StatusBadge } from '@/features/insurer-portal/components/ui';

const OPERATIONAL_STATUSES = new Set(['PENDING', 'ACKNOWLEDGED', 'FAILED', 'MANUAL_FALLBACK']);

const display = (value) => String(value || 'Not recorded')
  .toLowerCase()
  .split('_')
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

const formatDateTime = (value) => {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString('en-ZM', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const toneFor = (status) => {
  if (status === 'FAILED') return 'declined';
  if (status === 'ACKNOWLEDGED' || status === 'MANUAL_FALLBACK') return 'settled';
  return 'open';
};

const safeRows = (value) => Array.isArray(value)
  ? value.filter((row) => row && typeof row === 'object' && OPERATIONAL_STATUSES.has(row.status))
  : [];

/**
 * Operations read model for delivery outcomes. It only renders server-projected
 * metadata; provider URLs, request bodies, callback bodies and credentials
 * are deliberately absent from both this component and its API contract.
 */
export default function IntegrationDeliveryPanel({ api, scope = 'admin', onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const action = scope === 'insurer' ? api.integrations?.listForInsurer : api.integrations?.list;
      if (typeof action !== 'function') throw new Error('Integration monitoring is not available in this session.');
      setRows(safeRows(await action()));
    } catch (loadError) {
      setRows([]);
      setError(loadError instanceof Error ? loadError.message : 'Integration delivery activity could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [api, scope]);

  useEffect(() => {
    const deferredLoad = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(deferredLoad);
  }, [load]);

  const summary = useMemo(() => ({
    pending: rows.filter((row) => row.status === 'PENDING').length,
    failed: rows.filter((row) => row.status === 'FAILED').length,
    completed: rows.filter((row) => ['ACKNOWLEDGED', 'MANUAL_FALLBACK'].includes(row.status)).length,
  }), [rows]);

  const recordFallback = async (event) => {
    event.preventDefault();
    const cleanedNote = note.trim();
    if (cleanedNote.length < 3 || !selectedId) return;
    setSaving(true);
    setError('');
    try {
      await api.integrations.manualFallback(selectedId, cleanedNote);
      setSelectedId(null);
      setNote('');
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The manual fallback could not be recorded.');
    } finally {
      setSaving(false);
    }
  };

  const isAdministrator = scope === 'admin';
  const title = isAdministrator ? 'Integration operations' : 'Integration activity';
  const description = isAdministrator
    ? 'Monitor delivery outcomes and document the authorised manual hand-off when a provider connection cannot complete.'
    : 'See delivery outcomes for your company. Your insurer portal remains the normal way to handle quotes and certificates.';

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} onBack={onBack} backLabel="Back to overview">
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : undefined} />Refresh
        </Button>
      </PageHeader>

      <section aria-label="Integration delivery summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <SummaryCard icon={Clock3} label="Pending delivery" value={summary.pending} detail="Waiting for an outcome" />
        <SummaryCard icon={AlertTriangle} label="Needs attention" value={summary.failed} detail="Failed deliveries" attention />
        <SummaryCard icon={CheckCheck} label="Completed" value={summary.completed} detail="Acknowledged or manual" />
      </section>

      <Card className="border-border shadow-none">
        <CardHeader className="border-b border-border">
          <CardTitle className="text-lg">Delivery records</CardTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This view contains operational metadata only. Provider endpoints, credentials and request or callback contents are never shown here.
          </p>
        </CardHeader>
        <CardContent className="pt-6">
          {error && <div role="alert" className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
          {loading && <p className="text-sm text-muted-foreground">Loading delivery activity…</p>}
          {!loading && rows.length === 0 && (
            <EmptyPanel
              icon={ShieldCheck}
              title="No delivery exceptions"
              description={isAdministrator
                ? 'Provider-connected activity appears here only after it is queued by an approved workflow.'
                : 'No direct server-to-server delivery is currently recorded for your company.'}
            />
          )}
          {!loading && rows.length > 0 && (
            <div className="space-y-4" aria-label="Integration delivery records">
              {rows.map((row) => {
                const isSelected = selectedId === row.id;
                return (
                  <Card key={row.id} size="sm" className="border-border bg-background shadow-none">
                    <CardHeader className="grid-cols-[1fr_auto] items-start gap-4 border-b border-border">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{display(row.kind)}</CardTitle>
                        <p className="mt-1 break-all text-xs text-muted-foreground">Reference {row.referenceId || 'Not recorded'}</p>
                      </div>
                      <StatusBadge status={display(row.status)} tone={toneFor(row.status)} />
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
                        <Fact label="Target" value={display(row.targetKind)} />
                        <Fact label="Attempts" value={`${row.attempt || 0} of ${row.maxAttempts || 0}`} />
                        <Fact label="Last activity" value={formatDateTime(row.lastAttemptAt || row.acknowledgedAt || row.resolvedAt || row.createdAt)} />
                        <Fact label="Correlation" value={row.correlationId || 'Not recorded'} />
                      </dl>
                      {row.error && <p className="rounded-lg border border-destructive/15 bg-destructive/5 px-3 py-2 text-sm text-destructive">{row.error}</p>}
                      {row.status === 'MANUAL_FALLBACK' && row.resolutionNote && (
                        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                          Manual hand-off: {row.resolutionNote}
                        </p>
                      )}
                      {isAdministrator && row.status === 'FAILED' && !isSelected && (
                        <Button type="button" variant="outline" onClick={() => { setSelectedId(row.id); setNote(''); }}>
                          Record manual fallback
                        </Button>
                      )}
                      {isAdministrator && row.status === 'FAILED' && isSelected && (
                        <form onSubmit={recordFallback} className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                          <label htmlFor={`manual-fallback-${row.id}`} className="text-sm font-medium">Manual completion note</label>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Record how this item was completed outside the direct connection. This is added to the audit trail.</p>
                          <Textarea id={`manual-fallback-${row.id}`} value={note} maxLength={1000} className="mt-3 bg-background" onChange={(event) => setNote(event.target.value)} placeholder="For example, completed through the insurer operations desk." />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button type="submit" disabled={saving || note.trim().length < 3}>{saving ? 'Saving…' : 'Confirm manual fallback'}</Button>
                            <Button type="button" variant="ghost" disabled={saving} onClick={() => { setSelectedId(null); setNote(''); }}>Cancel</Button>
                          </div>
                        </form>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail, attention = false }) {
  return (
    <Card size="sm" className="border-border shadow-none">
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className={attention ? 'rounded-lg bg-destructive/10 p-2 text-destructive' : 'rounded-lg bg-primary/10 p-2 text-primary'}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  );
}
