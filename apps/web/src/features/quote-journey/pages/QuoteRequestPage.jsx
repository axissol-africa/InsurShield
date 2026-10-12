import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useStore, useActiveInsurers } from '@/store';
import { submitQuoteRequest } from '@/features/quote-journey/submitRequest';
import { calculatePolicyDates, calculatePremium, formatDate, formatZMW } from '@/domain/premiumEngine';
import { COVERAGE_DURATION_OPTIONS } from '@/domain/insurers';
import JourneyProgress from '@/features/quote-journey/components/JourneyProgress';
import InspectionPhotos from '@/features/quote-journey/components/InspectionPhotos';
import GuidedCapture from '@/features/quote-journey/components/GuidedCapture';
import PhoneHandoff from '@/features/quote-journey/components/PhoneHandoff';
import { INSPECTION_SHOTS, missingInspectionShots } from '@/domain/inspection';
import { isMobileDevice } from '@/lib/device';
import { fieldClass as inputClass } from '@/components/ui/field';
import { captureApi } from '@/api/capture';



const fileDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('The White Book could not be read. Please choose it again.'));
  reader.readAsDataURL(file);
});
const today = () => new Date().toISOString().split('T')[0];

const currentYearRtsaAnniversary = (registrationDate) => {
  if (!registrationDate) return '';
  const [, month, day] = registrationDate.split('-').map(Number);
  if (!month || !day) return '';

  const currentYear = new Date().getFullYear();
  const resolvedDay = Math.min(day, new Date(currentYear, month, 0).getDate());
  return `${currentYear}-${String(month).padStart(2, '0')}-${String(resolvedDay).padStart(2, '0')}`;
};

const legacyRoadTaxDate = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().split('T')[0];
};

