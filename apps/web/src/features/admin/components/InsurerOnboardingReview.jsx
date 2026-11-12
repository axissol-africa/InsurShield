import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FileText, PlugZap, ShieldCheck, Upload } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Badge } from '@/components/ui/primitives/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Input } from '@/components/ui/primitives/input';
import { Textarea } from '@/components/ui/primitives/textarea';

const EVIDENCE_KINDS = [
  ['LICENCE', 'PIA licence'],
  ['TAX_CLEARANCE', 'Tax clearance'],
  ['INCORPORATION', 'Certificate of incorporation'],
  ['AGREEMENT', 'Platform agreement'],
  ['OTHER', 'Supporting document'],
];

const STATE_STYLE = {
  Pending: 'border-primary/20 bg-primary/10 text-primary',
  'Pending approval': 'border-primary/20 bg-primary/10 text-primary',
  Active: 'border-primary/20 bg-primary/10 text-primary',
  Suspended: 'border-primary/30 bg-primary/5 text-primary',
  Inactive: 'border-border bg-muted text-muted-foreground',
  Deleted: 'border-border bg-muted text-muted-foreground',
  PENDING: 'border-primary/20 bg-primary/10 text-primary',
  APPROVED: 'border-primary/20 bg-primary/10 text-primary',
  REJECTED: 'border-primary/30 bg-primary/5 text-primary',
};

