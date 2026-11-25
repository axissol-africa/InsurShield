import { useEffect, useId, useState } from 'react';
import { formatDate } from '@/domain/premiumEngine';
import { downloadCsv } from '@/lib/downloadCsv';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';

/** Lusaka is UTC+2 all year, so a calendar day there starts at 22:00 UTC the day before. */
const lusakaMidnight = (day) => new Date(`${day}T00:00:00+02:00`).toISOString();
const nextDay = (day) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * Compares the payment provider's statement with InsurShield's records.
 * Lines that agree are matched; anything else, and any payment the statement
 * leaves out, appears in the queue. The same file twice imports once.
 */
export default function StatementImport({ api, onImported }) {
  const id = useId();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState([]);
  const [pending, setPending] = useState(false);
  const [imports, setImports] = useState([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    api.admin.reconciliation.listStatements().then((rows) => { if (current) setImports(rows); }).catch(() => {});
    return () => { current = false; };
  }, [api, version]);

  const ready = from && to && to >= from && file;
  const period = () => ({ periodStart: lusakaMidnight(from), periodEnd: lusakaMidnight(nextDay(to)) });

  const submit = async (event) => {
    event.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    setErrors([]);
    setResult(null);
    try {
      const csv = await file.text();
      const imported = await api.admin.reconciliation.importStatement({ fileName: file.name, ...period(), csv });
      setResult(imported);
      setVersion((value) => value + 1);
      onImported?.();
    } catch (caught) {
      setErrors(caught?.details?.lines?.length ? caught.details.lines : [caught?.code && caught?.message ? caught.message : 'The statement could not be imported.']);
    } finally {
      setPending(false);
    }
  };

  const standIn = async () => {
    try {
      const { periodStart, periodEnd } = period();
      downloadCsv(`stand-in-statement-${from}-to-${to}.csv`, await api.admin.reconciliation.standInStatement(periodStart, periodEnd));
    } catch (caught) {
      setErrors([caught?.code && caught?.message ? caught.message : 'The stand-in statement is only available in development.']);
    }
  };

  return (
    <form onSubmit={submit} aria-label="Import a provider statement" className="space-y-3 rounded-xl border p-4">
      <h3 className="font-medium">Import a provider statement</h3>
      <p className="text-sm text-muted-foreground">A CSV with the columns type, provider_payment_id, provider_refund_id, amount, currency, occurred_at. Lines already imported from another file are skipped.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-from`} className="block text-xs font-medium">From *</label>
          <Input id={`${id}-from`} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-to`} className="block text-xs font-medium">To (inclusive) *</label>
          <Input id={`${id}-to`} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-file`} className="block text-xs font-medium">Statement file *</label>
          <Input id={`${id}-file`} type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!ready || pending} aria-busy={pending}>Import</Button>
        <Button type="button" variant="ghost" disabled={!from || !to} onClick={standIn}>Download the stand-in statement</Button>
      </div>
      {result && (
        <p role="status" className="text-sm">
          {result.replayed ? 'This file was imported before; nothing changed.' : `${result.newLines} new lines: ${result.matched} matched, ${result.itemsOpened} items opened for review.`}
        </p>
      )}
      {errors.length > 0 && (
        <div role="alert" className="text-sm text-destructive">
          <p>Nothing was imported.</p>
          <ul className="list-disc pl-5">{errors.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      {imports.length > 0 && (
        <details className="text-sm">
          <summary>Imported statements ({imports.length})</summary>
          <ul className="mt-2 space-y-1">
            {imports.map((row) => (
              <li key={row.id}>{row.fileName} · {formatDate(row.periodStart)} to {formatDate(new Date(new Date(row.periodEnd).getTime() - 1))} · {row.matched} matched, {row.itemsOpened} items · by {row.importedBy}</li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}
