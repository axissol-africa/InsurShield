import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { api } from '@/api';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { formatDate } from '@/domain/premiumEngine';
import { isOpen, statusLabel, typeLabel } from '@/domain/serviceRequests';
import { messageOf } from '../shared';

/** Everything the customer has asked their insurers after buying, newest first. */
export default function ServiceRequestsPage() {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    api.serviceRequests.listMine()
      .then((rows) => { if (current) setRequests(rows); })
      .catch((caught) => { if (current) setError(messageOf(caught, 'Your requests could not be loaded. Refresh to try again.')); });
    return () => { current = false; };
  }, []);

  return (
    <main className="min-h-full bg-muted/60">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/account?section=policies" className="inline-flex items-center gap-2 text-sm font-medium text-primary"><ArrowLeft className="size-4" aria-hidden="true" />My policies</Link>
        <header className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Service requests</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Ask your insurer to correct a detail, replace a document, cancel your cover or help with something else. Nothing changes on your policy until the insurer has done it.
            </p>
          </div>
          <Button asChild><Link to="/service-requests/new"><Plus aria-hidden="true" />New request</Link></Button>
        </header>

        {error && <p role="alert" className="mt-6 text-sm text-destructive">{error}</p>}
        {requests === null && !error && <p className="mt-6 text-sm text-muted-foreground">Loading your requests…</p>}
        {requests?.length === 0 && (
          <Card className="mt-6 border-dashed shadow-none">
            <CardContent className="py-10 text-center">
              <p className="font-medium text-foreground">You have not asked an insurer for anything yet</p>
              <p className="mt-2 text-sm text-muted-foreground">Open a policy in your account and choose “Request a change”.</p>
              <Button asChild variant="outline" className="mt-4"><Link to="/account?section=policies">Go to my policies</Link></Button>
            </CardContent>
          </Card>
        )}
        {requests?.length > 0 && (
          <ul className="mt-6 space-y-3">
            {requests.map((request) => (
              <li key={request.reference}>
                <Card className="gap-0 shadow-none">
                  <CardHeader className="grid-cols-[1fr_auto] items-start gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{typeLabel(request.type)}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">{request.insurer} · policy {request.policyNumber}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{request.reference} · sent {formatDate(request.createdAt)}</p>
                    </div>
                    <Badge variant={request.nextAction ? 'default' : isOpen(request.status) ? 'outline' : 'secondary'}>{statusLabel(request.status)}</Badge>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-3">
                    <p className="text-sm text-muted-foreground">
                      {request.nextAction === 'REPLY' ? 'The insurer has asked you something. Reply so they can carry on.' : `Last change ${formatDate(request.updatedAt)}`}
                    </p>
                    <Button asChild size="sm" variant={request.nextAction ? 'default' : 'ghost'}>
                      <Link to={`/service-requests/${encodeURIComponent(request.reference)}`}>{request.nextAction ? 'Reply' : 'Open'}<ArrowRight aria-hidden="true" /></Link>
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
