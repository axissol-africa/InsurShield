import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { statusLabel as serviceRequestStatus } from '@/domain/serviceRequests';

const KIND = {
  SERVICE_REQUEST: 'Service request',
  POLICY: 'Policy',
  PAYMENT: 'Payment',
  QUOTE_REQUEST: 'Quote request',
  CLAIM: 'Claim',
  NCD_APPLICATION: 'NCD application',
  INSPECTION: 'Inspection',
};
const STATUS = {
  ACTIVE: 'In force',
  AWAITING_INSURER_CERTIFICATE: 'Being issued',
  ISSUANCE_FAILED: 'Not issued, refund due',
  INITIATED: 'In progress',
  PENDING: 'Waiting for the provider',
  SUBMITTED: 'Sent',
  QUOTED: 'Quotes received',
  NOTIFIED: 'Notified',
  RECEIVED_BY_INSURER: 'With the insurer',
  UNDER_REVIEW: 'Under review',
  VERIFICATION_REQUIRED: 'Waiting for you',
};
const statusOf = (entry) => (entry.type === 'SERVICE_REQUEST' ? serviceRequestStatus(entry.status) : STATUS[entry.status] ?? entry.status);

/**
 * The InsurShield help desk, and the references a signed-in customer should
 * quote to it. The help desk itself is run outside InsurShield (decision 13).
 */
export default function HelpDeskCard({ signedIn }) {
  const [contact, setContact] = useState(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    if (!signedIn) return undefined;
    let current = true;
    import('@/api').then(({ api }) => api.support.contact())
      .then((loaded) => { if (current) setContact(loaded); })
      .catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [signedIn]);

  const copy = async (reference) => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(reference);
      setTimeout(() => setCopied((value) => (value === reference ? '' : value)), 2000);
    } catch {
      setCopied('');
    }
  };

  const desk = contact?.helpDesk;
  const hasDesk = desk && (desk.email || desk.phone);

  return (
    <Card className="mt-6 gap-0 border-border shadow-none">
      <CardHeader className="border-b">
        <CardTitle>Contact InsurShield support</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">For help with your account, a payment or a request that is stuck. For anything about the cover itself, ask your insurer.</p>
      </CardHeader>
      <CardContent className="grid gap-6 pt-5 lg:grid-cols-2">
        <div className="space-y-2 text-sm">
          {!signedIn && <p className="text-muted-foreground"><Link to="/create-account?next=%2Fsupport" className="font-medium text-primary underline">Sign in</Link> to see the help desk and the references to quote.</p>}
          {signedIn && !contact && !failed && <p className="text-muted-foreground">Loading…</p>}
          {failed && <p className="text-muted-foreground">The help desk details could not be loaded. Refresh to try again.</p>}
          {contact && !hasDesk && <p className="text-muted-foreground">The help desk contact details are not set up yet. Ask your insurer in the meantime.</p>}
          {hasDesk && (
            <dl className="space-y-2">
              {desk.email && <div><dt className="text-muted-foreground">Email</dt><dd><a href={`mailto:${desk.email}`} className="font-medium text-primary underline">{desk.email}</a></dd></div>}
              {desk.phone && <div><dt className="text-muted-foreground">Phone</dt><dd><a href={`tel:${desk.phone.replace(/\s+/g, '')}`} className="font-medium text-primary underline">{desk.phone}</a></dd></div>}
              {desk.hours && <div><dt className="text-muted-foreground">Hours</dt><dd className="text-foreground">{desk.hours}</dd></div>}
            </dl>
          )}
        </div>
        {contact && (
          <div>
            <p className="text-sm font-medium text-foreground">References to quote</p>
            {contact.references.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">You have nothing in progress right now.</p>
            ) : (
              <ul className="mt-2 divide-y rounded-xl border text-sm">
                {contact.references.map((entry) => (
                  <li key={`${entry.type}-${entry.reference}`} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-foreground">{entry.reference}</span>
                      <span className="block text-xs text-muted-foreground">{KIND[entry.type] ?? entry.type} · {statusOf(entry)}</span>
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => copy(entry.reference)} aria-label={`Copy ${entry.reference}`}>
                      {copied === entry.reference ? <><Check aria-hidden="true" />Copied</> : <><Copy aria-hidden="true" />Copy</>}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
