import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { useStore } from '@/store';
import { getIdentityBinding } from '@/app/identity';
import { Button } from '@/components/ui/primitives/button';
import { NativeSelect } from '@/components/ui/primitives/native-select';

const identity = () => getIdentityBinding() || JSON.stringify([useStore.getState().customer?.email, useStore.getState().staffSession]);

export default function ClaimInspection({ claimNumber, status, inspection, staff = false }) {
  const [method, setMethod] = useState('PHYSICAL');
  const [created, setCreated] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest = created || inspection;
  const request = async () => {
    if (busy.current) return;
    const owner = identity();
    const current = () => mounted.current && !useStore.getState().leaving && owner === identity();
    busy.current = true; setPending(true); setError('');
    try {
      const result = await api.claims.requestInspection(claimNumber, method);
      if (!current()) return;
      setCreated(result);
    } catch (failure) {
      if (current()) setError(failure.message || 'The inspection could not be requested. Please try again.');
    } finally { busy.current = false; if (current()) setPending(false); }
  };
  const destination = staff ? `/insurer?view=inspections${latest ? `#inspection-${encodeURIComponent(latest.id)}` : ''}` : `/inspections?claim=${encodeURIComponent(claimNumber)}${latest ? `&inspection=${encodeURIComponent(latest.id)}` : ''}`;
  return <section aria-label="Claim inspection" className="space-y-3 rounded-xl border border-border p-4 text-sm">
    <h3 className="font-semibold">Claim inspection</h3>
    <p>Inspection evidence and reports are kept with the inspection linked to claim {claimNumber}.</p>
    {latest && <p role="status">Inspection {latest.id}: {latest.statusLabel || latest.status}. Open Inspections to see the next step, evidence and report.</p>}
    <a className="underline" href={destination}>Find this claim’s inspections</a>
    {staff && !latest && !['Closed', 'Declined', 'Approved'].includes(status) && <div className="space-y-2">
      <label className="block">Assessment method<NativeSelect value={method} disabled={pending} onChange={(event) => setMethod(event.target.value)} className="mt-1 w-full"><option value="PHYSICAL">Physical inspection</option><option value="SELF_CAPTURE">Customer photos</option></NativeSelect></label>
      <Button disabled={pending} onClick={request}>{pending ? 'Requesting…' : 'Request claim inspection'}</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
