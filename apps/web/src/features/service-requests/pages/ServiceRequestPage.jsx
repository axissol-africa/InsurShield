import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/api';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Textarea } from '@/components/ui/primitives/textarea';
import { formatDate, formatZMW } from '@/domain/premiumEngine';
import { isOpen, statusLabel, typeLabel } from '@/domain/serviceRequests';
import FilePicker from '../components/FilePicker';
import Timeline from '../components/Timeline';
import { filesProblem, messageOf } from '../shared';

/** One request: where it stands, what the insurer decided, and what has been said. */
export default function ServiceRequestPage() {
  const { reference } = useParams();
  return <ServiceRequestDetail key={reference} reference={reference} />;
}

function ServiceRequestDetail({ reference }) {
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let current = true;
    api.serviceRequests.get(reference)
      .then((loaded) => { if (current) setRequest(loaded); })
      .catch((caught) => { if (current) setError(messageOf(caught, 'This request could not be loaded.')); });
    return () => { current = false; };
  }, [reference]);

  const run = async (work, fallback) => {
    setBusy(true);
    setError('');
    try {
      setRequest(await work());
      return true;
    } catch (caught) {
      setError(messageOf(caught, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reply = async (event) => {
    event.preventDefault();
    if (answer.trim().length < 2) return setError('Write your answer.');
    const problem = filesProblem(files);
    if (problem) return setError(problem);
    if (await run(() => api.serviceRequests.reply(reference, { message: answer.trim(), files }), 'Your answer could not be sent. Try again.')) {
      setAnswer('');
      setFiles([]);
    }
    return undefined;
  };
  const cancelConfirm = useCallback(() => setConfirming(false), []);
  const withdraw = async () => {
    setConfirming(false);
    await run(() => api.serviceRequests.withdraw(reference), 'The request could not be withdrawn. Try again.');
  };

  return (
    <main className="min-h-full bg-muted/60">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/service-requests" className="inline-flex items-center gap-2 text-sm font-medium text-primary"><ArrowLeft className="size-4" aria-hidden="true" />Service requests</Link>
        {error && <p role="alert" className="mt-6 text-sm text-destructive">{error}</p>}
        {!request && !error && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
        {request && (
          <>
            <header className="mt-6 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">{typeLabel(request.type)}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{request.insurer} · policy {request.policyNumber}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{request.reference} · sent {formatDate(request.createdAt)}</p>
              </div>
              <Badge variant={request.nextAction ? 'default' : 'outline'} className="text-sm">{statusLabel(request.status)}</Badge>
            </header>

            {request.requestedEffectiveDate && (
              <p className="mt-4 text-sm text-muted-foreground">You asked for the cover to end on <strong className="text-foreground">{formatDate(request.requestedEffectiveDate)}</strong>.</p>
            )}
            {request.decision && <Decision decision={request.decision} />}

            {request.nextAction === 'REPLY' && (
              <Card className="mt-6 border-primary/40 shadow-none">
                <CardHeader><CardTitle className="text-base">The insurer needs more from you</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={reply} className="space-y-4" noValidate>
                    <label htmlFor="sr-answer" className="sr-only">Your answer</label>
                    <Textarea id="sr-answer" rows={4} maxLength={2000} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Answer the insurer's question." />
                    <FilePicker files={files} onChange={setFiles} hint="Optional. Up to 5 PDF, JPG or PNG files." />
                    <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send answer'}</Button>
                  </form>
                </CardContent>
              </Card>
            )}

            <section className="mt-8">
              <h2 className="mb-3 text-lg font-semibold text-foreground">What has happened</h2>
              <Timeline updates={request.updates} insurer={request.insurer} />
            </section>

            {isOpen(request.status) && (
              <div className="mt-8 border-t pt-6">
                <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(true)}>Withdraw this request</Button>
                <p className="mt-2 text-xs text-muted-foreground">Withdraw it if you no longer need it. The insurer stops working on it, and your policy stays as it is.</p>
              </div>
            )}
            <ConfirmDialog
              open={confirming}
              title="Withdraw this request?"
              description="The insurer stops working on it. To ask again later you will need a new request."
              confirmLabel="Withdraw"
              destructive
              onConfirm={withdraw}
              onCancel={cancelConfirm}
            />
          </>
        )}
      </div>
    </main>
  );
}

function Decision({ decision }) {
  const approved = decision.outcome === 'APPROVED';
  return (
    <Card className={`mt-6 shadow-none ${approved ? 'border-primary/30' : 'border-destructive/30'}`}>
      <CardContent className="space-y-2 py-4 text-sm">
        <p className="font-medium text-foreground">{approved ? 'The insurer approved this' : 'The insurer declined this'} on {formatDate(decision.decidedAt)}</p>
        {decision.note && <p className="text-muted-foreground">{decision.note}</p>}
        {decision.effectiveDate && <p>Cover ends on <strong>{formatDate(decision.effectiveDate)}</strong>.</p>}
        {decision.refundAmount !== null && decision.refundAmount !== undefined && (
          <p>
            {decision.refundAmount > 0
              ? <>Refund due: <strong>{formatZMW(decision.refundAmount)}</strong>. InsurShield pays it once the cancellation is done and two of our administrators have approved it.</>
              : 'No refund is due.'}
          </p>
        )}
        {!approved && <p className="text-muted-foreground">If you want to talk it through, contact InsurShield support and quote the reference above.</p>}
      </CardContent>
    </Card>
  );
}
