import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/api';
import { newIdempotencyKey } from '@/api/shared';
import { hydrateCustomer } from '@/api/sync';
import { useStore, belongsToCustomer } from '@/store';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { NativeSelect } from '@/components/ui/primitives/native-select';
import { Textarea } from '@/components/ui/primitives/textarea';
import { SERVICE_REQUEST_TYPES, canAskAbout, canCancel, lusakaToday } from '@/domain/serviceRequests';
import FilePicker from '../components/FilePicker';
import { filesProblem, messageOf } from '../shared';

const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : '');

/** Asking the insurer for something about a policy the customer holds. */
export default function NewServiceRequestPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { customer, policies } = useStore();
  useEffect(() => { void hydrateCustomer(); }, []);

  const eligible = useMemo(() => policies.filter(belongsToCustomer(customer)).filter(canAskAbout), [policies, customer]);
  const [policyNumber, setPolicyNumber] = useState(searchParams.get('policy') || '');
  const [type, setType] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const attempt = useRef(null);
  const pending = useRef(false);

  const policy = eligible.find((entry) => entry.policyNumber === policyNumber);
  const types = SERVICE_REQUEST_TYPES.filter((entry) => entry.id !== 'CANCELLATION' || canCancel(policy));
  const today = lusakaToday();
  const coverEnds = dayOf(policy?.policyDates?.endDate);

  const problem = () => {
    if (!policy) return 'Choose the policy this is about.';
    if (!type) return 'Choose what you need.';
    if (type === 'CANCELLATION') {
      if (!effectiveDate) return 'Choose the day you want the cover to end.';
      if (effectiveDate < today) return 'Choose today or a later day for the cover to end.';
      if (coverEnds && effectiveDate > coverEnds) return 'Choose a day on or before the day your cover ends anyway.';
    }
    if (reason.trim().length < 10) return 'Tell the insurer what you need in at least 10 characters.';
    return filesProblem(files);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (pending.current) return;
    const found = problem();
    setError(found || '');
    if (found) return;
    const request = {
      policyNumber,
      type,
      reason: reason.trim(),
      ...(type === 'CANCELLATION' ? { requestedEffectiveDate: effectiveDate } : {}),
    };
    const fingerprint = JSON.stringify(request);
    if (attempt.current?.fingerprint !== fingerprint || attempt.current?.files !== files) {
      attempt.current = { fingerprint, files, key: newIdempotencyKey(), uploaded: new WeakMap() };
    }
    pending.current = true;
    setSending(true);
    try {
      const created = await api.serviceRequests.submit({ ...request, files }, attempt.current);
      navigate(`/service-requests/${encodeURIComponent(created.reference)}`, { replace: true });
    } catch (caught) {
      setError(messageOf(caught, 'Your request could not be sent. Try again.'));
      setSending(false);
    } finally {
      pending.current = false;
    }
  };

  return (
    <main className="min-h-full bg-muted/60">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/service-requests" className="inline-flex items-center gap-2 text-sm font-medium text-primary"><ArrowLeft className="size-4" aria-hidden="true" />Service requests</Link>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">Ask your insurer</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We send your request to the insurer and tell you when they reply. Nothing changes on your policy until they have done it.
        </p>

        {eligible.length === 0 ? (
          <Card className="mt-6 border-dashed shadow-none">
            <CardContent className="py-10 text-center">
              <p className="font-medium text-foreground">You have no policy to ask about</p>
              <p className="mt-2 text-sm text-muted-foreground">Requests are for cover that is in force or still being issued.</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="mt-6 shadow-none">
            <CardContent>
              <form onSubmit={submit} noValidate className="space-y-6">
                <div className="space-y-2">
                  <label htmlFor="sr-policy" className="text-sm font-medium text-foreground">Policy</label>
                  <NativeSelect id="sr-policy" className="w-full" value={policyNumber} onChange={(event) => { setPolicyNumber(event.target.value); setType(''); }}>
                    <option value="">Choose a policy</option>
                    {eligible.map((entry) => (
                      <option key={entry.policyNumber} value={entry.policyNumber}>{entry.policyNumber} · {entry.insurer} · {entry.vehicle}</option>
                    ))}
                  </NativeSelect>
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-foreground">What do you need?</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {types.map((entry) => (
                      <label key={entry.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${type === entry.id ? 'border-primary bg-primary/5' : 'bg-card'}`}>
                        <input type="radio" name="sr-type" value={entry.id} checked={type === entry.id} onChange={() => setType(entry.id)} className="mt-1" />
                        <span>
                          <span className="block font-medium text-foreground">{entry.label}</span>
                          <span className="mt-1 block text-muted-foreground">{entry.detail}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {policy && !canCancel(policy) && (
                    <p className="text-xs text-muted-foreground">This policy is still being issued, so it cannot be cancelled yet. Ask for help instead.</p>
                  )}
                </fieldset>

                {type === 'CANCELLATION' && (
                  <div className="space-y-2">
                    <label htmlFor="sr-date" className="text-sm font-medium text-foreground">The day you want the cover to end</label>
                    <Input id="sr-date" type="date" min={today} max={coverEnds || undefined} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} />
                    <p className="text-xs text-muted-foreground">The insurer confirms the date and works out any refund. A refund is paid by InsurShield once two of our administrators approve it.</p>
                  </div>
                )}

                <div className="space-y-2">
                  <label htmlFor="sr-reason" className="text-sm font-medium text-foreground">Tell the insurer what you need</label>
                  <Textarea id="sr-reason" rows={5} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: my phone number on the policy is wrong, it should be 0977 000 111." />
                </div>

                <FilePicker files={files} onChange={setFiles} hint="Optional. Up to 5 PDF, JPG or PNG files, 3 MB each, such as a sale agreement or a photo." />

                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" disabled={sending}>{sending ? 'Sending…' : 'Send to the insurer'}</Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
