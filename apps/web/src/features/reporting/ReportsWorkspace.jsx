import { useId, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from '@/api';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { Label } from '@/components/ui/primitives/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import { downloadCsv } from '@/lib/downloadCsv';
import { WorkspaceFeedback } from '@/features/compliance/WorkspaceState';
import { useWorkspaceAction } from '@/features/compliance/useWorkspaceAction';

const scopeLabels = {
  admin: 'Platform operations',
  operations: 'Insurer operations',
  finance: 'Insurer finance',
};

function defaultPeriod(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lusaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return { from: day.slice(0, 7) + '-01', to: day };
}

export default function ReportsWorkspace({ scopes, transport = api.reports }) {
  if (scopes.length === 1) return <ReportPeriod scope={scopes[0]} transport={transport} />;
  return (
    <Tabs defaultValue={scopes[0]} activationMode="manual" className="gap-4">
      <TabsList aria-label="Report type">
        {scopes.map((scope) => <TabsTrigger key={scope} value={scope}>{scopeLabels[scope]}</TabsTrigger>)}
      </TabsList>
      {scopes.map((scope) => <TabsContent key={scope} value={scope}><ReportPeriod scope={scope} transport={transport} /></TabsContent>)}
    </Tabs>
  );
}

function ReportPeriod({ scope, transport }) {
  const id = useId();
  const [period, setPeriod] = useState(defaultPeriod);
  const [result, setResult] = useState(null);
  const generate = useWorkspaceAction();
  const download = useWorkspaceAction();
  const periodChanged = Boolean(result && (result.filters.from !== period.from || result.filters.to !== period.to));

  function generateReport(event) {
    event.preventDefault();
    const filters = { ...period };
    return generate.run(() => transport.get(scope, filters), {
      onSuccess: (report) => setResult({ report, filters }),
    });
  }

  function exportReport() {
    const { filters } = result;
    return download.run(async () => {
      const csv = await transport.exportCsv(scope, filters);
      downloadCsv(`insurshield-${scope}-${filters.from}-to-${filters.to}.csv`, csv);
    }, { message: 'Your CSV is ready.' });
  }

  return (
    <section aria-label={scopeLabels[scope]} className="space-y-4">
      <Card className="border-border shadow-none">
        <CardHeader>
          <CardTitle>{scopeLabels[scope]}</CardTitle>
          <p className="text-sm text-muted-foreground">Choose an inclusive period. Reports use Lusaka dates.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={generateReport} className="grid max-w-2xl gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-from`}>From</Label>
              <Input id={`${id}-from`} type="date" required max={period.to} value={period.from} onChange={(event) => setPeriod({ ...period, from: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-to`}>To</Label>
              <Input id={`${id}-to`} type="date" required min={period.from} value={period.to} onChange={(event) => setPeriod({ ...period, to: event.target.value })} />
            </div>
            <Button type="submit" disabled={generate.busy}>{generate.busy ? 'Generating…' : 'Generate report'}</Button>
            <div className="sm:col-span-full"><WorkspaceFeedback error={generate.error} /></div>
          </form>
        </CardContent>
      </Card>
      {result && (
        <Card className="border-border shadow-none">
          <CardHeader className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle>{result.report.title ?? scopeLabels[scope]}</CardTitle>
              <p className="text-sm text-muted-foreground">{result.filters.from} to {result.filters.to}</p>
              {result.report.generatedAt && <p className="text-xs text-muted-foreground">Generated {new Date(result.report.generatedAt).toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}</p>}
            </div>
            <Button type="button" variant="outline" onClick={exportReport} disabled={download.busy || generate.busy || periodChanged}>
              <Download aria-hidden="true" />{download.busy ? 'Preparing CSV…' : 'Download CSV'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {periodChanged && <p className="text-sm text-muted-foreground">Generate the report for the new dates before downloading.</p>}
            <WorkspaceFeedback error={download.error} notice={download.notice} />
            <p className="text-sm text-muted-foreground">{scope === 'admin' ? 'Platform-wide aggregates' : 'Your organisation only'}</p>
            {result.report.owner && <p className="text-xs text-muted-foreground">Report owner · {result.report.owner.organization === 'InsurShield' ? 'InsurShield' : 'Your insurer'}</p>}
            {result.report.dataAsOf && result.report.dataAsOf !== result.report.generatedAt && <p className="text-xs text-muted-foreground">Data as of {new Date(result.report.dataAsOf).toLocaleString('en-ZM', { timeZone: 'Africa/Lusaka' })}</p>}
            {result.report.limitations?.map((limitation) => <p key={limitation} className="text-sm text-muted-foreground">{limitation}</p>)}
            <ReportMetrics report={result.report} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function displayMetric(metric) {
  if (metric.value == null) return 'Unavailable';
  const value = BigInt(metric.value);
  if (metric.unit !== 'minorUnits') return value.toLocaleString('en-ZM');
  const absolute = value < 0n ? -value : value;
  const fractional = String(absolute % 100n).padStart(2, '0');
  return `${value < 0n ? '−' : ''}${metric.currency} ${(absolute / 100n).toLocaleString('en-ZM')}.${fractional}`;
}

function ReportMetrics({ report }) {
  if (report.metrics.length === 0) return <p className="text-sm text-muted-foreground">No activity was recorded for this period.</p>;
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {report.metrics.map((metric) => (
        <div key={metric.key} className="min-w-0 space-y-1 rounded-xl border border-border p-4">
          <dt className="text-sm font-medium">{metric.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{displayMetric(metric)}</dd>
          <dd className="text-xs leading-relaxed text-muted-foreground">{metric.definition}</dd>
        </div>
      ))}
    </dl>
  );
}