const asLabel = (value) => String(value || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The administrative evidence record that moves an insurer from a saved
 * profile to a verified trading partner. The server still makes every
 * approval decision; this component only presents that sequence clearly.
 */
export default function InsurerOnboardingReview({ insurers, api, onBack, onChanged, initialInsurerId = null }) {
  const candidates = useMemo(() => insurers.filter((insurer) => insurer.status !== 'Deleted'), [insurers]);
  const [insurerId, setInsurerId] = useState(initialInsurerId || candidates[0]?.id || '');
  const [evidence, setEvidence] = useState([]);
  const [integration, setIntegration] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const [showIntegration, setShowIntegration] = useState(false);
  const [showActivation, setShowActivation] = useState(false);
  const [showSuspension, setShowSuspension] = useState(false);

  // Keep the chosen insurer derived from the current data. A record may be
  // removed or restored while the review screen is open, and deriving here
  // avoids a second render merely to repair stale local selection state.
  const selectedInsurerId = candidates.some((entry) => entry.id === insurerId)
    ? insurerId
    : (candidates.some((entry) => entry.id === initialInsurerId) ? initialInsurerId : candidates[0]?.id || '');
  const insurer = candidates.find((entry) => entry.id === selectedInsurerId) || null;
  const reload = useCallback(async (selectedId) => {
    if (!selectedId) return;
    setLoading(true);
    setError('');
    try {
      const [pieces, model] = await Promise.all([api.insurers.evidence(selectedId), api.insurers.integration(selectedId)]);
      setEvidence(pieces || []);
      setIntegration(model || null);
    } catch (caught) {
      setEvidence([]);
      setIntegration(null);
      setError(caught instanceof Error ? caught.message : 'The insurer review record could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    // Defer the fetch so React can paint the selected insurer before the
    // loading state arrives. It also keeps the effect as an external sync,
    // rather than a synchronous state update during render reconciliation.
    const timer = window.setTimeout(() => { void reload(selectedInsurerId); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload, selectedInsurerId]);

  const uploadEvidence = async (event) => {
    event.preventDefault();
    if (!insurer) return;
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) {
      setError('Choose a PDF, JPG, or PNG file before recording evidence.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const document = await api.documents.upload(file, 'INSURER_EVIDENCE');
      await api.insurers.captureEvidence(insurer.id, {
        kind: form.get('kind'),
        documentId: document.id,
        reference: String(form.get('reference') || '').trim() || undefined,
        expiresAt: String(form.get('expiresAt') || '') || undefined,
      });
      event.currentTarget.reset();
      await reload(selectedInsurerId);
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The evidence could not be recorded.');
    } finally {
      setUploading(false);
    }
  };

  const reviewEvidence = async (event) => {
    event.preventDefault();
    if (!insurer || !reviewing) return;
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      await api.insurers.reviewEvidence(insurer.id, reviewing.id, {
        state: form.get('state'),
        note: String(form.get('note') || '').trim() || undefined,
      });
      setReviewing(null);
      await reload(selectedInsurerId);
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The evidence review could not be saved.');
    }
  };

  const saveIntegration = async (event) => {
    event.preventDefault();
    if (!insurer) return;
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      await api.insurers.setIntegration(insurer.id, {
        apiBaseUrl: String(form.get('apiBaseUrl') || '').trim(),
        publicSigningKey: String(form.get('publicSigningKey') || '').trim(),
        clientId: String(form.get('clientId') || '').trim(),
        quoteCallbackUrl: String(form.get('quoteCallbackUrl') || '').trim() || undefined,
        claimsCallbackUrl: String(form.get('claimsCallbackUrl') || '').trim() || undefined,
        policyCallbackUrl: String(form.get('policyCallbackUrl') || '').trim() || undefined,
        sandboxMode: form.get('sandboxMode') === 'on',
      });
      setShowIntegration(false);
      await reload(selectedInsurerId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The technical model could not be saved.');
    }
  };

  const activate = async (event) => {
    event.preventDefault();
    if (!insurer) return;
    const form = new FormData(event.currentTarget);
    setError('');
    try {
      await api.insurers.activate(insurer.id, {
        effectiveFrom: String(form.get('effectiveFrom')),
        renewalDate: String(form.get('renewalDate') || '') || undefined,
        conditions: String(form.get('conditions') || '').trim() || undefined,
      });
      setShowActivation(false);
      await onChanged?.();
      await reload(selectedInsurerId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The insurer could not be activated.');
    }
  };

  const suspend = async (event) => {
    event.preventDefault();
    if (!insurer) return;
    const reason = String(new FormData(event.currentTarget).get('reason') || '').trim();
    if (reason.length < 3) {
      setError('Give a brief reason before suspending this insurer.');
      return;
    }
    setError('');
    try {
      await api.insurers.suspend(insurer.id, reason);
      setShowSuspension(false);
      await onChanged?.();
      await reload(selectedInsurerId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The insurer could not be suspended.');
    }
  };

  if (!candidates.length) {
    return (
      <EmptyReview onBack={onBack} />
    );
  }

  return (
    <section aria-labelledby="onboarding-review-title">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Insurer lifecycle</p>
          <h2 id="onboarding-review-title" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Review onboarding</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">Record evidence, approve it, then activate an insurer only when the review is complete.</p>
        </div>
        <Button type="button" variant="outline" onClick={onBack}>Back to insurers</Button>
      </div>

      <Card className="gap-0 border-border shadow-none">
        <CardContent className="grid gap-4 pt-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="block max-w-xl text-sm font-medium" htmlFor="onboarding-insurer">
            Insurer under review
            <select id="onboarding-insurer" value={selectedInsurerId} onChange={(event) => setInsurerId(event.target.value)} className="mt-2 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
              {candidates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.status || 'Active'}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={STATE_STYLE[insurer?.status] || STATE_STYLE.Inactive}>{insurer?.status || 'Active'}</Badge>
            {insurer?.activation?.effectiveFrom && <span className="text-xs text-muted-foreground">Active from {insurer.activation.effectiveFrom}</span>}
          </div>
        </CardContent>
      </Card>

      {error && <p role="alert" className="mt-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">{error}</p>}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.8fr)]">
        <Card className="gap-0 border-border shadow-none">
          <CardHeader className="border-b">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileText className="size-5" aria-hidden="true" /></span>
              <div><CardTitle>Evidence on file</CardTitle><p className="mt-1 text-sm text-muted-foreground">A PIA licence is required before this insurer can trade. Every recorded document must be approved and current.</p></div>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            {loading ? <p className="py-6 text-sm text-muted-foreground">Loading evidence…</p> : evidence.length ? (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {evidence.map((piece) => (
                  <li key={piece.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{asLabel(piece.kind)}</p><Badge variant="outline" className={STATE_STYLE[piece.state] || STATE_STYLE.Inactive}>{asLabel(piece.state)}</Badge></div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{piece.reference || 'No issuer reference recorded'} · captured {new Date(piece.capturedAt).toLocaleDateString('en-ZM', { dateStyle: 'medium' })}{piece.expiresAt ? ` · expires ${piece.expiresAt}` : ''}</p>
                      {piece.note && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Review note: {piece.note}</p>}
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => setReviewing(piece)}>Review</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-sm text-muted-foreground">No evidence has been recorded for this insurer.</p>}
          </CardContent>
        </Card>

        <Card className="gap-0 border-border shadow-none">
          <CardHeader className="border-b"><CardTitle>Add evidence</CardTitle><p className="mt-1 text-sm text-muted-foreground">Upload the document first; it is held for review until an administrator decides.</p></CardHeader>
          <CardContent className="pt-5">
            <form onSubmit={uploadEvidence} className="space-y-4">
              <Field label="Document type"><select name="kind" defaultValue="LICENCE" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">{EVIDENCE_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
              <Field label="Document file"><Input name="file" type="file" accept="application/pdf,image/jpeg,image/png" required className="h-auto cursor-pointer py-2" /></Field>
              <Field label="Issuer reference (optional)"><Input name="reference" maxLength={120} placeholder="Licence or certificate number" /></Field>
              <Field label="Expiry date (optional)"><Input name="expiresAt" type="date" /></Field>
              <Button type="submit" className="w-full" disabled={uploading}><Upload aria-hidden="true" />{uploading ? 'Uploading…' : 'Record for review'}</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="gap-0 border-border shadow-none">
          <CardHeader className="border-b"><div className="flex items-start justify-between gap-4"><div><CardTitle>Technical connection</CardTitle><p className="mt-1 text-sm text-muted-foreground">Capture the insurer’s sandbox integration model. No client secret is displayed or saved here.</p></div><Button type="button" variant="outline" size="sm" onClick={() => setShowIntegration(true)}><PlugZap aria-hidden="true" />{integration ? 'Update' : 'Record'}</Button></div></CardHeader>
          <CardContent className="pt-5">
            {integration ? <dl className="grid gap-4 sm:grid-cols-2"><Detail label="API endpoint" value={integration.apiBaseUrl} /><Detail label="Client ID" value={integration.clientId} /><Detail label="Mode" value={integration.sandboxMode ? 'Sandbox' : 'Live'} /><Detail label="Quote callback" value={integration.quoteCallbackUrl || 'Not recorded'} /></dl> : <p className="text-sm text-muted-foreground">No technical model has been recorded yet.</p>}
          </CardContent>
        </Card>
        <Card className="gap-0 border-border shadow-none">
          <CardHeader className="border-b"><div className="flex items-start justify-between gap-4"><div><CardTitle>Activation decision</CardTitle><p className="mt-1 text-sm text-muted-foreground">The server refuses activation if a required document is missing, unapproved, or expired.</p></div>{insurer?.status === 'Active' ? <Button type="button" size="sm" variant="destructive" onClick={() => setShowSuspension(true)}>Suspend</Button> : <Button type="button" size="sm" onClick={() => setShowActivation(true)}><ShieldCheck aria-hidden="true" />Activate</Button>}</div></CardHeader>
          <CardContent className="pt-5"><p className="text-sm leading-relaxed text-muted-foreground">{insurer?.status === 'Active' ? 'Suspension stops new business and makes outstanding unpaid quotes unavailable. Existing paid policies and claims remain with the insurer.' : 'Approve the licence first, then record when the approval takes effect.'}</p></CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(reviewing)} onOpenChange={(open) => !open && setReviewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review {asLabel(reviewing?.kind)}</DialogTitle><DialogDescription>Record a clear decision. A rejected document remains on file with its review note.</DialogDescription></DialogHeader>
          <form onSubmit={reviewEvidence} className="space-y-4">
            <Field label="Decision"><select name="state" defaultValue={reviewing?.state === 'APPROVED' ? 'APPROVED' : 'REJECTED'} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></select></Field>
            <Field label="Review note (optional)"><Textarea name="note" defaultValue={reviewing?.note || ''} maxLength={2000} placeholder="Explain a rejection or record review context." /></Field>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setReviewing(null)}>Cancel</Button><Button type="submit">Save decision</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showIntegration} onOpenChange={setShowIntegration}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Technical connection</DialogTitle><DialogDescription>Record the non-secret details for a future insurer-system integration.</DialogDescription></DialogHeader>
          <form onSubmit={saveIntegration} className="space-y-4">
            <Field label="API base URL"><Input name="apiBaseUrl" type="url" required defaultValue={integration?.apiBaseUrl || ''} placeholder="https://sandbox.insurer.example/api" /></Field>
            <Field label="Public signing key"><Textarea name="publicSigningKey" required defaultValue={integration?.publicSigningKey || ''} placeholder="Public key supplied by the insurer" /></Field>
            <Field label="Client ID"><Input name="clientId" required defaultValue={integration?.clientId || ''} /></Field>
            <Field label="Quote callback URL (optional)"><Input name="quoteCallbackUrl" type="url" defaultValue={integration?.quoteCallbackUrl || ''} /></Field>
            <Field label="Claims callback URL (optional)"><Input name="claimsCallbackUrl" type="url" defaultValue={integration?.claimsCallbackUrl || ''} /></Field>
            <Field label="Policy callback URL (optional)"><Input name="policyCallbackUrl" type="url" defaultValue={integration?.policyCallbackUrl || ''} /></Field>
            <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm font-medium"><input name="sandboxMode" type="checkbox" defaultChecked={integration?.sandboxMode ?? true} className="size-4 accent-primary" />Use sandbox mode</label>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowIntegration(false)}>Cancel</Button><Button type="submit">Save connection</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showActivation} onOpenChange={setShowActivation}>
        <DialogContent>
          <DialogHeader><DialogTitle>Activate {insurer?.name}</DialogTitle><DialogDescription>This makes the insurer available for new customer quote requests only after the evidence check succeeds.</DialogDescription></DialogHeader>
          <form onSubmit={activate} className="space-y-4">
            <Field label="Effective from"><Input name="effectiveFrom" type="date" required defaultValue={today()} /></Field>
            <Field label="Review or renewal date (optional)"><Input name="renewalDate" type="date" /></Field>
            <Field label="Activation conditions (optional)"><Textarea name="conditions" maxLength={2000} placeholder="Any conditions attached to this approval" /></Field>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowActivation(false)}>Cancel</Button><Button type="submit"><Check aria-hidden="true" />Activate insurer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showSuspension} onOpenChange={setShowSuspension}>
        <DialogContent>
          <DialogHeader><DialogTitle>Suspend {insurer?.name}</DialogTitle><DialogDescription>New quote requests stop immediately. The customer is notified about unanswered requests, and unpaid quotes cannot be paid.</DialogDescription></DialogHeader>
          <form onSubmit={suspend} className="space-y-4">
            <Field label="Reason"><Textarea name="reason" required minLength={3} maxLength={1000} placeholder="Explain why the insurer must be suspended" /></Field>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setShowSuspension(false)}>Cancel</Button><Button type="submit" variant="destructive">Suspend insurer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Field({ label, children }) {
  return <label className="block text-sm font-medium"><span className="mb-2 block">{label}</span>{children}</label>;
}

function Detail({ label, value }) {
  return <div><dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt><dd className="mt-1.5 break-words text-sm">{value}</dd></div>;
}

function EmptyReview({ onBack }) {
  return <Card className="border-border shadow-none"><CardContent className="py-12 text-center"><h2 className="text-lg font-semibold">No insurers to review</h2><p className="mt-2 text-sm text-muted-foreground">Save an insurer profile before adding evidence and activating it.</p><Button type="button" variant="outline" className="mt-5" onClick={onBack}>Back to insurers</Button></CardContent></Card>;
}
