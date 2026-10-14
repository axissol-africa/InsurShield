import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, FolderOpen } from 'lucide-react';
import { useStore, useActiveInsurers } from '@/store';
import { submitQuoteRequest } from '@/features/quote-journey/submitRequest';
import { calculatePolicyDates, calculatePremium, formatDate, formatZMW } from '@/domain/premiumEngine';
import { COVERAGE_DURATION_OPTIONS } from '@/domain/insurers';
import JourneyLayout from '@/features/quote-journey/components/JourneyLayout';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/primitives/card';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { Checkbox } from '@/components/ui/primitives/checkbox';
import { NativeSelect } from '@/components/ui/primitives/native-select';
import { Alert, AlertDescription } from '@/components/ui/primitives/alert';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/primitives/accordion';
import InspectionPhotos from '@/features/quote-journey/components/InspectionPhotos';
import GuidedCapture from '@/features/quote-journey/components/GuidedCapture';
import PhoneHandoff from '@/features/quote-journey/components/PhoneHandoff';
import { INSPECTION_SHOTS, missingInspectionShots } from '@/domain/inspection';
import { isMobileDevice } from '@/lib/device';
import { captureApi } from '@/api/capture';

const fileDataUrl = (file) =>
  new Promise((resolve, reject) => {
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
    vehicleValue,
    vehicleUsage,
    vehicleDetails,
    insuranceType,
    documents,
    customer,
    coverageDurationId,
    setCoverageDuration,
    policyStartDate,
    setPolicyStartDate,
    setDocument,
    setDocuments,
    matchRtsaAnniversary,
    rtsaRegistrationDate,
    setRtsaAnniversary,
    piaConfig,
    requotedFromId,
    setVehicleDetails,
    setVehicleValue,
    setVehicleUsage,
    setInsuranceType,
  } = useStore();
  const [handoffOpen, setHandoffOpen] = useState(false);
  const priorPolicyStartDate = useRef(policyStartDate);
  const resumedCaptureCode = useRef('');

  const [contact, setContact] = useState({
    fullName: customer?.fullName || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
  });
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [resuming, setResuming] = useState(Boolean(captureCode));
  const [resumeError, setResumeError] = useState('');

  const activeInsurers = useActiveInsurers();
  const mobileDevice = isMobileDevice();
  const rtsaAnniversaryDate =
    vehicleDetails?.rtsaAnniversaryDate ||
    legacyRoadTaxDate(vehicleDetails?.roadTaxExpiry) ||
    vehicleDetails?.registrationDate ||
    '';
  const selectedRtsaAnniversary = rtsaAnniversaryDate || rtsaRegistrationDate;
  const anniversaryDate = matchRtsaAnniversary ? selectedRtsaAnniversary : undefined;
  const policyDates = useMemo(
    () => calculatePolicyDates(policyStartDate, coverageDurationId, { anniversaryDate }),
    [policyStartDate, coverageDurationId, anniversaryDate],
  );
  const coverageDays = policyDates?.anchoredToAnniversary ? policyDates.daysTotal : null;
  const missingPhotos = missingInspectionShots(documents);
  const inspectionPhotos = useMemo(
    () => Object.fromEntries(INSPECTION_SHOTS.map((shot) => [shot.key, documents[shot.key]])),
    [documents],
  );
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
    if (typeof documents.whiteBook === 'string' && documents.whiteBook.startsWith('blob:'))
      setDocument('whiteBook', null);
  }, [documents.whiteBook, setDocument]);

  useEffect(() => {
    if (!captureCode || resumedCaptureCode.current === captureCode) return undefined;
    let cancelled = false;
    setResuming(true);
    captureApi
      .get(captureCode)
      .then((session) => {
        if (cancelled) return;
        const draft = session.journey;
        if (!draft)
          throw new Error(
            'This phone hand-off does not contain a quote to continue. Start a new phone capture from your computer.',
          );
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
    return () => {
      cancelled = true;
    };
  }, [
    captureCode,
    setCoverageDuration,
    setDocuments,
    setInsuranceType,
    setPolicyStartDate,
    setRtsaAnniversary,
    setVehicleDetails,
    setVehicleUsage,
    setVehicleValue,
  ]);

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
    anniversary:
      matchRtsaAnniversary && !selectedRtsaAnniversary
        ? 'Enter the RTSA registration date, or untick the anniversary option.'
        : policyDates?.hasEnded
          ? `Cover from ${policyDates.formattedStart} for this period would already have ended on ${policyDates.formattedEnd}. Choose a longer cover period or untick RTSA matching.`
          : null,
    whiteBook: documents.whiteBook ? null : 'Add your White Book so insurers can verify ownership.',
    photos: missingPhotos.length
      ? `Capture ${missingPhotos.length} more inspection photo${missingPhotos.length === 1 ? '' : 's'}.`
      : null,
    declaration: declarationAccepted ? null : 'Accept the declaration to send your request.',
  };
  const firstError = Object.keys(errors).find((key) => errors[key]);
  const missingVehicle = !vehicleDetails || !vehicleValue;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (firstError) {
      setShowErrors(true);
      const section = document.getElementById(`section-${firstError}`);
      const control = section?.querySelector('input:not([disabled]), button, select');
      (control || section)?.focus({ preventScroll: true });
      section?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      <JourneyLayout step={4} title="Restoring your quote">
        <p role="status">Restoring your quote on this phone…</p>
      </JourneyLayout>
    );
  }

  if (resumeError || missingVehicle) {
    return (
      <JourneyLayout
        step={4}
        title={resumeError ? 'This phone link is no longer available' : "Let's start with your vehicle"}
        description={
          resumeError || 'We need your cover choice, vehicle details and declared value before insurers can quote.'
        }
      >
        <Button onClick={() => navigate('/insurance-type')}>Start a quote</Button>
      </JourneyLayout>
    );
  }

  return (
    <>
      <JourneyLayout
        step={4}
        title="Request your quotes"
        description={`Review your details and documents first. Then compare the published cover guides from ${activeInsurers.length} insurers before choosing who should prepare a final quote.`}
        className="max-w-6xl"
      >
        {requotedFromId && (
          <Alert className="mb-6">
            <AlertDescription>
              <p>
                <strong>Fresh quotes for {requotedFromId}.</strong> Your previous quotes expired. Check the details
                {missingPhotos.length ? ', retake the inspection photos,' : ''} and re-accept the declaration to request
                new quotes.
              </p>
            </AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
        >
          <div className="min-w-0 space-y-6">
            <Card className="border border-primary/20 shadow-sm">
              <CardHeader className="border-b border-primary/10 bg-primary/[0.025]">
                <CardTitle>
                  <h2 className="flex items-center gap-2 text-primary">
                    <CalendarDays aria-hidden="true" className="size-5" />
                    Cover period and contact details
                  </h2>
                </CardTitle>
                <CardDescription>Choose your dates and tell insurers how to reach you.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div id="section-anniversary" tabIndex={-1} className="space-y-3 rounded-xl border border-primary/15 bg-primary/[0.035] p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox
                      className="mt-1 border-primary/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                      checked={matchRtsaAnniversary}
                      onCheckedChange={(checked) => toggleRtsaAnniversary(checked === true)}
                    />
                    <span>
                      <span className="block font-medium text-primary">
                        Match my policy start to the RTSA registration anniversary
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        Use the registration day and month as this year's policy start date.
                      </span>
                    </span>
                  </label>
                  {matchRtsaAnniversary && rtsaAnniversaryDate ? (
                    <p className="rounded-lg bg-background/80 px-3 py-2 text-sm">
                      <span className="text-primary">Using RTSA anniversary:</span>{' '}
                      <strong>{formatDate(rtsaAnniversaryDate)}</strong>
                    </p>
                  ) : (
                    matchRtsaAnniversary && (
                      <label className="block space-y-2">
                        <span className="text-sm font-medium">RTSA registration date</span>
                        <Input
                          type="date"
                          required
                          max={today()}
                          value={rtsaRegistrationDate}
                          onChange={(event) => setRtsaAnniversary(true, event.target.value)}
                        />
                      </label>
                    )
                  )}
                  <FieldError show={showErrors} message={!policyDates?.hasEnded && errors.anniversary} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-primary">
                      Policy start date{matchRtsaAnniversary ? ' (from RTSA anniversary)' : ''}
                    </span>
                    <Input
                      required
                      type="date"
                      min={matchRtsaAnniversary ? undefined : today()}
                      value={policyStartDate}
                      onChange={(event) => setPolicyStartDate(event.target.value)}
                      disabled={matchRtsaAnniversary && Boolean(rtsaRegistrationDate)}
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-primary">Cover period</span>
                    <NativeSelect
                      className="w-full"
                      value={coverageDurationId}
                      onChange={(event) => setCoverageDuration(event.target.value)}
                    >
                      {COVERAGE_DURATION_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="block space-y-2 sm:col-span-2">
                    <span className="text-sm font-medium">Full name</span>
                    <Input
                      required
                      value={contact.fullName}
                      onChange={(event) => setContact({ ...contact, fullName: event.target.value })}
                      autoComplete="name"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Mobile number</span>
                    <Input
                      required
                      type="tel"
                      value={contact.phone}
                      onChange={(event) => setContact({ ...contact, phone: event.target.value })}
                      autoComplete="tel"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Email</span>
                    <Input
                      type="email"
                      value={contact.email}
                      onChange={(event) => setContact({ ...contact, email: event.target.value })}
                      autoComplete="email"
                    />
                  </label>
                </div>
                {policyDates && (
                  <dl className="grid gap-3 rounded-xl border border-primary/15 bg-primary/[0.035] p-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-primary">Starts</dt>
                      <dd className="mt-1 font-semibold">{policyDates.formattedStart}</dd>
                    </div>
                    <div>
                      <dt className="text-primary">Ends</dt>
                      <dd className="mt-1 font-semibold">{policyDates.formattedEnd}</dd>
                    </div>
                    <div>
                      <dt className="text-primary">Cover</dt>
                      <dd className="mt-1 font-semibold">{policyDates.daysTotal} days</dd>
                    </div>
                  </dl>
                )}
                {policyDates?.hasEnded ? (
                  <Alert variant="destructive">
                    <AlertDescription>{errors.anniversary}</AlertDescription>
                  </Alert>
                ) : (
                  policyDates?.daysElapsed > 0 && (
                    <Alert>
                      <AlertDescription>
                        This cover is backdated to the RTSA anniversary: {policyDates.daysElapsed} of its{' '}
                        {policyDates.daysTotal} days have already passed, leaving {policyDates.daysRemaining} days of
                        cover.
                      </AlertDescription>
                    </Alert>
                  )
                )}
              </CardContent>
            </Card>
            <Card className="border border-primary/20 shadow-sm">
              <CardHeader className="border-b border-primary/10 bg-primary/[0.025]">
                <CardTitle>
                  <h2 className="flex items-center gap-2 text-primary">
                    <FolderOpen aria-hidden="true" className="size-5" />
                    Documents and vehicle photos
                  </h2>
                </CardTitle>
                <CardDescription>
                  Insurers need proof of ownership and all seven clear views to prepare a final quote.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <section id="section-whiteBook" tabIndex={-1} className="rounded-xl border border-primary/15 bg-primary/[0.035] p-4">
                  <label className="block space-y-2">
                    <span className="font-medium text-primary">White Book</span>
                    <span className="block text-sm text-muted-foreground">
                      {documents.whiteBook
                        ? 'Added. Choose another file to replace it.'
                        : 'Upload an image or PDF to verify vehicle ownership.'}
                    </span>
                    <Input
                      aria-invalid={showErrors && Boolean(errors.whiteBook)}
                      type="file"
                      accept="image/*,.pdf"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        try {
                          setDocument('whiteBook', await fileDataUrl(file));
                          setSendError('');
                        } catch (error) {
                          setSendError(error.message);
                        }
                      }}
                    />
                  </label>
                  <FieldError show={showErrors} message={errors.whiteBook} />
                </section>
                <section id="section-photos" tabIndex={-1} className="border-t border-primary/10 pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-primary">Vehicle inspection photos</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {7 - missingPhotos.length} of 7 photos added. Include the chassis number and car stereo.
                      </p>
                    </div>
                    {!mobileDevice && (
                      <Button type="button" variant="outline" className="border-primary text-primary hover:bg-primary/10 hover:text-primary" onClick={() => setHandoffOpen(true)}>
                        Capture live on my phone
                      </Button>
                    )}
                  </div>
                  <div className="mt-4">
                    {mobileDevice && missingPhotos.length ? (
                      <GuidedCapture
                        photos={inspectionPhotos}
                        plate={vehicleDetails.plateNumber}
                        onPhoto={setDocument}
                      />
                    ) : (
                      <InspectionPhotos
                        photos={inspectionPhotos}
                        plate={vehicleDetails.plateNumber}
                        onPhoto={setDocument}
                        onRemove={removePhoto}
                        highlightMissing={showErrors && Boolean(errors.photos)}
                      />
                    )}
                  </div>
                  {!mobileDevice && !missingPhotos.length && (
                    <Button type="button" variant="link" className="mt-3 px-0" onClick={clearInspectionPhotos}>
                      Start a fresh set of seven photos
                    </Button>
                  )}
                  <FieldError show={showErrors} message={errors.photos} />
                </section>
              </CardContent>
            </Card>
          </div>
          <aside className="lg:sticky lg:top-24">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Your request</h2>
                </CardTitle>
                <CardDescription>Check these details before sending.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3 text-sm">
                  <Detail
                    label="Vehicle"
                    value={`${vehicleDetails.year || ''} ${vehicleDetails.make} ${vehicleDetails.model}`.trim()}
                  />
                  <Detail label="Plate" value={vehicleDetails.plateNumber || '—'} />
                  <Detail label="Declared value" value={formatZMW(vehicleValue)} />
                  <Detail label="Cover" value={insuranceType === 'ThirdParty' ? 'Third party only' : 'Comprehensive'} />
                  <Detail label="Use" value={vehicleUsage || 'Individual'} />
                </dl>
                <Button
                  type="button"
                  variant="link"
                  className="mt-3 px-0"
                  onClick={() => navigate('/vehicle-identification')}
                >
                  Change vehicle details
                </Button>
                <Accordion type="single" collapsible defaultValue="estimates" className="mt-4 border-t">
                  <AccordionItem value="estimates">
                    <AccordionTrigger>Indicative premiums for your vehicle</AccordionTrigger>
                    <AccordionContent className="h-auto">
                      <p className="mb-4 text-sm text-muted-foreground">
                        Estimates based on your declared value and each insurer's published rate. Final quotes may
                        differ.
                      </p>
                      <dl className="space-y-3">
                        {activeInsurers.map((insurer) => {
                          const estimate = calculatePremium({
                            vehicleValueZMW: vehicleValue,
                            insurer,
                            vehicleUsage,
                            coverageDurationId,
                            coverageDays,
                            piaRatePercentage: piaConfig?.piaRatePercentage,
                          });
                          return (
                            <div key={insurer.id} className="flex flex-wrap justify-between gap-2 text-sm">
                              <dt>{insurer.name}</dt>
                              <dd className="font-medium">{formatZMW(estimate.finalPremium)}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>
          </aside>
          <Card className="lg:col-start-1">
            <CardHeader>
              <CardTitle>
                <h2>Review and see cover guides</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div id="section-declaration" tabIndex={-1}>
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    className="mt-1"
                    checked={declarationAccepted}
                    onCheckedChange={(checked) => setDeclarationAccepted(checked === true)}
                    aria-invalid={showErrors && Boolean(errors.declaration)}
                  />
                  <span className="text-sm leading-relaxed">
                    <strong>I confirm</strong> the vehicle and contact information is accurate, I am authorised to
                    insure this vehicle, and I consent to InsurShield using these details to prepare the cover-guide
                    comparison and to share them only with insurers I choose for a final quotation.
                  </span>
                </label>
                <FieldError show={showErrors} message={errors.declaration} />
              </div>
              {sendError && (
                <Alert variant="destructive">
                  <AlertDescription>{sendError}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={sending} className="h-12 w-full">
                {sending ? 'Preparing cover guides…' : `See cover guides from ${activeInsurers.length} insurers`}
              </Button>
            </CardContent>
          </Card>
        </form>
      </JourneyLayout>
      {handoffOpen && (
        <PhoneHandoff
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
        />
      )}
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
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        error
      </span>
      {message}
    </p>
  );
}