export default function QuoteRequestPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const captureCode = searchParams.get('capture');
  const {
    vehicleValue, vehicleUsage, vehicleDetails, insuranceType, documents, customer,
    coverageDurationId, setCoverageDuration, policyStartDate, setPolicyStartDate, setDocument, setDocuments,
    matchRtsaAnniversary, rtsaRegistrationDate, setRtsaAnniversary, piaConfig, requotedFromId,
    setVehicleDetails, setVehicleValue, setVehicleUsage, setInsuranceType,
  } = useStore();
  const [handoffOpen, setHandoffOpen] = useState(false);
  const priorPolicyStartDate = useRef(policyStartDate);
  const resumedCaptureCode = useRef('');

  const [contact, setContact] = useState({ fullName: customer?.fullName || '', phone: customer?.phone || '', email: customer?.email || '' });
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [resuming, setResuming] = useState(Boolean(captureCode));
  const [resumeError, setResumeError] = useState('');

  const activeInsurers = useActiveInsurers();
  const mobileDevice = isMobileDevice();
  const rtsaAnniversaryDate = vehicleDetails?.rtsaAnniversaryDate || legacyRoadTaxDate(vehicleDetails?.roadTaxExpiry) || vehicleDetails?.registrationDate || '';
  const selectedRtsaAnniversary = rtsaAnniversaryDate || rtsaRegistrationDate;
  const anniversaryDate = matchRtsaAnniversary ? selectedRtsaAnniversary : undefined;
  const policyDates = useMemo(() => calculatePolicyDates(policyStartDate, coverageDurationId, { anniversaryDate }), [policyStartDate, coverageDurationId, anniversaryDate]);
  const coverageDays = policyDates?.anchoredToAnniversary ? policyDates.daysTotal : null;
  const missingPhotos = missingInspectionShots(documents);
  const inspectionPhotos = useMemo(() => Object.fromEntries(INSPECTION_SHOTS.map((shot) => [shot.key, documents[shot.key]])), [documents]);
  const receivePhotos = useCallback((photos) => setDocuments(photos), [setDocuments]);
  const removePhoto = useCallback((key) => setDocument(key, null), [setDocument]);
  const clearInspectionPhotos = useCallback(() => {
    setDocuments(Object.fromEntries(INSPECTION_SHOTS.map((shot) => [shot.key, null])));
  }, [setDocuments]);
  const closeHandoff = useCallback(() => setHandoffOpen(false), []);

  // Older builds persisted the White Book as a browser-only blob URL. Those
  // URLs stop working after a refresh or on a phone, so remove the stale value
  // and ask once for a durable data copy instead of failing at submission.
  useEffect(() => {
    if (typeof documents.whiteBook === 'string' && documents.whiteBook.startsWith('blob:')) setDocument('whiteBook', null);
  }, [documents.whiteBook, setDocument]);

  useEffect(() => {
    if (!captureCode || resumedCaptureCode.current === captureCode) return undefined;
    let cancelled = false;
    setResuming(true);
    captureApi.get(captureCode)
      .then((session) => {
        if (cancelled) return;
        const draft = session.journey;
        if (!draft) throw new Error('This phone hand-off does not contain a quote to continue. Start a new phone capture from your computer.');
        setVehicleDetails(draft.vehicleDetails);
        setVehicleValue(draft.vehicleValue);
        setVehicleUsage(draft.vehicleUsage);
        setInsuranceType(draft.insuranceType);
        setCoverageDuration(draft.coverageDurationId);
        setPolicyStartDate(draft.policyStartDate);
        setRtsaAnniversary(Boolean(draft.matchRtsaAnniversary), draft.rtsaRegistrationDate || '');
        setDocuments({ ...(draft.documents || {}), ...(session.photos || {}) });
        setContact(draft.contact || { fullName: '', phone: '', email: '' });
        resumedCaptureCode.current = captureCode;
        setResuming(false);
      })
      .catch((caught) => {
        if (!cancelled) {
          setResumeError(caught.message || 'We could not restore this quote on your phone.');
          setResuming(false);
        }
      });
    return () => { cancelled = true; };
  }, [captureCode, setCoverageDuration, setDocuments, setInsuranceType, setPolicyStartDate, setRtsaAnniversary, setVehicleDetails, setVehicleUsage, setVehicleValue]);

  useEffect(() => {
    if (!matchRtsaAnniversary || !selectedRtsaAnniversary) return;
    const anniversaryStart = currentYearRtsaAnniversary(selectedRtsaAnniversary);
    if (anniversaryStart) setPolicyStartDate(anniversaryStart);
  }, [matchRtsaAnniversary, selectedRtsaAnniversary, setPolicyStartDate]);

  const toggleRtsaAnniversary = (checked) => {
    if (checked) {
      priorPolicyStartDate.current = policyStartDate;
      // The RTSA lookup anniversary is authoritative. Do not reuse an older
      // date retained from a previous quote journey in browser storage.
      const selectedAnniversary = selectedRtsaAnniversary;
      setRtsaAnniversary(true, selectedAnniversary);
      const anniversaryStart = currentYearRtsaAnniversary(selectedAnniversary);
      if (anniversaryStart) setPolicyStartDate(anniversaryStart);
      return;
    }
    setRtsaAnniversary(false);
    setPolicyStartDate(priorPolicyStartDate.current || today());
  };

  const errors = {
    anniversary: matchRtsaAnniversary && !selectedRtsaAnniversary
      ? 'Enter the RTSA registration date, or untick the anniversary option.'
      : policyDates?.hasEnded
        ? `Cover from ${policyDates.formattedStart} for this period would already have ended on ${policyDates.formattedEnd}. Choose a longer cover period or untick RTSA matching.`
        : null,
    whiteBook: documents.whiteBook ? null : 'Add your White Book so insurers can verify ownership.',
    photos: missingPhotos.length ? `Capture ${missingPhotos.length} more inspection photo${missingPhotos.length === 1 ? '' : 's'}.` : null,
    declaration: declarationAccepted ? null : 'Accept the declaration to send your request.',
  };
  const firstError = Object.keys(errors).find((key) => errors[key]);
  const missingVehicle = !vehicleDetails || !vehicleValue;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (firstError) {
      setShowErrors(true);
      document.getElementById(`section-${firstError}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSending(true);
    setSendError('');
    try {
      await submitQuoteRequest({ customer: contact, policyDates });
      navigate(`/quotes-comparison${captureCode ? `?capture=${encodeURIComponent(captureCode)}` : ''}`);
    } catch (error) {
      setSendError(error.message || 'Your request could not be sent. Please try again.');
      setSending(false);
    }
  };

  if (resuming) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center bg-canvas px-6">
        <p className="text-[15px] text-ink-muted">Restoring your quote on this phone…</p>
      </main>
    );
  }

  if (resumeError || missingVehicle) {
    return (
      <>
        <JourneyProgress current={4} />
        <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-5">
          <section className="w-full rounded-[1px] border border-line bg-white p-8 text-center">
            <span className="material-symbols-outlined text-[48px] text-primary" aria-hidden="true">directions_car</span>
            <h1 className="mt-3 text-2xl font-semibold">{resumeError ? 'This phone link is no longer available' : "Let's start with your vehicle"}</h1>
            <p className="mt-2 text-ink-muted">{resumeError || 'We need your cover choice, vehicle details and declared value before insurers can quote.'}</p>
            <button type="button" onClick={() => navigate('/insurance-type')} className="mt-6 min-h-12 rounded-[1px] bg-primary px-6 font-medium text-white hover:bg-[#b91c1c]">Start a quote</button>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <JourneyProgress current={4} />
      {/* `clip` rather than `hidden`: it still contains the backdrop
          horizontally, but does not become a scroll container — which would
          stop the send bar below from sticking to the bottom of the screen. */}
      <motion.main initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-x-clip">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-[1200px] px-6 py-12 pb-24 lg:px-10">
        <header className="border-b border-line pb-8">
          <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[44px]">Request your quotes</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-[1.6] text-ink-muted">
            One request goes to all {activeInsurers.length} insurers on InsurShield at the same time. Each reviews your details and replies with its own final quote for you to compare.
          </p>
        </header>

        {requotedFromId && (
          <p className="mx-auto mt-6 flex max-w-3xl items-start gap-3 rounded-[1px] border border-primary/20 bg-primary/5 p-4 text-[14px] text-ink">
            <span className="material-symbols-outlined text-[22px] text-primary" aria-hidden="true">refresh</span>
            <span><strong>Fresh quotes for {requotedFromId}.</strong> Your previous quotes expired, so we've carried over your vehicle, value, usage and cover period. Check the details{missingPhotos.length ? ', retake the inspection photos (the earlier ones are too old to reuse),' : ''} and re-accept the declaration to send the request to all insurers again.</span>
          </p>
        )}

        <section aria-labelledby="estimates-heading" className="mt-8 rounded-[1px] border border-line bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="estimates-heading" className="text-[18px] font-semibold">Indicative premiums for your vehicle</h2>
              <p className="mt-1 text-[13px] text-ink-muted">
                Based on your declared value of <strong className="text-ink">{formatZMW(vehicleValue)}</strong>, <strong className="text-ink">{vehicleUsage || 'Individual'}</strong> use and each insurer's published rate. Every insurer below receives your request and replies with its final quote.
              </p>
            </div>
            <span className="rounded-[1px] bg-primary/[0.06] px-2.5 py-1 text-[11px] font-semibold uppercase text-primary">Estimates</span>
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {activeInsurers.map((insurer) => {
              const estimate = calculatePremium({ vehicleValueZMW: vehicleValue, insurer, vehicleUsage, coverageDurationId, coverageDays, piaRatePercentage: piaConfig?.piaRatePercentage });
              return (
                <li key={insurer.id} className="rounded-[1px] border border-line bg-canvas-2 p-4">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-ink"><span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">{insurer.icon || 'business'}</span>{insurer.name}</span>
                  <span className="mt-2 block whitespace-nowrap text-[20px] font-semibold tracking-[-.02em] text-primary">{formatZMW(estimate.finalPremium)}</span>
                  <span className="block text-[11px] text-ink-muted">{coverageDays ? `${coverageDays} days` : estimate.coverageDuration} · {insurer.ratePercentage}% rate</span>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
          <form onSubmit={handleSubmit} noValidate className="rounded-[1px] border border-line bg-white p-5 md:p-8">
            <h2 className="text-[20px] font-semibold">Cover period and contact details</h2>
            <p className="mt-1 text-[14px] text-ink-muted">Insurers use these to prepare your quote and to reach you about the policy you choose.</p>

            <div id="section-anniversary" className={`mt-5 rounded-[1px] border p-4 ${matchRtsaAnniversary ? 'border-primary/30 bg-primary/5' : 'border-line bg-white'}`}>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" checked={matchRtsaAnniversary} onChange={(e) => toggleRtsaAnniversary(e.target.checked)} />
                <span>
                  <span className="block text-[14px] font-medium text-ink">Match my policy start to the RTSA registration anniversary</span>
                  <span className="block text-[12px] text-ink-muted">Use the vehicle’s RTSA registration day and month as this year’s policy start date. Your cover period is then calculated from that anniversary.</span>
                </span>
              </label>
              {matchRtsaAnniversary && rtsaAnniversaryDate ? (
                <div className="mt-3 rounded-[1px] border border-primary/20 bg-white px-3 py-2 text-[13px] text-ink">
                  <span className="font-semibold text-primary">Using RTSA anniversary:</span> {formatDate(rtsaAnniversaryDate)}
                </div>
              ) : matchRtsaAnniversary && (
                <label className="mt-3 block sm:max-w-xs">
                  <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-ink-muted">RTSA registration date</span>
                  <input type="date" required max={today()} value={rtsaRegistrationDate} onChange={(e) => setRtsaAnniversary(true, e.target.value)} className={inputClass} />
                  {!rtsaRegistrationDate && <span className="mt-1 block text-[11px] text-primary">Enter the registration date shown on your White Book to match the anniversary.</span>}
                </label>
              )}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-ink-muted">Policy start date{matchRtsaAnniversary ? ' (from RTSA anniversary)' : ''}</span>
                <input required type="date" min={matchRtsaAnniversary ? undefined : today()} value={policyStartDate} onChange={(e) => setPolicyStartDate(e.target.value)} disabled={matchRtsaAnniversary && Boolean(rtsaRegistrationDate)} className={`${inputClass} disabled:cursor-not-allowed disabled:bg-canvas-2 disabled:text-ink-muted`} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-ink-muted">Cover period</span>
                <select value={coverageDurationId} onChange={(e) => setCoverageDuration(e.target.value)} className={inputClass}>
                  {COVERAGE_DURATION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-ink-muted">Full name</span>
                <input required value={contact.fullName} onChange={(e) => setContact({ ...contact, fullName: e.target.value })} autoComplete="name" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-ink-muted">Mobile number</span>
                <input required type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" className={inputClass} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-ink-muted">Email</span>
                <input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" className={inputClass} />
              </label>
            </div>

            {policyDates && (
              <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-[1px] bg-primary/5 px-4 py-3 text-[13px] text-primary">
                <span><strong>Starts</strong> {policyDates.formattedStart}</span>
                <span><strong>Ends</strong> {policyDates.formattedEnd}</span>
                <span><strong>Cover</strong> {policyDates.daysTotal} days{policyDates.anchoredToAnniversary && policyDates.daysTotal !== policyDates.standardDays ? ` (instead of ${policyDates.standardDays})` : ''}</span>
                {policyDates.anchoredToAnniversary && <span className="inline-flex items-center gap-1"><span className="material-symbols-outlined text-[16px]" aria-hidden="true">event_repeat</span>Aligned to RTSA anniversary ({policyDates.anniversaryLabel})</span>}
              </p>
            )}
            {policyDates?.hasEnded ? (
              <p role="alert" className="mt-3 flex items-start gap-2 rounded-[1px] border border-primary/30 bg-primary/[0.06] px-4 py-3 text-[13px] text-primary"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">error</span>{errors.anniversary}</p>
            ) : policyDates?.daysElapsed > 0 && (
              <p className="mt-3 flex items-start gap-2 rounded-[1px] border border-primary/30 bg-primary/[0.06] px-4 py-3 text-[13px] text-primary"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">history</span>This cover is backdated to the RTSA anniversary: {policyDates.daysElapsed} of its {policyDates.daysTotal} days have already passed, leaving {policyDates.daysRemaining} days of cover.</p>
            )}

            <section id="section-whiteBook" className="mt-7">
              <h2 className="text-[20px] font-semibold">Documents</h2>
              <p className="mt-1 text-[14px] text-ink-muted">Insurers need proof of ownership and current photos before they can commit to a final price.</p>
              <label className={`mt-4 flex cursor-pointer items-center gap-3 rounded-[1px] border-2 border-dashed p-4 transition-colors ${documents.whiteBook ? 'border-primary/40 bg-primary/5' : showErrors && errors.whiteBook ? 'border-primary/30 bg-primary/[0.06]' : 'border-line-strong bg-canvas-2 hover:border-primary/40'}`}>
                <span className={`material-symbols-outlined text-2xl ${documents.whiteBook ? 'text-primary' : 'text-primary'}`} aria-hidden="true">{documents.whiteBook ? 'check_circle' : 'upload_file'}</span>
                <span className="flex-1">
                  <span className="block text-[14px] font-medium text-primary">White Book</span>
                  <span className="text-[12px] text-ink-muted">{documents.whiteBook ? 'Added' : 'Required to verify vehicle ownership'}</span>
                </span>
                <span className="rounded-[1px] bg-white px-3 py-2 text-[12px] font-medium text-primary">{documents.whiteBook ? 'Replace' : 'Upload'}</span>
                <input className="sr-only" type="file" accept="image/*,.pdf" onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (file) setDocument('whiteBook', await fileDataUrl(file));
                }} />
              </label>
              <FieldError show={showErrors} message={errors.whiteBook} />
            </section>

            <section id="section-photos" className={`mt-5 rounded-[1px] border p-4 ${showErrors && errors.photos ? 'border-primary/30 bg-primary/[0.06]/40' : 'border-primary/15 bg-primary/5'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-primary" aria-hidden="true">photo_camera</span>
                  <div>
                    <h3 className="text-[14px] font-medium text-ink">Vehicle inspection photos</h3>
                    <p className="text-[12px] text-ink-muted">Upload all seven clear views, including the chassis number and car stereo.{mobileDevice ? (missingPhotos.length ? ' Open your camera to capture each view now.' : ' All seven live photos are ready to review below.') : ' Or continue on your phone for live camera capture.'}</p>
                  </div>
                </div>
                {!mobileDevice && <button type="button" onClick={() => setHandoffOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-[1px] border border-primary/35 bg-white px-3 text-[13px] font-medium text-primary hover:border-primary">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">qr_code_2</span>Capture live on my phone
                </button>}
              </div>
              <div className="mt-4">
                {mobileDevice && missingPhotos.length ? (
                  <GuidedCapture photos={inspectionPhotos} plate={vehicleDetails.plateNumber} onPhoto={setDocument} />
                ) : (
                  <InspectionPhotos photos={inspectionPhotos} plate={vehicleDetails.plateNumber} onPhoto={setDocument} onRemove={removePhoto} highlightMissing={showErrors && Boolean(errors.photos)} />
                )}
              </div>
              {!mobileDevice && !missingPhotos.length && (
                <button type="button" onClick={clearInspectionPhotos} className="mt-4 text-[12px] font-medium text-primary hover:underline">
                  Start a fresh set of seven photos
                </button>
              )}
              <FieldError show={showErrors} message={errors.photos} />
            </section>

            <div id="section-declaration" className="mt-6">
              <label className={`flex cursor-pointer items-start gap-3 rounded-[1px] border p-4 transition-colors ${declarationAccepted ? 'border-primary/30 bg-primary/5' : showErrors && errors.declaration ? 'border-primary/30 bg-primary/[0.06]' : 'border-line bg-white hover:border-primary/40'}`}>
                <input className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" type="checkbox" checked={declarationAccepted} onChange={(e) => setDeclarationAccepted(e.target.checked)} />
                <span className="text-[13px] leading-relaxed text-ink">
                  <strong>I confirm</strong> the vehicle and contact information is accurate, I am authorised to insure this vehicle, and I consent to InsurShield sharing these details with all its listed insurers solely to prepare quotations.
                </span>
              </label>
              <FieldError show={showErrors} message={errors.declaration} />
            </div>

            {sendError && <p role="alert" className="mt-6 rounded-[1px] border border-primary/30 bg-primary/5 px-4 py-3 text-[14px] text-primary">{sendError}</p>}

            {/* This form is several screens long on a phone. The action rides
                the bottom of the screen so sending is always one tap away,
                and returns to the flow of the page from tablet width up. */}
            <div className="sticky bottom-0 z-30 -mx-5 -mb-5 mt-6 border-t border-line bg-white/95 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-sm sm:static sm:m-0 sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
              <button type="submit" disabled={sending} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[1px] bg-primary text-[16px] font-medium text-white hover:bg-[#b91c1c] disabled:opacity-60">
                <span className={`material-symbols-outlined ${sending ? 'animate-spin' : ''}`} aria-hidden="true">{sending ? 'sync' : 'send'}</span>
                {sending ? 'Sending your request…' : `Send request to ${activeInsurers.length} insurers`}
              </button>
            </div>
          </form>

          <aside className="space-y-4 lg:sticky lg:top-24">
            <section className="rounded-[1px] border border-line bg-white p-5">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-muted">Your request</h2>
              <dl className="mt-3 space-y-2 text-[14px]">
                <Detail label="Vehicle" value={`${vehicleDetails.year || ''} ${vehicleDetails.make} ${vehicleDetails.model}`.trim()} />
                <Detail label="Plate" value={vehicleDetails.plateNumber || '—'} />
                <Detail label="Declared value" value={formatZMW(vehicleValue)} />
                <Detail label="Cover" value={insuranceType === 'ThirdParty' ? 'Third party only' : 'Comprehensive'} />
                <Detail label="Use" value={vehicleUsage || 'Individual'} />
              </dl>
              <button type="button" onClick={() => navigate('/vehicle-identification')} className="mt-3 text-[13px] font-medium text-primary hover:underline">Change vehicle details</button>
            </section>

          </aside>
        </div>
        </div>
      </motion.main>
      {handoffOpen && <PhoneHandoff
        plate={vehicleDetails.plateNumber}
        photos={inspectionPhotos}
        journey={{
          vehicleDetails,
          vehicleValue,
          vehicleUsage,
          insuranceType,
          coverageDurationId,
          policyStartDate,
          matchRtsaAnniversary,
          rtsaRegistrationDate,
          documents: { whiteBook: documents.whiteBook || null },
          contact,
        }}
        onPhotos={receivePhotos}
        onClose={closeHandoff}
      />}
    </>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

function FieldError({ show, message }) {
  if (!show || !message) return null;
  return (
    <p role="alert" className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-primary">
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">error</span>{message}
    </p>
  );
}
