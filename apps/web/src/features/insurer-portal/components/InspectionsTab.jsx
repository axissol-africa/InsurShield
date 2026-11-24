import { useEffect, useId, useState } from 'react';
import { formatDate } from '@/domain/premiumEngine';
import { usePortalAction } from '@/features/insurer-portal/hooks/usePortalAction';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { Spinner } from '@/components/ui/primitives/spinner';
import { Textarea } from '@/components/ui/primitives/textarea';
import { ContactLinks, PageHeader } from './ui';

const CLOSED = ['APPROVED', 'FAILED', 'CANCELLED', 'NO_SHOW'];
const STAGE_LABELS = { BEFORE_QUOTATION: 'Product asks for it before quoting', BEFORE_PAYMENT: 'Product asks for it before payment', AFTER_PAYMENT: 'After payment' };
const METHOD_LABELS = { PHYSICAL: 'In person', SELF_CAPTURE: 'Customer photos' };

/** The API's own words when it gives them, otherwise the caller's plain fallback. */
const messageOf = (fallback) => (caught) => (caught?.code && caught?.message ? caught.message : fallback);

/**
 * The inspections this insurer carries out. They are optional: the customer's
 * live photos are enough as a rule, so nothing here holds up a quote or a
 * purchase. A missed or cancelled appointment is booked again.
 */
