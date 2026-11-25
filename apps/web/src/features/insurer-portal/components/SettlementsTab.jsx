import { useEffect, useState } from 'react';
import { formatZMW } from '@/domain/premiumEngine';
import { downloadCsv } from '@/lib/downloadCsv';
import { Lines, Totals } from '@/features/admin/components/SettlementsPanel';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { PageHeader } from './ui';

const messageOf = (fallback) => (caught) => (caught?.code && caught?.message ? caught.message : fallback);

/** What InsurShield has paid this insurer, month by month, as finalised and never changed. */
export default function SettlementsTab({ api }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    api.settlements.listForInsurer()
      .then((rows) => { if (current) setList(rows); })
      .catch((caught) => { if (current) setError(messageOf('Settlements could not be loaded. Refresh to try again.')(caught)); });
    return () => { current = false; };
  }, [api]);

  const show = async (row) => {
    try {
      setOpen(await api.settlements.getForInsurer(row.id));
    } catch (caught) {
      setError(messageOf('This settlement could not be opened.')(caught));
    }
  };
  const download = async (settlement) => {
    try {
      downloadCsv(`${settlement.reference}-${settlement.period}.csv`, await api.settlements.exportCsv(settlement.id));
    } catch (caught) {
      setError(messageOf('The export could not be downloaded.')(caught));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settlements" description="What InsurShield pays you each month: premium for cover that stands, less refunds and commission, plus any agreed adjustment. Each one is final once approved." />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {list === null && !error && <p className="text-sm text-muted-foreground">Loading settlements…</p>}
      {list?.length === 0 && <p className="text-sm text-muted-foreground">No settlement has been finalised for you yet.</p>}
      <ul className="divide-y rounded-xl border">
        {list?.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span><strong>{row.period}</strong> · <span className="font-mono">{row.reference}</span></span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{formatZMW(row.netPayable)}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => show(row)}>Open</Button>
            </span>
          </li>
        ))}
      </ul>
      {open && (
        <Card>
          <CardHeader>
            <CardTitle><h2>{open.period}</h2></CardTitle>
            <CardDescription className="font-mono">{open.reference}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Totals settlement={open} />
            <Lines lines={open.lines || []} />
            <Button type="button" variant="outline" onClick={() => download(open)}>Download CSV</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
