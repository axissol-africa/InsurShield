import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, useActiveInsurers, belongsToCustomer } from '@/store';
import { motion } from 'framer-motion';
import Meta from '@/components/ui/Meta';
import Badge from '@/components/ui/Badge';
import { api } from '@/api';
import { hydrateCustomer, hydrateDirectory } from '@/api/sync';
import { formatZMW, formatDate } from '@/domain/premiumEngine';

const CLAIM_TYPES = [
  'Accident / Collision', 'Theft', 'Fire Damage', 'Natural Disaster',
  'Third Party Liability', 'Windscreen Damage', 'Medical Expenses', 'Towing & Recovery',
  'Other',
];

/** A claim only goes through first notification here; the insurer handles everything after the call. */
// Status is carried by the shared badge, so a claim here reads the same as a
// policy, a quote or an NCD application anywhere else in the product.
const CLAIM_STATUSES = {
  Notified: 'muted',
  'Received by insurer': 'default',
};

const NCD_TIERS = [
  { years: 1, percentage: 10 }, { years: 2, percentage: 20 },
  { years: 3, percentage: 30 }, { years: 4, percentage: 40 },
];

const NCD_APPLICATION_STATUSES = [
  { id: 'Submitted', variant: 'muted' },
  { id: 'Under Review', variant: 'warning' },
  { id: 'Verification Required', variant: 'warning' },
  { id: 'Approved', variant: 'success' },
  { id: 'Rejected', variant: 'outline' },
];

const CLAIM_DOCUMENT_GUIDANCE = [
  'Completed claim form',
  'Copy of the driver\'s licence',
  'Police report or case reference (for accidents, theft, or malicious damage)',
  'Vehicle registration / White Book',
  'Accident photos and repair quotation, where available',
];

// Seeded so the demo customer already has one notification on record.
// ─── Sub-components ──────────────────────────────────────────────────────────


