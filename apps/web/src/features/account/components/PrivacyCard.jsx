import { useState } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { downloadJson } from '@/lib/downloadJson';

/**
 * "Your data" in the account (NFR-PRI-001): a copy of everything InsurShield
 * holds, and plain words on what closing the account does and what is kept.
 */
export default function PrivacyCard({ api }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const download = async () => {
    setBusy(true);
    setError('');
    setDone(false);
    try {
      const data = await api.account.exportData();
      downloadJson(`insurshield-my-data-${new Date().toISOString().slice(0, 10)}.json`, data);
      setDone(true);
    } catch (caught) {
      setError(caught?.message || 'We could not prepare your data. Try again in a few minutes.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6 gap-3 border-border shadow-none">
      <CardHeader>
        <CardTitle><h2>Your data</h2></CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Download a copy of everything InsurShield holds about you: your details, requests, quotes, payments, policies,
          service requests, claims and messages, with links to your documents. We make it when you ask and do not keep a copy.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download my data'}</Button>
          {done && <span role="status" className="text-muted-foreground">Saved to your device. Document links in it work for a few minutes.</span>}
        </div>
        {error && <p role="alert" className="text-primary">{error}</p>}
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-muted-foreground">
          <p className="font-medium text-foreground">If you close your account</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>You can close it once no cover is in force and nothing is still in progress: a service request, a payment or a refund.</li>
            <li>Requests still waiting for quotes end, and unfinished drafts are deleted.</li>
            <li>Policies, payments and claims are kept for as long as the law requires. Seven years after closing, your name, phone and email are removed from them.</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
