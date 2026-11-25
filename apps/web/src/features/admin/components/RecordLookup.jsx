import { useState } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { formatDate } from '@/domain/premiumEngine';

const KIND = {
  SERVICE_REQUEST: 'Service request',
  POLICY: 'Policy',
  PAYMENT: 'Payment',
  QUOTE_REQUEST: 'Quote request',
  CLAIM: 'Claim',
  NCD_APPLICATION: 'NCD application',
  INSPECTION: 'Inspection',
};

/** "AWAITING_INSURER_CERTIFICATE" reads as "Awaiting insurer certificate". */
const readable = (status) => {
  const words = String(status ?? '').replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * A help-desk agent finds the record a customer quoted (US-ADM-012). The
 * reason is required and kept with the look-up in the audit trail.
 */
export default function RecordLookup({ api }) {
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!reference.trim()) return setError('Enter the reference the customer quoted.');
    if (reason.trim().length < 5) return setError('Say why you are looking, for example the support ticket number.');
    setPending(true);
    try {
      setFound(await api.support.findRecord(reference.trim(), reason.trim()));
    } catch (caught) {
      setFound(null);
      setError(caught?.message || 'The look-up failed. Try again.');
    } finally {
      setPending(false);
    }
    return undefined;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Find a record by reference</h2></CardTitle>
        <CardDescription>For a support case. Each look-up is kept in the audit trail with your name and the reason you give.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
          <div className="space-y-1">
            <label htmlFor="lookup-reference" className="text-sm font-medium">Reference</label>
            <Input id="lookup-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="POL-…, SR-…, TXN-…" />
          </div>
          <div className="space-y-1">
            <label htmlFor="lookup-reason" className="text-sm font-medium">Why you are looking</label>
            <Input id="lookup-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ticket 4411: customer asks about a refund" />
          </div>
          <Button type="submit" disabled={pending}>{pending ? 'Looking…' : 'Find'}</Button>
        </form>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {found?.length === 0 && <p className="text-sm text-muted-foreground">Nothing carries that reference. Check it with the customer.</p>}
        {found?.length > 0 && (
          <ul className="divide-y rounded-xl border text-sm">
            {found.map((record) => (
              <li key={`${record.type}-${record.reference}`} className="grid gap-1 p-3 sm:grid-cols-4">
                <span><span className="block text-muted-foreground">{KIND[record.type] ?? record.type}</span><span className="font-mono">{record.reference}</span></span>
                <span><span className="block text-muted-foreground">Status</span>{readable(record.status)}<span className="block text-xs text-muted-foreground">Created {formatDate(record.createdAt)}</span></span>
                <span><span className="block text-muted-foreground">Customer</span>{record.customer ? `${record.customer.fullName} · ${record.customer.phone}` : 'None'}</span>
                <span><span className="block text-muted-foreground">Insurer</span>{record.insurer ?? 'None'}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