function CopyButton({ value, className = '' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button type="button" onClick={copy} className={`inline-flex items-center gap-2 rounded-[1px] px-4 py-2 text-[13px] font-medium transition-colors ${className}`}>
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>{copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Insurer claims-desk contact with one-tap call / WhatsApp. */
function InsurerCallCard({ insurerName, contact, claimNumber }) {
  const message = encodeURIComponent(`Hello, I am notifying a motor claim. My InsurShield claim number is ${claimNumber}.`);
  return (
    <section className="rounded-[1px] border border-line bg-white p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">Call your insurer</p>
      <h2 className="mt-1 text-[20px] font-semibold text-primary">{insurerName}</h2>
      {contact ? (
        <>
          <p className="mt-1 text-[13px] text-ink-muted">{contact.contactPerson} · {contact.role}</p>
          <div className="mt-4 grid gap-2">
            <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="flex min-h-12 items-center justify-center gap-2 rounded-[1px] bg-primary px-4 text-[15px] font-medium text-white hover:bg-[#b91c1c]">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">call</span>{contact.phone}
            </a>
            <a href={`https://wa.me/${contact.whatsapp}?text=${message}`} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-[1px] border-2 border-primary px-4 text-[15px] font-medium text-primary hover:bg-primary/5">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">chat</span>WhatsApp
            </a>
          </div>
          <dl className="mt-4 space-y-1.5 text-[13px] text-ink-muted">
            <div className="flex gap-2"><dt className="w-16 shrink-0 font-medium text-ink-muted">Hours</dt><dd>{contact.hours}</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 font-medium text-ink-muted">Email</dt><dd><a href={`mailto:${contact.email}`} className="text-primary hover:underline">{contact.email}</a></dd></div>
          </dl>
        </>
      ) : (
        <p className="mt-2 text-[13px] text-ink-muted">Contact details for this insurer are in the <Link to="/support" className="font-medium text-primary hover:underline">insurer directory</Link>.</p>
      )}
    </section>
  );
}

/** Shown right after a claim is submitted: the claim number and the hand-off to the insurer. */
function ClaimHandoff({ claim, contact, onDone }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-3xl px-5 py-10 pb-24 sm:px-8">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/5"><span className="material-symbols-outlined text-4xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">check_circle</span></div>
        <h1 className="text-[30px] font-semibold tracking-[-.03em] text-ink">Your claim number is ready</h1>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-ink-muted">InsurShield's part is done. Call {claim.insurer} now and quote this number — they will open the claim and handle the assessment and settlement with you directly.</p>
      </div>

      <div className="mt-7 rounded-[1px] bg-primary p-6 text-center text-white shadow-primary/20">
        <p className="text-[12px] font-medium uppercase tracking-widest text-white/70">Claim number</p>
        <p className="mt-2 font-mono text-[36px] font-semibold tracking-widest sm:text-[44px]">{claim.claimNumber}</p>
        <CopyButton value={claim.claimNumber} className="mt-3 bg-white/20 text-white hover:bg-white/30" />
        <p className="mt-3 text-[12px] text-white/75">Also saved under Claims in your account.</p>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-[1fr_1fr]">
        <InsurerCallCard insurerName={claim.insurer} contact={contact} claimNumber={claim.claimNumber} />
        <section className="rounded-[1px] border border-line bg-white p-5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">Have ready when you call</p>
          <ul className="mt-3 space-y-2 text-[14px] text-ink">
            {[
              ['confirmation_number', `Claim number ${claim.claimNumber}`],
              ['directions_car', `Vehicle plate ${claim.plate}`],
              ['event', `Incident date ${formatDate(claim.incidentDate)}`],
              claim.policeReport ? ['local_police', `Police report ${claim.policeReportNumber || 'reference'}`] : null,
              ['badge', 'Your NRC or driver\'s licence'],
            ].filter(Boolean).map(([icon, text]) => (
              <li key={text} className="flex items-center gap-3"><span className="material-symbols-outlined text-[20px] text-primary" aria-hidden="true">{icon}</span>{text}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-6 flex justify-center">
        <button type="button" onClick={onDone} className="min-h-12 rounded-[1px] border border-line-strong bg-white px-6 font-semibold text-primary hover:bg-canvas-2">Back to my claims</button>
      </div>
    </motion.div>
  );
}

function SuccessBanner({ refNumber, onDone }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto max-w-lg px-4 py-12 text-center">
      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary/5"><span className="material-symbols-outlined text-4xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">check_circle</span></div>
      <h2 className="text-[26px] font-semibold text-primary">NCD application submitted</h2>
      <p className="mt-2 text-[14px] text-ink-muted">Your application has been sent to the insurer. You can follow it under NCD applications in your account.</p>
      <div className="mt-6 rounded-[1px] bg-primary p-6 text-white">
        <p className="text-[12px] font-medium uppercase tracking-widest text-white/70">Application number</p>
        <p className="mt-1 font-mono text-[30px] font-semibold tracking-widest">{refNumber}</p>
        <CopyButton value={refNumber} className="mt-3 bg-white/20 text-white hover:bg-white/30" />
      </div>
      <button type="button" onClick={onDone} className="mt-6 w-full rounded-[1px] bg-primary py-3 font-semibold text-white hover:bg-[#b91c1c]">View my applications</button>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ClaimsPage() {
  const navigate = useNavigate();
  const { claims, vehicleDetails, ncdApplications, customer, policies } = useStore();
  const insurers = useActiveInsurers();

  // Claims, NCD applications and the insurer list come from the server when
  // one is configured; in mock mode these calls are no-ops.
  useEffect(() => { void hydrateDirectory(); void hydrateCustomer(); }, []);

  const insurerName = (id) => insurers.find((insurer) => insurer.id === id)?.name ?? '';
  const insurerContact = (name) => insurers.find((insurer) => insurer.name === name)?.contact ?? null;

  // Main tab
  const [mainTab, setMainTab] = useState('claims');
  // Sub-view per tab: 'list' | 'new' | 'track' | 'detail' | 'success'
  const [claimView, setClaimView] = useState('list');
  const [ncdView, setNcdView] = useState('list');

  const [selectedClaim, setSelectedClaim] = useState(null);
  const [selectedNcdApp, setSelectedNcdApp] = useState(null);
  const [submittedClaim, setSubmittedClaim] = useState(null);
  const [submittedRef, setSubmittedRef] = useState(null);

  // Claim form state
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [docItems, setDocItems] = useState([]); // dynamic supporting docs
  const [plateScanning, setPlateScanning] = useState(false);
  const [plateLookupResult, setPlateLookupResult] = useState(null); // { insurer, coverage, plate } | null
  const [coverageMismatch, setCoverageMismatch] = useState(null); // error string | null
  const [claimError, setClaimError] = useState('');
  const [claimForm, setClaimForm] = useState({
    insurer: '', insurerId: '', type: '', incidentDate: '', location: '',
    description: '', policeReport: false, policeReportNumber: '',
    estimatedLoss: '', phone: customer?.phone || '', fullName: customer?.fullName || '', lateReason: '',
    plateNumber: '', coverageType: '',
  });

  // NCD form state
  const [ncdSubmitting, setNcdSubmitting] = useState(false);
  const [ncdDeclarationError, setNcdDeclarationError] = useState('');
  const [ncdError, setNcdError] = useState('');
  const [ncdForm, setNcdForm] = useState({
    insurer: '', insurerId: '', policyNumber: '', yearsClaimFree: '', phone: '', fullName: '', declaration: false,
  });

  const setClaimField = (k, v) => setClaimForm(prev => ({ ...prev, [k]: v }));
  const setNcdField = (k, v) => setNcdForm(prev => ({ ...prev, [k]: v }));

  // 14-day window helpers
  const getDaysSinceIncident = (dateStr) => {
    if (!dateStr) return null;
    const incident = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    incident.setHours(0, 0, 0, 0);
    return Math.floor((today - incident) / 86400000);
  };
  const daysSinceIncident = getDaysSinceIncident(claimForm.incidentDate);
  const isLate = daysSinceIncident !== null && daysSinceIncident > 14;
  const isSubmitBlocked = isLate && !claimForm.lateReason.trim();

  const allClaims = claims;
  const allNcdApps = ncdApplications;
  const mine = belongsToCustomer(customer);

  // ─── Handlers ───────────────────────────────────────────────
  const handleSubmitClaim = async (e) => {
    e.preventDefault();
    if (coverageMismatch) return;
    setClaimSubmitting(true);
    setClaimError('');
    try {
      // Supporting evidence is stored first, then referenced by the claim.
      const supportingDocumentIds = (
        await Promise.all(docItems.filter(item => item.file).map(item => api.documents.upload(item.file, 'CLAIM_ATTACHMENT')))
      ).map(document => document.id);

      const claim = await api.claims.notify({
        insurerId: claimForm.insurerId,
        policyNumber: claimForm.policyNumber || undefined,
        fullName: claimForm.fullName,
        phone: claimForm.phone,
        email: customer?.email || undefined,
        plate: claimForm.plateNumber || vehicleDetails?.plateNumber || 'N/A',
        vehicle: vehicleDetails ? `${vehicleDetails.year} ${vehicleDetails.make} ${vehicleDetails.model}` : 'Your vehicle',
        type: claimForm.type,
        incidentDate: claimForm.incidentDate,
        location: claimForm.location,
        description: claimForm.description,
        estimatedLoss: claimForm.estimatedLoss ? Number(claimForm.estimatedLoss) : undefined,
        policeReport: claimForm.policeReport,
        policeReportNumber: claimForm.policeReportNumber || undefined,
        lateReason: claimForm.lateReason || undefined,
        supportingDocumentIds,
      });

      await hydrateCustomer();
      setSubmittedClaim({ ...claim, insurer: claim.insurer || claimForm.insurer });
      setClaimForm({ insurer: '', insurerId: '', type: '', incidentDate: '', location: '', description: '', policeReport: false, policeReportNumber: '', estimatedLoss: '', phone: customer?.phone || '', fullName: customer?.fullName || '', lateReason: '', plateNumber: '', coverageType: '' });
      setDocItems([]);
      setPlateLookupResult(null);
      setCoverageMismatch(null);
      setClaimView('success');
    } catch (error) {
      setClaimError(error.message || 'Your claim could not be submitted. Please try again.');
    } finally {
      setClaimSubmitting(false);
    }
  };

  const handleSubmitNcd = async (e) => {
    e.preventDefault();
    if (!ncdForm.declaration) { setNcdDeclarationError('Please acknowledge the declaration before submitting.'); return; }
    setNcdDeclarationError('');
    setNcdSubmitting(true);
    setNcdError('');
    try {
      const application = await api.ncd.apply({
        insurerId: ncdForm.insurerId,
        policyNumber: ncdForm.policyNumber,
        fullName: ncdForm.fullName,
        phone: ncdForm.phone,
        yearsClaimFree: parseInt(ncdForm.yearsClaimFree, 10),
      });
      await hydrateCustomer();
      setSubmittedRef(application.applicationNumber);
      setNcdForm({ insurer: '', insurerId: '', policyNumber: '', yearsClaimFree: '', phone: '', fullName: '', declaration: false });
      setNcdView('success');
    } catch (error) {
      setNcdError(error.message || 'Your application could not be submitted. Please try again.');
    } finally {
      setNcdSubmitting(false);
    }
  };


  // ═══════════════════════════════════════════════════════════════
  // VIEWS: Claims
  // ═══════════════════════════════════════════════════════════════

  // ── Success ──
  if (mainTab === 'claims' && claimView === 'success' && submittedClaim) {
    return <ClaimHandoff claim={submittedClaim} contact={insurerContact(submittedClaim.insurer)} onDone={() => setClaimView('list')} />;
  }

  // ── New Claim Form ──
  if (mainTab === 'claims' && claimView === 'new') {

    // Plate lookup: a policy bought through InsurShield is authoritative;
    // otherwise the prototype returns a plausible policy with a platform insurer.
    const MAKES = ['Toyota Hilux', 'Toyota Corolla', 'Nissan Navara', 'Ford Ranger', 'BMW X5', 'Isuzu D-Max', 'Mazda CX-5', 'Honda CR-V'];
    const YEARS = ['2018', '2019', '2020', '2021', '2022', '2023'];

    const handlePlateLookup = () => {
      const plate = claimForm.plateNumber.trim().toUpperCase();
      if (!plate) return;
      setPlateScanning(true);
      setPlateLookupResult(null);
      setCoverageMismatch(null);
      setTimeout(() => {
        setPlateScanning(false);
        const ownPolicy = policies.find(policy => (policy.vehicleDetails?.plateNumber || '').toUpperCase() === plate);
        let result;
        if (ownPolicy) {
          const coverage = /third/i.test(ownPolicy.coverage || '') ? 'Third Party' : 'Comprehensive';
          result = { insurer: ownPolicy.insurer, insurerId: insurers.find((item) => item.name === ownPolicy.insurer)?.id ?? '', coverage, make: ownPolicy.vehicle, year: '', plate };
        } else {
          const hash = plate.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
          const insurer = insurers[hash % insurers.length];
          result = { insurer: insurer?.name ?? '', insurerId: insurer?.id ?? '', coverage: hash % 3 === 0 ? 'Third Party' : 'Comprehensive', make: MAKES[hash % MAKES.length], year: YEARS[(hash + 3) % YEARS.length], plate };
        }
        setPlateLookupResult(result);
        setClaimForm((prev) => ({ ...prev, insurer: result.insurer, insurerId: result.insurerId }));
      }, 1200);
    };

    const handleCoverageChange = (val) => {
      setClaimField('coverageType', val);
      if (plateLookupResult && !plateLookupResult.notFound && val) {
        if (val !== plateLookupResult.coverage) {
          setCoverageMismatch(
            `This vehicle (${plateLookupResult.plate}) is insured under ${
 plateLookupResult.coverage
 } with ${plateLookupResult.insurer}. A claim cannot be submitted under ${val} coverage.`
          );
        } else {
          setCoverageMismatch(null);
        }
      } else {
        setCoverageMismatch(null);
      }
    };

    const addDocItem = () => setDocItems(prev => [...prev, { id: Date.now(), name: '', file: null }]);
    const removeDocItem = (id) => setDocItems(prev => prev.filter(d => d.id !== id));
    const updateDocName = (id, name) => setDocItems(prev => prev.map(d => d.id === id ? { ...d, name } : d));
    const updateDocFile = (id, file) => setDocItems(prev => prev.map(d => d.id === id ? { ...d, file } : d));

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto px-4 py-10 pb-24">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setClaimView('list')} className="p-2 hover:bg-canvas-2 rounded-full transition-colors">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h1 className="text-[24px] font-medium text-primary">Start a claim</h1>
            <p className="text-[13px] text-ink-muted">This is the first notification. You get a claim number immediately, then call your insurer to continue.</p>
          </div>
        </div>

        <form onSubmit={handleSubmitClaim} className="space-y-5">

          {/* 14-Day Rule Banner */}
          <div className="bg-primary/[0.06] border-2 border-primary/30 rounded-[1px] p-5 flex items-start gap-4">
            <div className="w-12 h-12 bg-primary/[0.06] rounded-[1px] flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-primary text-2xl">timer</span>
            </div>
            <div>
              <p className="font-semibold text-primary text-[15px]">14-Day Claim Submission Rule</p>
              <p className="text-[13px] text-primary mt-1 leading-relaxed">
                Claims must be submitted <strong>within 14 days of the incident</strong>. Claims received after this window will
                not be processed unless a valid written reason for the delay is provided.
              </p>
            </div>
          </div>

          {/* ─── SECTION 1: Contact ─── */}
          <div className="bg-white rounded-[1px] border border-line p-6 space-y-4">
            <h3 className="font-medium text-[15px] border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-medium">1</span>
              Your Contact Details
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Full Name *</label>
                <input required value={claimForm.fullName} onChange={e => setClaimField('fullName', e.target.value)}
                  placeholder="e.g. Mwiza Banda"
                  className="w-full bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Mobile Number *</label>
                <input required type="tel" value={claimForm.phone} onChange={e => setClaimField('phone', e.target.value)}
                  placeholder="e.g. 0970 123 456"
                  className="w-full bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
                <p className="text-[11px] text-ink-muted mt-1">Must match the number on your policy — the insurer will call you back on it.</p>
              </div>
            </div>
          </div>

          {/* ─── SECTION 2: Vehicle Verification ─── */}
          <div className="bg-white rounded-[1px] border border-line p-6 space-y-4">
            <h3 className="font-medium text-[15px] border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-medium">2</span>
              Vehicle & Policy Verification
            </h3>

            {/* Plate Number */}
            <div>
              <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Vehicle Registration / Plate Number *</label>
              <div className="flex gap-2">
                <input
                  required
                  value={claimForm.plateNumber}
                  onChange={e => { setClaimField('plateNumber', e.target.value.toUpperCase()); setPlateLookupResult(null); setCoverageMismatch(null); }}
                  placeholder="e.g. BAA 1234"
                  className="flex-1 bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] font-mono uppercase tracking-widest focus:ring-2 focus:ring-primary outline-none"
                />
                <button
                  type="button"
                  onClick={handlePlateLookup}
                  disabled={!claimForm.plateNumber.trim() || plateScanning}
                  className="flex items-center gap-2 bg-primary text-white font-medium px-4 py-3 rounded-[1px] transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint disabled:hover:bg-canvas text-[13px] flex-shrink-0"
                >
                  {plateScanning
                    ? <><span className="material-symbols-outlined animate-spin text-[18px]">sync</span> Scanning...</>
                    : <><span className="material-symbols-outlined text-[18px]">document_scanner</span> Verify</>}
                </button>
              </div>

              {/* Plate Lookup Result */}
              {plateLookupResult && !plateLookupResult.notFound && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                  className="mt-3 bg-primary/5 border border-primary/20 rounded-[1px] p-4 flex items-start gap-3">
                  <span className="material-symbols-outlined text-primary text-[20px] mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                  <div>
                    <p className="font-medium text-[13px] text-primary">Policy Found — {plateLookupResult.plate}</p>
                    <p className="text-[12px] text-ink-muted mt-0.5">
                      {plateLookupResult.year} {plateLookupResult.make} · Insurer: <strong>{plateLookupResult.insurer}</strong> · Coverage: <strong>{plateLookupResult.coverage}</strong>
                    </p>
                  </div>
                </motion.div>
              )}

            </div>

            {/* Coverage Type */}
            <div>
              <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Coverage Type *</label>
              <div className="relative">
                <select
                  required
                  value={claimForm.coverageType}
                  onChange={e => handleCoverageChange(e.target.value)}
                  className={`w-full appearance-none rounded-[1px] p-3 text-[15px] focus:ring-2 outline-none border-2 ${
 coverageMismatch
 ? 'bg-primary/[0.06] border-primary/30 text-primary focus:ring-red-400'
 : claimForm.coverageType && !coverageMismatch
 ? 'bg-primary/5 border-primary/40 focus:ring-primary'
 : 'bg-canvas-2 border-line-strong focus:ring-primary'
 }`}
                >
                  <option value="">Select coverage type...</option>
                  <option value="Comprehensive">Comprehensive</option>
                  <option value="Third Party">Third Party</option>
                </select>
                <span className="material-symbols-outlined absolute right-3 top-3.5 text-ink-faint pointer-events-none">expand_more</span>
              </div>
              {/* Coverage mismatch error */}
              {coverageMismatch && (
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
                  className="mt-3 bg-primary/[0.06] border-2 border-primary/30 rounded-[1px] p-4 flex items-start gap-3">
                  <span className="material-symbols-outlined text-primary text-[22px] mt-0.5">block</span>
                  <div>
                    <p className="font-semibold text-primary text-[14px]">Coverage Mismatch — Cannot Proceed</p>
                    <p className="text-[12px] text-primary mt-1 leading-relaxed">{coverageMismatch}</p>
                    <p className="text-[11px] text-primary mt-2 font-semibold">Please select the correct coverage type that matches your policy, or contact your insurer.</p>
                  </div>
                </motion.div>
              )}
              {claimForm.coverageType && !coverageMismatch && plateLookupResult && !plateLookupResult.notFound && (
                <p className="text-[11px] text-primary font-semibold mt-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">check_circle</span>
                  Coverage type matches your registered policy
                </p>
              )}
            </div>

            {/* Insurance Company — auto-filled or manual */}
            <div>
              <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Insurance Company *</label>
              <div className="relative">
                <select required value={claimForm.insurerId} onChange={e => setClaimForm(prev => ({ ...prev, insurerId: e.target.value, insurer: insurerName(e.target.value) }))}
                  className="w-full appearance-none bg-canvas-2 border-2 border-line-strong rounded-[1px] p-3.5 text-[15px] focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                  <option value="">Select the insurance company...</option>
                  {insurers.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <span className="material-symbols-outlined absolute right-3 top-3.5 text-ink-faint pointer-events-none">expand_more</span>
              </div>
              {plateLookupResult && !plateLookupResult.notFound && (
                <p className="text-[11px] text-primary font-semibold mt-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">auto_fix_high</span>
                  Auto-filled from plate lookup
                </p>
              )}
            </div>
          </div>

          {/* ─── SECTION 3: Claim Details ─── */}
          <div className="bg-white rounded-[1px] border border-line p-6 space-y-4">
            <h3 className="font-medium text-[15px] border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-medium">3</span>
              Claim Details
            </h3>

            {/* Claim Type */}
            <div>
              <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Claim Type *</label>
              <div className="relative mb-2">
                <select
                  required
                  value={CLAIM_TYPES.includes(claimForm.type) ? claimForm.type : claimForm.type ? 'Other' : ''}
                  onChange={e => {
                    if (e.target.value === 'Other') { setClaimField('type', 'Other'); }
                    else { setClaimField('type', e.target.value); }
                  }}
                  className="w-full appearance-none bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none"
                >
                  <option value="">Select claim type...</option>
                  {CLAIM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="material-symbols-outlined absolute right-3 top-3.5 text-ink-faint pointer-events-none">expand_more</span>
              </div>
              {(claimForm.type === 'Other' || (claimForm.type && !CLAIM_TYPES.slice(0, -1).includes(claimForm.type))) && (
                <div className="mt-2">
                  <input
                    required
                    value={claimForm.type === 'Other' ? '' : claimForm.type}
                    onChange={e => setClaimField('type', e.target.value || 'Other')}
                    placeholder="Please describe the type of claim..."
                    className="w-full bg-canvas-2 border-2 border-primary/40 rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none"
                    autoFocus
                  />
                  <p className="text-[11px] text-ink-muted mt-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">edit</span> Type your claim description above
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Date of Incident *</label>
                <input required type="date" value={claimForm.incidentDate} max={new Date().toISOString().split('T')[0]}
                  onChange={e => setClaimField('incidentDate', e.target.value)}
                  className={`w-full border rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none ${
 isLate ? 'bg-primary/[0.06] border-primary/30 text-primary focus:ring-red-400'
 : daysSinceIncident !== null ? 'bg-primary/5 border-primary/40 focus:ring-primary/40'
 : 'bg-canvas-2 border-line-strong'
 }`} />
                {daysSinceIncident !== null && (
                  <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-[1px] text-[12px] font-medium ${
 isLate ? 'bg-primary/[0.06] text-primary' : 'bg-primary/10 text-primary'
 }`}>
                    <span className="material-symbols-outlined text-[15px]">{isLate ? 'warning' : 'check_circle'}</span>
                    {isLate
                      ? `${daysSinceIncident} days since incident — outside 14-day window`
                      : `${daysSinceIncident} day${daysSinceIncident !== 1 ? 's' : ''} since incident — within 14-day window ✓`}
                  </div>
                )}
              </div>
              <div>
                <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Estimated Loss (ZMW)</label>
                <input type="number" min="0" value={claimForm.estimatedLoss} onChange={e => setClaimField('estimatedLoss', e.target.value)}
                  placeholder="e.g. 15000"
                  className="w-full bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
              </div>
            </div>

            <div>
              <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Incident Location *</label>
              <input required value={claimForm.location} onChange={e => setClaimField('location', e.target.value)}
                placeholder="e.g. Great East Road, near Arcades, Lusaka"
                className="w-full bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
            </div>

            <div>
              <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Describe What Happened *</label>
              <textarea required rows={4} value={claimForm.description} onChange={e => setClaimField('description', e.target.value)}
                placeholder="Provide a clear and detailed description of the incident..."
                className="w-full bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none resize-none" />
            </div>
          </div>

          {/* ─── SECTION 4: Police Report ─── */}
          <div className="bg-white rounded-[1px] border border-line p-6 space-y-3">
            <h3 className="font-medium text-[15px] border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-medium">4</span>
              Police Report
            </h3>
            <div className="flex items-center gap-3 p-3 bg-canvas-2 rounded-[1px] border border-line-strong cursor-pointer"
              onClick={() => setClaimField('policeReport', !claimForm.policeReport)}>
              <input type="checkbox" checked={claimForm.policeReport} readOnly className="w-5 h-5 rounded text-primary focus:ring-primary" />
              <div>
                <p className="font-semibold text-[14px]">Police Report Filed</p>
                <p className="text-[12px] text-ink-muted">Strongly recommended — speeds up claim processing significantly</p>
              </div>
            </div>
            {claimForm.policeReport && (
              <input value={claimForm.policeReportNumber} onChange={e => setClaimField('policeReportNumber', e.target.value)}
                placeholder="Police Case / Report Number e.g. ZP/2025/4421"
                className="w-full bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
            )}
          </div>

          {/* ─── SECTION 5: Supporting Documents (Dynamic) ─── */}
          <div className="bg-white rounded-[1px] border border-line p-6">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="font-medium text-[15px] flex items-center gap-2">
                <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-medium">5</span>
                Supporting Documents
              </h3>
              <button type="button" onClick={addDocItem}
                className="flex items-center gap-2 bg-primary/10 text-primary font-medium px-4 py-2 rounded-[1px] hover:bg-primary/20 transition-colors text-[13px] active:scale-95">
                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                Add Document
              </button>
            </div>

            <div className="mb-4 rounded-[1px] border border-primary/15 bg-canvas-2 p-4">
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink"><span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">checklist</span>Documents usually required for an insurance claim</p>
              <ul className="mt-3 grid gap-1.5 text-[13px] leading-relaxed text-ink-muted sm:grid-cols-2">
                {CLAIM_DOCUMENT_GUIDANCE.map(item => <li key={item} className="flex gap-2"><span className="material-symbols-outlined mt-0.5 text-[16px] text-primary" aria-hidden="true">check_circle</span><span>{item}</span></li>)}
              </ul>
              <p className="mt-3 text-[12px] text-ink-muted">Requirements may vary by insurer and claim type. Add any available supporting documents below.</p>
            </div>

            {docItems.length === 0 ? (
              <div className="border-2 border-dashed border-line-strong rounded-[1px] p-8 text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="material-symbols-outlined text-primary text-[24px]">attach_file</span>
                </div>
                <p className="font-semibold text-[14px] text-ink">No documents added yet</p>
                <p className="text-[12px] text-ink-muted mt-1">Click <strong>Add Document</strong> above to attach photos, a police report, repair quotation, or any other supporting file.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {docItems.map((doc, idx) => (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-line-strong rounded-[1px] p-4 bg-canvas-2/50"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wider">Document {idx + 1}</p>
                      <button type="button" onClick={() => removeDocItem(doc.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-primary/[0.06] text-ink-muted hover:text-primary transition-colors">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                    <div className="space-y-2">
                      {/* Document Name */}
                      <input
                        required
                        value={doc.name}
                        onChange={e => updateDocName(doc.id, e.target.value)}
                        placeholder="Document name (e.g. Driver's Licence, Accident Photos, Police Report...)"
                        className="w-full bg-white border border-line-strong rounded-[1px] p-2.5 text-[14px] focus:ring-2 focus:ring-primary outline-none"
                      />
                      {/* File Upload */}
                      <label className={`flex items-center gap-3 p-3 rounded-[1px] border-2 border-dashed cursor-pointer transition-colors ${
 doc.file ? 'border-primary/40 bg-primary/5' : 'border-line-strong hover:border-primary/30 hover:bg-canvas-2'
 }`}>
                        <div className={`w-8 h-8 rounded-[1px] flex items-center justify-center flex-shrink-0 ${
 doc.file ? 'bg-primary text-white' : 'bg-primary/10 text-primary'
 }`}>
                          <span className="material-symbols-outlined text-[18px]">{doc.file ? 'check' : 'upload'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {doc.file
                            ? <p className="text-[13px] font-semibold text-primary truncate">{doc.file.name}</p>
                            : <p className="text-[13px] text-ink-muted">Upload photo or PDF</p>}
                          <p className="text-[10px] text-ink-muted mt-0.5">JPG, PNG, PDF supported</p>
                        </div>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          onChange={e => e.target.files[0] && updateDocFile(doc.id, e.target.files[0])}
                        />
                        {doc.file && (
                          <button type="button" onClick={e => { e.preventDefault(); updateDocFile(doc.id, null); }}
                            className="text-ink-muted hover:text-red-500 transition-colors flex-shrink-0">
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        )}
                      </label>
                    </div>
                  </motion.div>
                ))}

                <button type="button" onClick={addDocItem}
                  className="w-full py-3 border-2 border-dashed border-primary/30 text-primary font-semibold rounded-[1px] hover:border-primary/50 hover:bg-primary/5 transition-all text-[13px] flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  Add Another Document
                </button>
              </div>
            )}
          </div>

          {/* Late Submission Reason */}
          {isLate && (
            <div className="bg-primary/[0.06] border-2 border-primary/30 rounded-[1px] p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary text-[22px] mt-0.5">report</span>
                <div>
                  <p className="font-semibold text-primary text-[15px]">Late Submission — Reason Required</p>
                  <p className="text-[13px] text-primary mt-1">
                    Your incident was <strong>{daysSinceIncident} days ago</strong>, outside the standard 14-day window.
                    You must provide a valid reason. The insurer may still decline at their discretion.
                  </p>
                </div>
              </div>
              <div>
                <label className="text-[12px] font-medium uppercase tracking-wider text-primary mb-1.5 block">Reason for Late Submission *</label>
                <textarea required={isLate} rows={4} value={claimForm.lateReason}
                  onChange={e => setClaimField('lateReason', e.target.value)}
                  placeholder="e.g. I was hospitalised following the accident and only discharged on [date]..."
                  className="w-full bg-white border-2 border-primary/30 rounded-[1px] p-3 text-[14px] focus:ring-2 focus:ring-red-400 outline-none resize-none" />
              </div>
            </div>
          )}

          {/* Info Note */}
          <div className="bg-primary/[0.06] border border-primary/30 p-4 rounded-[1px] flex items-start gap-2">
            <span className="material-symbols-outlined text-primary text-[18px] mt-0.5">info</span>
            <p className="text-[13px] text-primary">
              <strong>What happens next:</strong> you get a claim number straight away. You then call <strong>{claimForm.insurer || 'the insurer'}</strong>, quote the number, and they handle the assessment and settlement with you directly. Filing a claim may affect future No Claim Discount eligibility.
            </p>
          </div>

          {/* Submit */}
          {claimError && <p role="alert" className="mt-5 rounded-[1px] border border-primary/30 bg-primary/5 px-4 py-3 text-[14px] text-primary">{claimError}</p>}
          <button type="submit" disabled={claimSubmitting || isSubmitBlocked || !!coverageMismatch}
            className="w-full bg-primary text-white font-medium text-[16px] py-4 rounded-[1px] transition-colors duration-200 ease-out hover:bg-[#b91c1c] flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint disabled:hover:bg-canvas">
            {claimSubmitting
              ? <><span className="material-symbols-outlined animate-spin">sync</span> Recording notification…</>
              : coverageMismatch
                ? <><span className="material-symbols-outlined">block</span> Fix Coverage Mismatch to Submit</>
                : isSubmitBlocked
                  ? <><span className="material-symbols-outlined">lock</span> Provide Late Reason to Submit</>
                  : <><span className="material-symbols-outlined">confirmation_number</span> Get my claim number</>}
          </button>
        </form>
      </motion.div>
    );
  }

  // ── Claim Detail (after tracking lookup) ──
  if (mainTab === 'claims' && claimView === 'detail' && selectedClaim) {
    const claim = allClaims.find(c => c.id === selectedClaim.id) || selectedClaim;
    const claimNumber = claim.claimNumber || claim.id;
    const received = claim.status === 'Received by insurer';

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-3xl px-5 py-8 pb-24 sm:px-8">
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => setClaimView('list')} aria-label="Back to claims" className="rounded-full p-2 hover:bg-canvas-2"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-[24px] font-medium text-primary">{claimNumber}</h1>
              <CopyButton value={claimNumber} className="bg-primary/10 text-primary hover:bg-primary/15" />
              <Badge variant={CLAIM_STATUSES[claim.status] || 'muted'}>{claim.status}</Badge>
            </div>
            <p className="mt-1 text-[13px] text-ink-muted">{claim.type} · notified {formatDate(claim.submittedAt)}{received && claim.receivedAt ? ` · received by ${claim.insurer} ${formatDate(claim.receivedAt)}` : ''}</p>
          </div>
        </div>

        <p className={`mt-5 flex items-start gap-3 rounded-[1px] border p-4 text-[13px] leading-5 ${received ? 'border-primary/20 bg-primary/5 text-primary' : 'border-primary/30 bg-primary/[0.06] text-primary'}`}>
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{received ? 'task_alt' : 'phone_in_talk'}</span>
          <span>{received
            ? <>{claim.insurer} has your claim. They will continue the assessment and settlement with you directly — contact them for any updates.</>
            : <>InsurShield has recorded your notification. <strong>Call {claim.insurer} and quote {claimNumber}</strong> so they can open the claim; everything from there is handled by the insurer.</>}</span>
        </p>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <InsurerCallCard insurerName={claim.insurer} contact={insurerContact(claim.insurer)} claimNumber={claimNumber} />
          <section className="rounded-[1px] border border-line bg-white p-5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">What you reported</p>
            <dl className="mt-3 space-y-3">
              <InfoRow label="Vehicle" value={`${claim.vehicle || ''}${claim.plate ? ` · ${claim.plate}` : ''}`} />
              <InfoRow label="Incident date" value={formatDate(claim.incidentDate)} />
              <InfoRow label="Location" value={claim.location} />
              {claim.estimatedLoss && <InfoRow label="Estimated loss" value={formatZMW(parseFloat(claim.estimatedLoss))} highlight />}
              <InfoRow label="Police report" value={claim.policeReport ? `Yes · ${claim.policeReportNumber || 'filed'}` : 'No'} />
            </dl>
            {claim.description && <p className="mt-3 rounded-[1px] bg-canvas-2 p-3 text-[13px] leading-5 text-ink">{claim.description}</p>}
            {claim.supportingDocs?.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {claim.supportingDocs.map((doc, index) => <li key={`${doc.name}-${index}`} className="inline-flex items-center gap-1 rounded-[1px] bg-canvas-2 px-2 py-1 text-[12px] font-semibold text-ink-muted"><span className="material-symbols-outlined text-[14px]" aria-hidden="true">attach_file</span>{doc.name || doc.fileName || 'Document'}</li>)}
              </ul>
            )}
          </section>
        </div>
      </motion.div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // VIEWS: NCD Applications
  // ════════════════════════════════════════════════════════════════

  if (mainTab === 'ncd' && ncdView === 'success') {
    return <SuccessBanner refNumber={submittedRef} onDone={() => setNcdView('list')} />;
  }

  if (mainTab === 'ncd' && ncdView === 'new') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto px-4 py-10 pb-24">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setNcdView('list')} className="p-2 hover:bg-canvas-2 rounded-full">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h1 className="text-[24px] font-medium text-primary">Apply for No Claim Discount</h1>
            <p className="text-[13px] text-ink-muted">You'll receive a reference number to track this application.</p>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-canvas-2 border border-blue-100 rounded-[1px] p-5 mb-6">
          <h4 className="font-medium text-ink-muted text-[14px] mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-ink-muted text-[18px]">info</span>
            How NCD Works
          </h4>
          <div className="space-y-2">
            {[
              'Select the insurer you\'ve been with for at least 1 year with no claims.',
              'Enter your policy number and how many years you\'ve been claim-free.',
              'Submit — the insurer verifies your claim history (3–5 business days).',
              'If approved, you receive a unique NCD code to use on your next quotation.',
              'The discount is applied only on quotes from that specific insurer.',
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="w-5 h-5 bg-primary text-white text-[11px] font-medium rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-[13px] text-ink-muted">{step}</p>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmitNcd} className="space-y-5">
          <div className="bg-white rounded-[1px] border border-line p-6 space-y-5">
            <h3 className="font-medium text-[15px] border-b pb-2">Contact & Application Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Full Name *</label>
                <input required value={ncdForm.fullName} onChange={e => setNcdField('fullName', e.target.value)} placeholder="e.g. Mwiza Banda"
                  className="w-full bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Mobile Number *</label>
                <input required type="tel" value={ncdForm.phone} onChange={e => setNcdField('phone', e.target.value)} placeholder="e.g. 0970 123 456"
                  className="w-full bg-canvas-2 border border-line-strong rounded-[1px] p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
                <p className="text-[11px] text-ink-muted mt-1">Used to verify and track this application.</p>
              </div>
            </div>

            <div>
              <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Insurance Company *</label>
              <div className="relative">
                <select required value={ncdForm.insurerId} onChange={e => setNcdForm(prev => ({ ...prev, insurerId: e.target.value, insurer: insurerName(e.target.value) }))}
                  className="w-full appearance-none bg-canvas-2 border border-line-strong rounded-[1px] p-3.5 text-[15px] focus:ring-2 focus:ring-primary outline-none">
                  <option value="">Select insurer you have been using...</option>
                  {insurers.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <span className="material-symbols-outlined absolute right-3 top-3.5 text-ink-faint pointer-events-none">expand_more</span>
              </div>
              <p className="text-[11px] text-ink-muted mt-1">You must have been continuously insured with this company for a minimum of 1 year.</p>
            </div>

            <div>
              <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-1.5 block">Existing Policy Number *</label>
              <input required value={ncdForm.policyNumber} onChange={e => setNcdField('policyNumber', e.target.value.toUpperCase())} placeholder="e.g. PA-2023-0045"
                className="w-full bg-canvas-2 border border-line-strong rounded-[1px] p-3 font-mono text-[15px] uppercase focus:ring-2 focus:ring-primary outline-none" />
            </div>

            <div>
              <label className="text-[12px] font-medium uppercase tracking-wider text-ink-muted mb-2 block">Years Continuously Insured Without a Claim *</label>
              <div className="grid grid-cols-4 gap-2">
                {NCD_TIERS.map(tier => (
                  <div key={tier.years} onClick={() => setNcdField('yearsClaimFree', String(tier.years))}
                    className={`p-3 rounded-[1px] border-2 cursor-pointer text-center transition-all ${ncdForm.yearsClaimFree === String(tier.years) ? 'bg-primary border-primary text-white' : 'border-line bg-white hover:border-primary/40'}`}>
                    <p className="text-[20px] font-semibold">{tier.years}</p>
                    <p className="text-[10px] font-medium uppercase">yr{tier.years > 1 ? 's' : ''}</p>
                    <p className={`text-[12px] font-semibold mt-1 ${ncdForm.yearsClaimFree === String(tier.years) ? 'text-white' : 'text-primary'}`}>{tier.percentage}%</p>
                  </div>
                ))}
              </div>
              {ncdForm.yearsClaimFree && (
                <div className="mt-3 bg-primary/5 border border-primary/20 p-3 rounded-[1px] flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <p className="text-[13px] text-primary">
                    <strong>{NCD_TIERS.find(t => t.years === parseInt(ncdForm.yearsClaimFree))?.percentage}% discount</strong> may apply — subject to insurer verification.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Declaration */}
          <div className={`flex items-start gap-3 p-4 rounded-[1px] border-2 cursor-pointer transition-all ${ncdForm.declaration ? 'bg-primary/5 border-primary/40' : 'bg-white border-line hover:border-primary/40'}`}
            onClick={() => { setNcdField('declaration', !ncdForm.declaration); setNcdDeclarationError(''); }}>
            <div className={`w-6 h-6 rounded-[1px] border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${ncdForm.declaration ? 'bg-primary/50 border-primary' : 'border-line'}`}>
              {ncdForm.declaration && <span className="material-symbols-outlined text-white text-[14px]">check</span>}
            </div>
            <p className="text-[13px] leading-relaxed text-ink">
              <strong>I declare</strong> that I have been continuously insured with the selected company for the stated period and have not made any insurance claims during that time. I understand that false information may result in rejection and legal action.
            </p>
          </div>

          {ncdDeclarationError && <p className="text-[12px] font-medium text-primary">{ncdDeclarationError}</p>}

          {ncdError && <p role="alert" className="mt-5 rounded-[1px] border border-primary/30 bg-primary/5 px-4 py-3 text-[14px] text-primary">{ncdError}</p>}
          <button type="submit" disabled={ncdSubmitting || !ncdForm.yearsClaimFree || !ncdForm.declaration}
            className="w-full bg-primary text-white font-medium py-4 rounded-[1px] transition-colors duration-200 ease-out hover:bg-[#b91c1c] flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint disabled:hover:bg-canvas">
            {ncdSubmitting
              ? <><span className="material-symbols-outlined animate-spin">sync</span> Submitting...</>
              : <><span className="material-symbols-outlined">send</span> Submit NCD Application</>
            }
          </button>
        </form>
      </motion.div>
    );
  }


  if (mainTab === 'ncd' && ncdView === 'detail' && selectedNcdApp) {
    const app = allNcdApps.find(a => a.id === selectedNcdApp.id) || selectedNcdApp;
    const statusInfo = NCD_APPLICATION_STATUSES.find(s => s.id === app.status);
    const currentStatusIdx = NCD_APPLICATION_STATUSES.findIndex(s => s.id === app.status);
    const tier = NCD_TIERS.find(t => t.years === app.yearsClaimFree);

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setNcdView('list')} className="p-2 hover:bg-canvas-2 rounded-full">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="flex-1">
            <h1 className="text-[22px] font-medium text-primary font-mono">{app.applicationNumber}</h1>
            <Badge variant={statusInfo?.variant || 'muted'}>{app.status}</Badge>
          </div>
        </div>

        <dl className="bg-white rounded-[1px] border border-line p-5 mb-5 space-y-3">
          <InfoRow label="Insurance Company" value={app.insurer} highlight />
          <InfoRow label="Policy Number" value={app.policyNumber} />
          <InfoRow label="Years Claim-Free" value={`${app.yearsClaimFree} year${app.yearsClaimFree > 1 ? 's' : ''}`} />
          <InfoRow label="Potential Discount" value={`${tier?.percentage || app.yearsClaimFree * 10}%`} highlight />
          <InfoRow label="Submitted" value={formatDate(app.submittedAt)} />
        </dl>

        {/* Progress */}
        <div className="bg-white rounded-[1px] border border-line p-5 mb-5">
          <h3 className="font-medium text-[13px] uppercase text-ink-muted border-b pb-2 mb-4">Application Progress</h3>
          <div className="relative">
            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-canvas-2" />
            <div className="space-y-4">
              {NCD_APPLICATION_STATUSES.filter(s => s.id !== 'Rejected').map((status, idx) => {
                const isDone = idx <= currentStatusIdx;
                const isCurrent = idx === currentStatusIdx;
                return (
                  <div key={status.id} className="relative flex items-center gap-4 pl-2">
                    <div className={`w-6 h-6 rounded-full z-10 flex-shrink-0 flex items-center justify-center ${isDone ? 'bg-primary' : 'border-2 border-line bg-white'}`}>
                      {isDone && <span className="material-symbols-outlined text-white text-[12px]">check</span>}
                    </div>
                    <div className={`text-[13px] ${isCurrent ? 'font-medium text-primary' : isDone ? 'text-ink' : 'text-ink-muted opacity-40'}`}>
                      {status.label}
                      {isCurrent && <span className="ml-2 text-[10px] bg-primary text-white px-2 py-0.5 rounded-full">CURRENT</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Approved Code */}
        {app.status === 'Approved' && app.approvedCode && (
          <div className="bg-primary/5 border-2 border-primary/40 rounded-[1px] p-5 text-center">
            <span className="material-symbols-outlined text-primary text-4xl mb-2" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
            <h3 className="font-semibold text-primary text-[18px] mb-1">NCD Approved!</h3>
            <p className="text-[13px] text-primary mb-3">Use this code when requesting a quotation from <strong>{app.insurer}</strong>.</p>
            <div className="bg-white border border-primary/30 rounded-[1px] p-4 mb-3">
              <p className="text-[12px] text-primary font-medium uppercase mb-1">Your NCD Code</p>
              <p className="text-[32px] font-semibold text-primary font-mono tracking-widest">{app.approvedCode}</p>
              <p className="text-[11px] text-primary font-medium mt-1">⚠️ Valid for {app.insurer} only · Single use</p>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => navigator.clipboard?.writeText(app.approvedCode)} className="flex items-center gap-2 px-5 py-2.5 border-2 border-primary text-primary font-medium rounded-[1px] hover:bg-primary/5">
                <span className="material-symbols-outlined text-[18px]">content_copy</span> Copy Code
              </button>
              <button onClick={() => navigate('/insurance-type')} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-medium rounded-[1px] hover:bg-[#b91c1c]">
                <span className="material-symbols-outlined text-[18px]">request_quote</span> Get a Quote
              </button>
            </div>
          </div>
        )}
      </motion.div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // MAIN LIST VIEW
  // ════════════════════════════════════════════════════════════════
  const myClaims = allClaims.filter(mine);
  const myNcdApps = allNcdApps.filter(mine);
  const openClaim = (claim) => { setSelectedClaim(claim); setClaimView('detail'); };
  const openNcdApp = (app) => { setSelectedNcdApp(app); setNcdView('detail'); };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative overflow-hidden">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-[1100px] px-6 py-12 pb-24 lg:px-10">
      <header className="border-b border-line pb-8">
        <span className="inline-flex items-center gap-3">
          <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
          <Meta className="text-ink-muted">Claims &amp; no-claim discount</Meta>
        </span>
        <h1 className="mt-6 max-w-2xl text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[44px]">Claims &amp; NCD</h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-[1.6] text-ink-muted">Notify your insurer of an incident, follow each claim's progress, and apply for a No Claim Discount — all linked to your account.</p>
      </header>

      {/* A rail rather than a pill group, matching the insurer portal. */}
      <div role="tablist" aria-label="Claims and NCD" className="no-scrollbar -mb-px grid grid-cols-2 border-b border-line md:flex md:overflow-x-auto">
        {[
          { id: 'claims', label: 'Claims', icon: 'report_problem', count: myClaims.length },
          { id: 'ncd', label: 'NCD applications', shortLabel: 'NCD', icon: 'sell', count: myNcdApps.length },
        ].map(tab => {
          const active = mainTab === tab.id;
          return (
          <button key={tab.id} type="button" role="tab" aria-selected={active} aria-label={tab.label} onClick={() => setMainTab(tab.id)}
            className={`flex min-h-14 items-center justify-center gap-2.5 border-b-2 px-3 py-3 font-mono text-[12px] uppercase tracking-[0.1em] transition-colors duration-200 ease-out md:min-h-0 md:shrink-0 md:justify-start md:px-5 md:py-4 ${active ? 'border-primary text-primary' : 'border-transparent text-ink-faint hover:text-ink'}`}>
            <span className="material-symbols-outlined text-[17px]" aria-hidden="true">{tab.icon}</span>
            {tab.shortLabel ? <><span className="md:hidden">{tab.shortLabel}</span><span className="hidden md:inline">{tab.label}</span></> : tab.label}
            {tab.count > 0 && <span className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-[1px] px-1 text-[10px] leading-none ${active ? 'bg-primary text-white' : 'bg-primary/10 text-primary'}`}>{tab.count}</span>}
          </button>
          );
        })}
      </div>

      {mainTab === 'claims' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
          <div className="min-w-0 space-y-6">
            <button type="button" onClick={() => setClaimView('new')}
              className="group flex w-full items-center gap-5 rounded-[1px] bg-primary p-6 text-left text-white transition-colors hover:bg-[#b91c1c]">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1px] bg-white/15"><span className="material-symbols-outlined text-[28px]" aria-hidden="true">add_circle</span></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[18px] font-semibold">Start a claim</span>
                <span className="mt-1 block text-[13px] text-white/85">Complete the first notification and get a claim number to quote to your insurer.</span>
              </span>
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
            </button>

            <section className="rounded-[1px] border border-line bg-white p-6">
              <h2 className="text-[20px] font-semibold">My claims</h2>
              {myClaims.length ? (
                <ul className="mt-4 divide-y divide-slate-100">
                  {myClaims.map(claim => (
                    <li key={claim.id}>
                      <button type="button" onClick={() => openClaim(claim)} className="flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-canvas-2">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1px] bg-primary/10 text-primary"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">directions_car</span></span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-ink">{claim.type || 'Claim'} <span className="font-mono text-[13px] text-ink-muted">· {claim.claimNumber || claim.id}</span></span>
                          <span className="mt-0.5 block text-[12px] text-ink-muted">{claim.insurer} · incident {formatDate(claim.incidentDate)}</span>
                          <Badge variant={CLAIM_STATUSES[claim.status] || 'muted'} className="mt-1.5 sm:hidden">{claim.status}</Badge>
                        </span>
                        <Badge variant={CLAIM_STATUSES[claim.status] || 'muted'} className="hidden shrink-0 sm:inline-flex">{claim.status}</Badge>
                        <span className="material-symbols-outlined shrink-0 text-ink-muted" aria-hidden="true">chevron_right</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 rounded-[1px] bg-canvas-2 p-4 text-[14px] text-ink-muted">No claims yet. If something happens, start a claim here and your insurer will pick it up.</p>
              )}
            </section>
          </div>

          <aside className="min-w-0 rounded-[1px] border border-line bg-white p-6">
            <h2 className="text-[16px] font-semibold">How a claim works</h2>
            <ol className="mt-4 space-y-4">
              {[
                { icon: 'description', title: 'Tell us what happened', desc: 'Choose the insurer, describe the incident and attach photos or a police report.' },
                { icon: 'confirmation_number', title: 'Get a claim number', desc: 'You receive it immediately and it is saved to your account.' },
                { icon: 'phone_in_talk', title: 'Your insurer takes over', desc: 'Quote the number when you call; the insurer handles assessment and settlement with you directly.' },
              ].map((item, index) => (
                <li key={item.title} className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[1px] bg-primary font-mono text-[12px] text-white">{index + 1}</span>
                  <span>
                    <span className="block text-[14px] font-medium text-ink">{item.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-5 text-ink-muted">{item.desc}</span>
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}

      {mainTab === 'ncd' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
          <div className="min-w-0 space-y-6">
            <button type="button" onClick={() => setNcdView('new')}
              className="group flex w-full items-center gap-5 rounded-[1px] bg-primary p-6 text-left text-white transition-colors hover:bg-[#b91c1c]">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1px] bg-white/15"><span className="material-symbols-outlined text-[28px]" aria-hidden="true">sell</span></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[18px] font-semibold">Apply for a No Claim Discount</span>
                <span className="mt-1 block text-[13px] text-white/85">One or more claim-free years can earn up to 40% off your next premium.</span>
              </span>
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
            </button>

            <section className="rounded-[1px] border border-line bg-white p-6">
              <h2 className="text-[20px] font-semibold">My applications</h2>
              {myNcdApps.length ? (
                <ul className="mt-4 divide-y divide-slate-100">
                  {myNcdApps.map(app => {
                    const status = NCD_APPLICATION_STATUSES.find(item => item.id === app.status);
                    return (
                      <li key={app.id}>
                        <button type="button" onClick={() => openNcdApp(app)} className="flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-canvas-2">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1px] bg-primary/10 text-primary"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">sell</span></span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-ink">{app.yearsClaimFree} claim-free year{app.yearsClaimFree === 1 ? '' : 's'} <span className="font-mono text-[13px] text-ink-muted">· {app.applicationNumber}</span></span>
                            <span className="mt-0.5 block text-[12px] text-ink-muted">{app.insurer} · policy {app.policyNumber}{app.approvedCode ? ` · code ${app.approvedCode}` : ''}</span>
                            <Badge variant={status?.variant || 'muted'} className="mt-1.5 sm:hidden">{app.status}</Badge>
                          </span>
                          <Badge variant={status?.variant || 'muted'} className="hidden shrink-0 sm:inline-flex">{app.status}</Badge>
                          <span className="material-symbols-outlined shrink-0 text-ink-muted" aria-hidden="true">chevron_right</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 rounded-[1px] bg-canvas-2 p-4 text-[14px] text-ink-muted">No applications yet. Apply once you have at least one claim-free year with an insurer.</p>
              )}
            </section>
          </div>

          <aside className="min-w-0 rounded-[1px] border border-line bg-white p-6">
            <h2 className="text-[16px] font-semibold">Discount scale</h2>
            <ul className="mt-4 grid grid-cols-2 gap-3">
              {NCD_TIERS.map(tier => (
                <li key={tier.years} className="rounded-[1px] border border-primary/10 bg-primary/5 p-3 text-center">
                  <p className="text-[24px] font-semibold text-primary">{tier.percentage}%</p>
                  <p className="text-[11px] font-medium uppercase text-ink-muted">{tier.years} claim-free yr{tier.years > 1 ? 's' : ''}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-5 text-ink-muted">Maximum 40% after four consecutive claim-free years. Subject to insurer approval; the approved code is applied when you next request quotes.</p>
          </aside>
        </div>
      )}
      </div>
    </motion.div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase text-ink-muted">{label}</dt>
      <dd className={`text-[14px] font-semibold ${highlight ? 'text-primary' : 'text-ink'}`}>{value || '—'}</dd>
    </div>
  );
}
