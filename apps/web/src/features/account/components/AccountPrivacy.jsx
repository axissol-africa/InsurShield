import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { requestIdentityTransition } from '@/app/identity';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';

export default function AccountPrivacy({ onClose, accountError, canClose = true }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [complete, setComplete] = useState(false);
  const pending = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const download = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(null); setComplete(false);
    try {
      const data = await api.account.export();
      if (!active.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'insurshield-my-data.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setComplete(true);
    } catch (caught) { setError(caught); }
    finally { pending.current = false; setBusy(false); }
  };
  const signInAgain = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      await api.auth.signOut();
      requestIdentityTransition({ landing: '/create-account?next=%2Faccount%3Fsection%3Dprivacy', userId: null, announce: true });
    } catch (caught) { setError(caught); }
    finally { pending.current = false; setBusy(false); }
  };
  return <section aria-label="Privacy" className="mt-6 space-y-4">
    <Card><CardHeader><CardTitle>Download my data</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
      <p>Download a JSON copy of your profile, consent and contact preferences, vehicles, quote requests, payments, policies, service requests, claims, NCD applications, inspections, notifications and document links.</p>
      <p className="text-muted-foreground">You must have signed in within the last 10 minutes. InsurShield generates this export on request and does not store a copy. Keep your download private. Document links require a signed-in account and the document must still be available.</p>
      <Button disabled={busy} onClick={download}>{busy ? 'Preparing…' : 'Download my data'}</Button>
      {complete && <p role="status">Your data download is ready.</p>}
      {error && <p role="alert">{error.message || 'Your data could not be downloaded. Please try again.'}</p>}
      {error?.code === 'REAUTHENTICATION_REQUIRED' && <Button variant="outline" disabled={busy} onClick={signInAgain}>Sign out and sign in again</Button>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Close your account</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
      <p>Closing your account signs you out and removes access to your documents. Drafts and open quote requests are withdrawn. Records needed for regulatory retention are kept; closing an account does not immediately erase them.</p>
      <p>Closure is blocked while cover is in force, a service request is open, a payment is in progress, or a refund is in progress. The server checks these conditions when you request closure and explains any blocker.</p>
      {canClose && <Button variant="outline" onClick={onClose}>Close account</Button>}
      {!canClose && <p>The shared demo account cannot be closed.</p>}
      {accountError && <p role="alert">{accountError}</p>}
    </CardContent></Card>
  </section>;
}
