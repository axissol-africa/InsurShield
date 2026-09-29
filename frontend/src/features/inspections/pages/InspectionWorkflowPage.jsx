import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { api } from '@/api';
import { env } from '@/config/env';
import { hydrateCustomer } from '@/api/sync';
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

const PHOTO_SLOTS = [
  { id: 'front', label: 'Front view', icon: 'directions_car' },
  { id: 'back', label: 'Rear view', icon: 'directions_car' },
  { id: 'left', label: 'Left side', icon: 'directions_car' },
  { id: 'right', label: 'Right side', icon: 'directions_car' },
  { id: 'mileage', label: 'Dashboard and mileage', icon: 'speed' },
  { id: 'engine', label: 'Engine bay', icon: 'settings' },
];

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

  // Inspections come from the server when one is configured; a no-op otherwise.
  useEffect(() => { void hydrateCustomer(); }, []);
  const [view, setView] = useState('list'); // 'list' | 'request' | 'detail'
  const [selectedInspection, setSelectedInspection] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [uploadedPhotos, setUploadedPhotos] = useState({});

  const [form, setForm] = useState({
    preferredDate: '',
    preferredTime: '09:00',
    preferredLocation: '',
    vehiclePlate: vehicleDetails?.plateNumber || '',
    additionalNotes: '',
  });
  const setField = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));

  const allInspections = inspections.length > 0 ? inspections : DEMO_INSPECTIONS;

  const handleRequestInspection = async (event) => {
    event.preventDefault();
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
      await hydrateCustomer();
      setView('list');
    } catch (error) {
      setRequestError(error.message || 'Your inspection request could not be sent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePhotoUpload = (slotId, event) => {
    const file = event.target.files?.[0];
    if (file) setUploadedPhotos((previous) => ({ ...previous, [slotId]: URL.createObjectURL(file) }));
  };

  if (view === 'request') {
    return (
      <Page width="max-w-2xl">
        <BackLink onClick={() => setView('list')}>All inspections</BackLink>
        <header className="mt-5 border-b border-line pb-7">
          <Meta className="text-primary">Physical inspection</Meta>
          <h1 className="mt-4 text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink sm:text-[36px]">Request an inspection</h1>
          <p className="mt-4 max-w-xl text-[15px] leading-[1.6] text-ink-muted">
            A certified assessor looks at the vehicle where it suits you, and the report goes to the insurer with your quote request.
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

          <Panel title="Photos" hint="Optional — sending them now shortens the visit.">
            <PhotoGrid slots={PHOTO_SLOTS} photos={uploadedPhotos} onUpload={handlePhotoUpload} onRemove={(slotId) => setUploadedPhotos((previous) => ({ ...previous, [slotId]: null }))} />
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
    const inspection = allInspections.find((item) => item.id === selectedInspection.id) || selectedInspection;
    const currentIndex = INSPECTION_STAGES.findIndex((stage) => stage.id === inspection.status);
    const facts = [
      ['Vehicle', `${inspection.vehicle} · ${inspection.plate}`],
      ['Insurer', inspection.insurer],
      ['Scheduled', formatDate(inspection.scheduledDate, { long: true })],
      ...(inspection.inspectorName && inspection.inspectorName !== 'TBA'
        ? [['Assessor', inspection.inspectorName], ['Assessor contact', inspection.inspectorPhone]]
        : []),
      ['Location', inspection.location || inspection.preferredLocation],
    ];

    return (
      <Page width="max-w-4xl">
        <BackLink onClick={() => setView('list')}>All inspections</BackLink>
        <header className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-7">
          <div>
            <Meta className="text-primary">Physical inspection</Meta>
            <h1 className="mt-4 font-mono text-[30px] font-semibold leading-none tracking-[-0.02em] text-ink sm:text-[36px]">{inspection.id}</h1>
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
            {inspection.status === FAILED ? (
              <p className="text-[14px] leading-[1.6] text-ink-muted">
                This inspection did not pass. Your insurer will contact you about what happens next.
              </p>
            ) : (
              <ol className="relative">
                {INSPECTION_STAGES.map((stage, index) => {
                  const done = index <= currentIndex;
                  const current = index === currentIndex;
                  const last = index === INSPECTION_STAGES.length - 1;
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
          <Panel title="Inspection photos" hint="Anything you add here reaches the assessor before the visit.">
            <PhotoGrid
              slots={PHOTO_SLOTS}
              photos={{ ...(inspection.photos || {}), ...uploadedPhotos }}
              onUpload={handlePhotoUpload}
              onRemove={(slotId) => setUploadedPhotos((previous) => ({ ...previous, [slotId]: null }))}
            />
          </Panel>
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
            When an insurer wants its own assessor to see the vehicle, the visit is arranged and tracked here.
          </p>
        </div>
        <button type="button" onClick={() => setView('request')} className="inline-flex min-h-12 items-center gap-2 rounded-[1px] bg-primary px-5 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>Request an inspection
        </button>
      </header>

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
                onClick={() => { setSelectedInspection(inspection); setView('detail'); }}
                className="group flex w-full items-center gap-4 p-5 text-left transition-colors duration-200 ease-out hover:bg-canvas-2"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-dashed border-line-strong text-primary transition-colors duration-200 ease-out group-hover:border-primary">
                  <span className="material-symbols-outlined text-[22px]" aria-hidden="true">fact_check</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[14px] font-medium tracking-[0.04em] text-primary">{inspection.id}</span>
                    <span className="text-[15px] font-medium text-ink">{inspection.vehicle}</span>
                    <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-ink-faint">{inspection.plate}</span>
                  </span>
                  <span className="mt-1.5 block text-[13px] text-ink-muted">
                    {inspection.insurer} · {formatDate(inspection.scheduledDate)}
                  </span>
                </span>
                <Badge variant={statusVariant(inspection.status)} className="hidden sm:inline-flex">{inspection.status}</Badge>
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

function PhotoGrid({ slots, photos, onUpload, onRemove }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {slots.map((slot) => {
        const photo = photos[slot.id];
        return (
          <div key={slot.id} className="relative">
            <label className={`flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[1px] border-2 border-dashed p-3 text-center transition-colors duration-200 ease-out ${photo ? 'border-primary/40 bg-primary/5' : 'border-line-strong bg-canvas-2 hover:border-primary/60'}`}>
              {typeof photo === 'string' && photo.startsWith('blob:') ? (
                <img src={photo} alt={slot.label} className="h-14 w-full object-cover" />
              ) : (
                <span className={`material-symbols-outlined text-2xl ${photo ? 'text-primary' : 'text-ink-faint'}`} aria-hidden="true">{photo ? 'check_circle' : slot.icon}</span>
              )}
              <span className={`text-[11px] font-medium leading-tight ${photo ? 'text-primary' : 'text-ink'}`}>{slot.label}</span>
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => onUpload(slot.id, event)} />
            </label>
            {photo && (
              <button type="button" onClick={() => onRemove(slot.id)} className="absolute right-2 top-2 inline-flex min-h-7 items-center gap-1 rounded-[1px] bg-white/95 px-2 text-[10px] font-medium text-primary shadow-sm hover:bg-white">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">delete</span>Remove
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