export default function InspectionsTab({ api, onChanged }) {
  const [inspections, setInspections] = useState(null);
  const [loadError, setLoadError] = useState('');

  // Bumped after each step, so the list is read again from the server.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    api.inspections.listForInsurer()
      .then((loaded) => {
        if (!current) return;
        setInspections(loaded);
        setLoadError('');
      })
      .catch(() => { if (current) setLoadError('Inspections could not be loaded. Reload the page to try again.'); });
    return () => { current = false; };
  }, [api, version]);

  const open = (inspections ?? []).filter((inspection) => !CLOSED.includes(inspection.status));
  const finished = (inspections ?? []).filter((inspection) => CLOSED.includes(inspection.status));
  const changed = async () => {
    setVersion((current) => current + 1);
    await onChanged?.();
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Inspections" description="Optional inspections for products whose terms ask for one. The customer's live photos are enough as a rule, so an inspection never holds up a quote or a purchase. If one fails, decide yourself whether to decline the product." />
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
      {inspections === null && !loadError && <p className="text-sm text-muted-foreground">Loading inspections…</p>}
      {inspections && (
        <>
          <section aria-label="Open inspections" className="space-y-4">
            <h2 className="text-lg font-semibold">Open <Badge variant="secondary">{open.length}</Badge></h2>
            {open.length === 0 && <p className="text-sm text-muted-foreground">No inspection is waiting on you.</p>}
            {open.map((inspection) => <InspectionCard key={inspection.id} inspection={inspection} api={api} onChanged={changed} />)}
          </section>
          {finished.length > 0 && (
            <section aria-label="Finished inspections" className="space-y-4">
              <h2 className="text-lg font-semibold">Finished</h2>
              {finished.map((inspection) => <InspectionCard key={inspection.id} inspection={inspection} api={api} onChanged={changed} />)}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function InspectionCard({ inspection, api, onChanged }) {
  const id = useId();
  const [step, setStep] = useState(null);
  const closed = CLOSED.includes(inspection.status);
  const booked = ['SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REPORT_READY'].includes(inspection.status);
  const decidable = booked || (inspection.method === 'SELF_CAPTURE' && inspection.status === 'REQUESTED');
  const act = usePortalAction(async (change) => {
    await change();
    setStep(null);
    await onChanged();
  }, messageOf('That step could not be saved. Please try again.'));

  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle><h3>{inspection.vehicleLabel} <span className="font-mono text-sm text-muted-foreground">{inspection.vehiclePlate}</span></h3></CardTitle>
          <Badge variant={closed ? 'secondary' : 'outline'}>{inspection.statusLabel}</Badge>
        </div>
        <CardDescription>
          {inspection.id}
          {inspection.quoteRequestId && <> · request {inspection.quoteRequestId}</>}
          {inspection.stage && <> · {STAGE_LABELS[inspection.stage]}</>}
          {inspection.method && <> · {METHOD_LABELS[inspection.method]}</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {inspection.products?.length > 0 && (
          <p><span className="text-muted-foreground">For: </span>{inspection.products.map((product) => product.productName).join(', ')}</p>
        )}
        {inspection.customer && (
          <div><span className="text-muted-foreground">Customer: </span>{inspection.customer.fullName} <ContactLinks phone={inspection.customer.phone} email={inspection.customer.email} /></div>
        )}
        {inspection.scheduledDate && (
          <p><span className="text-muted-foreground">Booked: </span>{formatDate(inspection.scheduledDate)}{inspection.location ? `, ${inspection.location}` : ''}</p>
        )}
        {inspection.inspectorName && (
          <p><span className="text-muted-foreground">Inspector: </span>{inspection.inspectorName}{inspection.inspectorPhone ? `, ${inspection.inspectorPhone}` : ''}</p>
        )}
        {inspection.resultReason && <p><span className="text-muted-foreground">Reason: </span>{inspection.resultReason}</p>}
        {inspection.predecessorId && <p className="text-muted-foreground">Repeats {inspection.predecessorId}.</p>}

        {!closed && (
          <div className="flex flex-wrap gap-2">
            {['REQUESTED', 'SCHEDULED'].includes(inspection.status) && inspection.method !== 'SELF_CAPTURE' && (
              <Button type="button" size="sm" variant="outline" onClick={() => setStep('schedule')}>{inspection.status === 'SCHEDULED' ? 'Rebook' : 'Book'}</Button>
            )}
            {['SCHEDULED', 'INSPECTOR_ASSIGNED'].includes(inspection.status) && (
              <Button type="button" size="sm" variant="outline" onClick={() => setStep('assign')}>Assign inspector</Button>
            )}
            {decidable && (
              <Button type="button" size="sm" disabled={act.pending} onClick={() => act.run(() => api.inspections.approve(inspection.id))}>Pass</Button>
            )}
            {decidable && <Button type="button" size="sm" variant="destructive" onClick={() => setStep('fail')}>Fail</Button>}
            {['SCHEDULED', 'INSPECTOR_ASSIGNED'].includes(inspection.status) && (
              <Button type="button" size="sm" variant="outline" onClick={() => setStep('noShow')}>Vehicle not presented</Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => setStep('cancel')}>Cancel</Button>
          </div>
        )}

        {step === 'schedule' && (
          <StepForm
            label="Book the inspection"
            fields={[
              { name: 'scheduledDate', label: 'Date and time', type: 'datetime-local', required: true },
              { name: 'location', label: 'Where' },
            ]}
            pending={act.pending}
            onCancel={() => setStep(null)}
            onSubmit={(values) => act.run(() => api.inspections.schedule(inspection.id, {
              scheduledDate: new Date(values.scheduledDate).toISOString(),
              location: values.location || undefined,
            }))}
            idPrefix={id}
          />
        )}
        {step === 'assign' && (
          <StepForm
            label="Assign the inspector"
            fields={[
              { name: 'inspectorName', label: 'Inspector name', required: true },
              { name: 'inspectorPhone', label: 'Inspector phone' },
            ]}
            pending={act.pending}
            onCancel={() => setStep(null)}
            onSubmit={(values) => act.run(() => api.inspections.assignInspector(inspection.id, {
              inspectorName: values.inspectorName,
              inspectorPhone: values.inspectorPhone || undefined,
            }))}
            idPrefix={id}
          />
        )}
        {['fail', 'noShow', 'cancel'].includes(step) && (
          <StepForm
            label={{ fail: 'Why did it fail?', noShow: 'What happened?', cancel: 'Why cancel it?' }[step]}
            fields={[{ name: 'reason', label: 'Reason, shown to the customer', multiline: true, required: true }]}
            pending={act.pending}
            onCancel={() => setStep(null)}
            onSubmit={(values) => act.run(() => ({ fail: api.inspections.fail, noShow: api.inspections.noShow, cancel: api.inspections.cancel })[step](inspection.id, values.reason))}
            idPrefix={id}
            destructive
          />
        )}
        {act.error && <p role="alert" className="text-sm text-destructive">{act.error}</p>}
      </CardContent>
    </Card>
  );
}

function StepForm({ label, fields, pending, onSubmit, onCancel, idPrefix, destructive = false }) {
  const [values, setValues] = useState({});
  const ready = fields.every((field) => !field.required || (values[field.name] ?? '').trim().length >= (field.multiline ? 3 : 1));
  return (
    <form
      aria-label={label}
      className="space-y-2 rounded-xl border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void onSubmit(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])));
      }}
    >
      <p className="font-medium">{label}</p>
      {fields.map((field) => {
        const fieldId = `${idPrefix}-${field.name}`;
        const change = (event) => setValues((current) => ({ ...current, [field.name]: event.target.value }));
        return (
          <div key={field.name} className="space-y-1">
            <label htmlFor={fieldId} className="block text-xs font-medium">{field.label}{field.required ? ' *' : ''}</label>
            {field.multiline
              ? <Textarea id={fieldId} rows={2} maxLength={1000} value={values[field.name] ?? ''} onChange={change} />
              : <Input id={fieldId} type={field.type ?? 'text'} value={values[field.name] ?? ''} onChange={change} />}
          </div>
        );
      })}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={destructive ? 'destructive' : 'default'} disabled={pending || !ready} aria-busy={pending}>
          {pending && <Spinner aria-hidden="true" />} Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>Back</Button>
      </div>
    </form>
  );
}
