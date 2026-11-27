import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getIdentityBinding } from '@/app/identity';
import InspectionEvidencePanel from '../components/InspectionEvidencePanel';
import InspectionDocuments from '../components/InspectionDocuments';
import { laterInspection, inspectionStatus, inspectionPurpose, inspectionNextAction, inspectionClosed } from '@/domain/inspectionWorkflow';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { api } from '@/api';
import { env } from '@/config/env';
import { formatDate } from '@/domain/premiumEngine';
import { fieldClass, labelClass } from '@/components/ui/field';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Meta from '@/components/ui/Meta';

/**
 * Physical inspections, for the cases the live photo capture cannot settle —
 * an older vehicle, a disputed value, or an insurer that wants its own
 * assessor to look at the car.
 *
 * The stages below are the insurer's, not ours: the customer's question is
 * only ever "where has it got to, and what do I do next", so a stage is
 * either done, current or still ahead, and nothing is colour-coded beyond
 * that.
 */
const INSPECTION_STAGES = [
  { id: 'Requested', label: 'Requested' },
  { id: 'Scheduled', label: 'Scheduled' },
  { id: 'Inspector Assigned', label: 'Inspector assigned' },
  { id: 'In Progress', label: 'Inspection under way' },
  { id: 'Completed', label: 'Inspection completed' },
  { id: 'Report Ready', label: 'Report ready' },
  { id: 'Approved', label: 'Approved' },
];

/** `Failed` sits outside the run of stages: it ends the inspection instead of advancing it. */
const FAILED = 'Failed';

const statusVariant = (status) => {
  if (status === FAILED) return 'outline';
  if (status === 'Approved') return 'success';
  return 'default';
};

const TIMES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'];

/**
 * One example inspection so the demo has something to open. Gated on the mock
 * adapter: against a real API an account with no inspections must show none,
 * not a fictional one.
 */
const DEMO_INSPECTIONS = env.apiMode === 'mock' ? [
  {
    id: 'INS-001', status: 'In Progress', vehicle: '2020 Toyota Hilux', plate: 'BAA 1234',
    scheduledDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    inspectorName: 'Chiluba Mwamba', inspectorPhone: '0971 234 567',
    location: 'InsurShield Inspection Centre, Lusaka Central',
    insurer: 'Prestige Assurance',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Physical inspection required before quotation. Bring your White Book.',
    photos: {},
  },
] : [];

export default function InspectionWorkflowPage() {
  const { inspections, vehicleDetails } = useStore();
  const [params, setParams] = useSearchParams();
  const claimFilter = params.get('claim');
  const busy = useRef(false);

  const mounted = useRef(false);
  const [loading, setLoading] = useState(env.apiMode === 'http');
  const [loadError, setLoadError] = useState('');
  const refresh = useCallback(async () => {
    if (env.apiMode !== 'http') return;
    const owner = getIdentityBinding();
    const current = () => mounted.current && !useStore.getState().leaving && owner === getIdentityBinding();
    setLoading(true);
    try {
      const records = await api.inspections.list();
      if (current()) { useStore.getState().setInspections(records); setLoadError(''); }
    } catch (error) {
      if (current()) setLoadError(error.message || 'Inspections could not be loaded. Please refresh.');
    } finally { if (current()) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; let active = true; Promise.resolve().then(() => { if (active) void refresh(); }); return () => { active = false; mounted.current = false; }; }, [refresh]);
  const [view, setView] = useState(params.get('inspection') ? 'detail' : 'list'); // 'list' | 'request' | 'detail'
  const [selectedInspection, setSelectedInspection] = useState(params.get('inspection') ? { id: params.get('inspection') } : null);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState('');

  const [form, setForm] = useState({
    preferredDate: '',
    preferredTime: '09:00',
    preferredLocation: '',
    vehiclePlate: vehicleDetails?.plateNumber || '',
    additionalNotes: '',
  });
  const setField = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));

  const allInspections = (inspections.length > 0 ? inspections : DEMO_INSPECTIONS).filter((item) => !claimFilter || item.claimNumber === claimFilter);

  const handleRequestInspection = async (event) => {
    event.preventDefault();
    if (busy.current) return;
    const owner = getIdentityBinding();
    busy.current = true;
    setSubmitting(true);
    setRequestError('');
    try {
      await api.inspections.request({
        vehiclePlate: form.vehiclePlate || vehicleDetails?.plateNumber || 'N/A',
        vehicleLabel: vehicleDetails ? `${vehicleDetails.year} ${vehicleDetails.make} ${vehicleDetails.model}` : 'Your vehicle',
        preferredDate: form.preferredDate || undefined,
        preferredTime: form.preferredTime || undefined,
        preferredLocation: form.preferredLocation || undefined,
        notes: form.additionalNotes || undefined,
      });
      if (useStore.getState().leaving || owner !== getIdentityBinding()) return;
      await refresh();
      setView('list');
    } catch (error) {
      setRequestError(error.message || 'Your inspection request could not be sent. Please try again.');
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  if (view === 'request') {
    return (
      <Page width="max-w-2xl">
        <BackLink onClick={() => setView('list')}>All inspections</BackLink>
        <header className="mt-5 border-b border-line pb-7">
          <Meta className="text-primary">Physical inspection</Meta>
          <h1 className="mt-4 text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink sm:text-[36px]">Request an inspection</h1>
          <p className="mt-4 max-w-xl text-[15px] leading-[1.6] text-ink-muted">
            Have your vehicle registration, preferred date, location and contact number ready. Request an assessment and track the appointment, evidence and report for your insurer.
          </p>
        </header>

        <form onSubmit={handleRequestInspection} className="mt-7 space-y-5">
          <Panel title="Vehicle">
            <label className="block">
              <span className={labelClass}>Number plate</span>
              <input
                value={form.vehiclePlate}
                onChange={(event) => setField('vehiclePlate', event.target.value.toUpperCase())}
                className={`${fieldClass} uppercase tracking-[0.12em]`}
                placeholder="e.g. BAA 1234"
              />
            </label>
          </Panel>

          <Panel title="When and where">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Date</span>
                <input required type="date" value={form.preferredDate} min={new Date().toISOString().split('T')[0]} onChange={(event) => setField('preferredDate', event.target.value)} className={fieldClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Time</span>
                <div className="relative">
                  <select value={form.preferredTime} onChange={(event) => setField('preferredTime', event.target.value)} className={`${fieldClass} appearance-none pr-10`}>
                    {TIMES.map((time) => <option key={time}>{time}</option>)}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-ink-faint" aria-hidden="true">expand_more</span>
                </div>
              </label>
            </div>
            <label className="mt-4 block">
              <span className={labelClass}>Where the vehicle will be</span>
              <input required placeholder="e.g. InsurShield office, Lusaka — or your own address" value={form.preferredLocation} onChange={(event) => setField('preferredLocation', event.target.value)} className={fieldClass} />
            </label>
            <label className="mt-4 block">
              <span className={labelClass}>Anything the assessor should know</span>
              <textarea rows={2} placeholder="Access, gate codes, or a time that suits better" value={form.additionalNotes} onChange={(event) => setField('additionalNotes', event.target.value)} className={`${fieldClass} resize-none`} />
            </label>
          </Panel>

          {requestError && (
            <p role="alert" className="flex items-start gap-2.5 rounded-[1px] border border-primary/30 bg-primary/[0.06] p-3.5 text-[14px] leading-[1.5] text-primary">
              <span className="material-symbols-outlined shrink-0 text-[20px]" aria-hidden="true">error</span>{requestError}
            </p>
          )}

          <button type="submit" disabled={submitting} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[1px] bg-primary text-[16px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:opacity-60">
            <span className={`material-symbols-outlined ${submitting ? 'animate-spin' : ''}`} aria-hidden="true">{submitting ? 'sync' : 'calendar_add_on'}</span>
            {submitting ? 'Sending your request…' : 'Request the inspection'}
          </button>
        </form>
      </Page>
    );
  }

  if (view === 'detail' && selectedInspection) {
    const inspection = allInspections.find((item) => item.id === selectedInspection.id);
    if (!inspection) return <Page width="max-w-4xl"><BackLink onClick={() => setView('list')}>All inspections</BackLink><p role={loadError ? 'alert' : 'status'}>{loading ? 'Loading inspection…' : loadError || 'This inspection is not available for your account.'}</p></Page>;
    const stages = inspection.method === 'SELF_CAPTURE' ? INSPECTION_STAGES.filter((stage) => ['Requested', 'Report Ready', 'Approved'].includes(stage.id)) : INSPECTION_STAGES;
    const currentIndex = stages.findIndex((stage) => stage.id.replaceAll(' ', '_').toUpperCase() === inspectionStatus(inspection));
    const facts = [
      ['Vehicle', `${inspection.vehicleLabel || inspection.vehicle || ''} · ${inspection.vehiclePlate || inspection.plate || ''}`],
      ['Purpose', inspectionPurpose(inspection)],
      ...(inspection.stage ? [['Stage', inspection.stage.replaceAll('_', ' ')]] : []),
      ...(inspection.policyNumber ? [['Policy', inspection.policyNumber]] : []),
      ...(inspection.claimNumber ? [['Claim', <a className="underline" href={`/claims?claim=${encodeURIComponent(inspection.claimNumber)}`}>{inspection.claimNumber}</a>]] : []),
      ['Insurer', inspection.insurer],
      ['Scheduled', formatDate(inspection.scheduledDate, { long: true })],
      ...(inspection.inspectorName && inspection.inspectorName !== 'TBA'
        ? [['Assessor', inspection.inspectorName], ['Assessor contact', inspection.inspectorPhone]]
        : []),
      ['Location', inspection.location || inspection.preferredLocation],
      // An inspection an insurer's product needs says which products and when.
      ...(inspection.purpose === 'UNDERWRITING'
        ? [
            ['Asked for by', (inspection.products || []).map((product) => product.productName).join(', ') || 'Your quote request'],
            ['Your purchase', 'Not held up by this inspection'],
            ['How', inspection.method === 'SELF_CAPTURE' ? 'From your vehicle photos' : 'In person'],
          ]
        : []),
      ...(inspection.resultReason ? [['Reason', inspection.resultReason]] : []),
    ];

    return (
      <Page width="max-w-4xl">
        <BackLink onClick={() => setView('list')}>All inspections</BackLink>
        <header className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-7">
          <div>
            <Meta className="text-primary">{inspectionPurpose(inspection)}</Meta>
            <h1 className="mt-4 break-all font-mono text-[30px] font-semibold leading-none tracking-[-0.02em] text-ink sm:text-[36px]">{inspection.id}</h1>
          </div>
          <Badge variant={statusVariant(inspection.status)}>{inspection.status}</Badge>
        </header>

        <div className="mt-7 grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
          <Panel title="Details">
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className={labelClass}>{label}</dt>
                  <dd className="text-[15px] leading-[1.45] text-ink">{value || '—'}</dd>
                </div>
              ))}
            </dl>
            {inspection.notes && (
              <p className="mt-6 flex items-start gap-2.5 border border-dashed border-line-strong bg-canvas-2 p-3.5 text-[14px] leading-[1.5] text-ink">
                <span className="material-symbols-outlined shrink-0 text-[20px] text-primary" aria-hidden="true">sticky_note_2</span>
                <span>{inspection.notes}</span>
              </p>
            )}
          </Panel>

          <Panel title="Progress">
            {inspectionClosed(inspection) && inspectionStatus(inspection) !== 'APPROVED' ? (
              <p className="text-[14px] leading-[1.6] text-ink-muted">
                {inspectionNextAction(inspection)}
              </p>
            ) : (
              <ol className="relative">
                {stages.map((stage, index) => {
                  const done = index <= currentIndex;
                  const current = index === currentIndex;
                  const last = index === stages.length - 1;
                  return (
                    <li key={stage.id} aria-current={current ? 'step' : undefined} className="relative flex gap-3.5 pb-5 last:pb-0">
                      {/* The rail runs behind the markers, solid where the work is done. */}
                      {!last && <span aria-hidden="true" className={`absolute left-[11px] top-6 h-full w-px ${index < currentIndex ? 'bg-primary' : 'bg-line-strong'}`} />}
                      <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold tabular-nums ${done ? 'border-primary bg-primary text-white' : 'border-line-strong bg-canvas text-ink-faint'} ${current ? 'ring-4 ring-primary/15' : ''}`}>
                        {done ? <span className="material-symbols-outlined text-[13px]" aria-hidden="true">check</span> : index + 1}
                      </span>
                      <span className={`pt-0.5 text-[14px] leading-[1.4] ${current ? 'font-medium text-primary' : done ? 'text-ink' : 'text-ink-faint'}`}>
                        {stage.label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>

        <div className="mt-5">
          {laterInspection(inspection) ? <>
            <p className="mb-4 text-sm">{inspectionNextAction(inspection)}</p>
            <InspectionEvidencePanel key={inspection.id} inspection={inspection} onChanged={refresh} />
          </> : <Panel title="Inspection photos" hint="Saved evidence supplied to the insurer.">
            <InspectionDocuments label="Saved photos" items={Array.isArray(inspection.photos) ? inspection.photos : []} />
          </Panel>}
        </div>
      </Page>
    );
  }

  return (
    <Page width="max-w-4xl">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-7">
        <div>
          <span className="inline-flex items-center gap-3">
            <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
            <Meta className="text-ink-muted">Physical inspections</Meta>
          </span>
          <h1 className="mt-5 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[44px]">Vehicle inspections</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-[1.6] text-ink-muted">
            Have your vehicle registration, preferred date, location and contact number ready to request an inspection. Track the appointment, evidence and report for your insurer.
          </p>
        </div>
        <button type="button" onClick={() => setView('request')} className="inline-flex min-h-12 items-center gap-2 rounded-[1px] bg-primary px-5 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>Request an inspection
        </button>
      </header>

      {loading && <p role="status" className="mt-5">Loading inspections…</p>}
      {loadError && <p role="alert" className="mt-5">{loadError}</p>}
      {allInspections.length === 0 ? (
        <EmptyState
          className="mt-7"
          icon="fact_check"
          title="No inspections yet"
          hint="Most quotes need only the live photos you take yourself. An inspection is arranged when an insurer asks for one."
        />
      ) : (
        <ul className="mt-7 border border-line bg-white">
          {allInspections.map((inspection) => (
            <li key={inspection.id} className="border-b border-dashed border-line last:border-b-0">
              <button
                type="button"
                onClick={() => { setSelectedInspection(inspection); setView('detail'); setParams({ ...(claimFilter ? { claim: claimFilter } : {}), inspection: inspection.id }); }}
                className="group flex w-full flex-wrap items-center gap-4 p-5 text-left transition-colors duration-200 ease-out hover:bg-canvas-2"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-dashed border-line-strong text-primary transition-colors duration-200 ease-out group-hover:border-primary">
                  <span className="material-symbols-outlined text-[22px]" aria-hidden="true">fact_check</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="break-all font-mono text-[14px] font-medium tracking-[0.04em] text-primary">{inspection.id}</span>
                    <span className="text-[15px] font-medium text-ink">{inspection.vehicleLabel || inspection.vehicle}</span>
                    <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-ink-faint">{inspection.vehiclePlate || inspection.plate}</span>
                  </span>
                  <span className="mt-1.5 block text-[13px] text-ink-muted">
                    {inspection.insurer} · {inspectionPurpose(inspection)}{inspection.policyNumber ? ` · ${inspection.policyNumber}` : ''}{inspection.claimNumber ? ` · ${inspection.claimNumber}` : ''} · {formatDate(inspection.scheduledDate)}
                  </span>
                </span>
                <Badge variant={statusVariant(inspection.status)} className="shrink-0">{inspection.statusLabel || inspection.status}</Badge>
                <span className="material-symbols-outlined shrink-0 text-[20px] text-ink-faint transition-colors duration-200 ease-out group-hover:text-primary" aria-hidden="true">chevron_right</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────

function Page({ width, children }) {
  return (
    <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative overflow-x-clip">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
      <div className={`relative mx-auto w-full ${width} px-6 py-10 pb-20 lg:px-10`}>{children}</div>
    </motion.main>
  );
}

function BackLink({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-10 items-center gap-2 text-[13px] font-medium text-ink-muted transition-colors duration-200 ease-out hover:text-primary">
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>{children}
    </button>
  );
}

function Panel({ title, hint, children }) {
  return (
    <section className="border border-line bg-white p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-dashed border-line pb-3">
        <Meta className="text-ink-muted">{title}</Meta>
        {hint && <span className="text-[12px] text-ink-faint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
