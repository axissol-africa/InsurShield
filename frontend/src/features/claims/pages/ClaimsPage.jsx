import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, belongsToCustomer } from '@/store';
import { motion } from 'framer-motion';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import { INSURER_RATES } from '@/domain/insurers';

const CLAIM_TYPES = [
  'Accident / Collision', 'Theft', 'Fire Damage', 'Natural Disaster',
  'Third Party Liability', 'Windscreen Damage', 'Medical Expenses', 'Towing & Recovery',
  'Other',
];

/** A claim only goes through first notification here; the insurer handles everything after the call. */
const CLAIM_STATUSES = {
  Notified: 'bg-blue-100 text-blue-800',
  'Received by insurer': 'bg-primary/10 text-primary',
};

const NCD_TIERS = [
  { years: 1, percentage: 10 }, { years: 2, percentage: 20 },
  { years: 3, percentage: 30 }, { years: 4, percentage: 40 },
];

const NCD_APPLICATION_STATUSES = [
  { id: 'Submitted', color: 'bg-blue-100 text-blue-800' },
  { id: 'Under Review', color: 'bg-amber-100 text-amber-800' },
  { id: 'Verification Required', color: 'bg-orange-100 text-orange-800' },
  { id: 'Approved', color: 'bg-primary/10 text-primary' },
  { id: 'Rejected', color: 'bg-red-100 text-red-800' },
];

const CLAIM_DOCUMENT_GUIDANCE = [
  'Completed claim form',
  'Copy of the driver\'s licence',
  'Police report or case reference (for accidents, theft, or malicious damage)',
  'Vehicle registration / White Book',
  'Accident photos and repair quotation, where available',
];

// Seeded so the demo customer already has one notification on record.
const SEED_CLAIMS = [
  {
    id: 'CLM-882031', claimNumber: 'CLM-882031', phone: '0970123456', fullName: 'Mwiza Banda',
    insurer: 'Prestige Assurance', type: 'Accident / Collision', plate: 'BAA 1234', vehicle: '2020 Toyota Hilux',
    incidentDate: '2025-06-10', location: 'Great East Road, near Arcades',
    description: 'Rear-ended at traffic lights. Third party vehicle fled the scene.',
    estimatedLoss: '45000', policeReport: true, policeReportNumber: 'ZP/2025/4421',
    status: 'Received by insurer',
    submittedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    receivedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    supportingDocs: [{ name: 'Police report' }, { name: 'Accident photos' }],
  },
];

const SEED_NCD = [
  {
    id: 'NCDA-991200', applicationNumber: 'NCDA-991200', phone: '0970123456',
    insurer: 'Prestige Assurance', policyNumber: 'PA-2023-0045',
    yearsClaimFree: 2, status: 'Approved', approvedCode: 'NCD-D3E4F',
    submittedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
];

// ─── Sub-components ──────────────────────────────────────────────────────────
const insurerContact = (name) => INSURER_RATES.find((insurer) => insurer.name === name)?.contact || null;

function CopyButton({ value, className = '' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button type="button" onClick={copy} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-bold transition-colors ${className}`}>
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{copied ? 'check' : 'content_copy'}</span>{copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Insurer claims-desk contact with one-tap call / WhatsApp. */
function InsurerCallCard({ insurerName, claimNumber }) {
  const contact = insurerContact(insurerName);
  const message = encodeURIComponent(`Hello, I am notifying a motor claim. My InsurShield claim number is ${claimNumber}.`);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wider text-secondary">Call your insurer</p>
      <h2 className="mt-1 text-[20px] font-extrabold text-primary">{insurerName}</h2>
      {contact ? (
        <>
          <p className="mt-1 text-[13px] text-on-surface-variant">{contact.contactPerson} · {contact.role}</p>
          <div className="mt-4 grid gap-2">
            <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-bold text-white hover:bg-primary-container">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">call</span>{contact.phone}
            </a>
            <a href={`https://wa.me/${contact.whatsapp}?text=${message}`} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-primary px-4 text-[15px] font-bold text-primary hover:bg-primary/5">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">chat</span>WhatsApp
            </a>
          </div>
          <dl className="mt-4 space-y-1.5 text-[13px] text-on-surface-variant">
            <div className="flex gap-2"><dt className="w-16 shrink-0 font-bold text-secondary">Hours</dt><dd>{contact.hours}</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 font-bold text-secondary">Email</dt><dd><a href={`mailto:${contact.email}`} className="text-primary hover:underline">{contact.email}</a></dd></div>
          </dl>
        </>
      ) : (
        <p className="mt-2 text-[13px] text-on-surface-variant">Contact details for this insurer are in the <Link to="/support" className="font-bold text-primary hover:underline">insurer directory</Link>.</p>
      )}
    </section>
  );
}

/** Shown right after a claim is submitted: the claim number and the hand-off to the insurer. */
function ClaimHandoff({ claim, onDone }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-3xl px-5 py-10 pb-24 sm:px-8">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/5"><span className="material-symbols-outlined text-4xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">check_circle</span></div>
        <h1 className="text-[30px] font-extrabold tracking-[-.03em] text-on-surface">Your claim number is ready</h1>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-on-surface-variant">InsurShield's part is done. Call {claim.insurer} now and quote this number — they will open the claim and handle the assessment and settlement with you directly.</p>
      </div>

      <div className="mt-7 rounded-2xl bg-primary p-6 text-center text-white shadow-lg shadow-primary/20">
        <p className="text-[12px] font-bold uppercase tracking-widest text-white/70">Claim number</p>
        <p className="mt-2 font-mono text-[36px] font-extrabold tracking-widest sm:text-[44px]">{claim.claimNumber}</p>
        <CopyButton value={claim.claimNumber} className="mt-3 bg-white/20 text-white hover:bg-white/30" />
        <p className="mt-3 text-[12px] text-white/75">Also saved under Claims in your account.</p>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-[1fr_1fr]">
        <InsurerCallCard insurerName={claim.insurer} claimNumber={claim.claimNumber} />
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-secondary">Have ready when you call</p>
          <ul className="mt-3 space-y-2 text-[14px] text-on-surface">
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
        <button type="button" onClick={onDone} className="min-h-12 rounded-xl border border-outline-variant bg-white px-6 font-semibold text-primary hover:bg-gray-50">Back to my claims</button>
      </div>
    </motion.div>
  );
}

function SuccessBanner({ refNumber, onDone }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto max-w-lg px-4 py-12 text-center">
      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary/5"><span className="material-symbols-outlined text-4xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">check_circle</span></div>
      <h2 className="text-[26px] font-extrabold text-primary">NCD application submitted</h2>
      <p className="mt-2 text-[14px] text-on-surface-variant">Your application has been sent to the insurer. You can follow it under NCD applications in your account.</p>
      <div className="mt-6 rounded-2xl bg-primary p-6 text-white">
        <p className="text-[12px] font-bold uppercase tracking-widest text-white/70">Application number</p>
        <p className="mt-1 font-mono text-[30px] font-extrabold tracking-widest">{refNumber}</p>
        <CopyButton value={refNumber} className="mt-3 bg-white/20 text-white hover:bg-white/30" />
      </div>
      <button type="button" onClick={onDone} className="mt-6 w-full rounded-xl bg-primary py-3 font-semibold text-white hover:bg-primary-container">View my applications</button>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ClaimsPage() {
  const navigate = useNavigate();
  const { claims, addClaim, vehicleDetails, ncdApplications, addNcdApplication, customer, policies } = useStore();

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
  const [claimForm, setClaimForm] = useState({
    insurer: '', type: '', incidentDate: '', location: '',
    description: '', policeReport: false, policeReportNumber: '',
    estimatedLoss: '', phone: customer?.phone || '', fullName: customer?.fullName || '', lateReason: '',
    plateNumber: '', coverageType: '',
  });

  // NCD form state
  const [ncdSubmitting, setNcdSubmitting] = useState(false);
  const [ncdDeclarationError, setNcdDeclarationError] = useState('');
  const [ncdForm, setNcdForm] = useState({
    insurer: '', policyNumber: '', yearsClaimFree: '', phone: '', fullName: '', declaration: false,
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

  const allClaims = [...claims, ...SEED_CLAIMS];
  const allNcdApps = [...ncdApplications, ...SEED_NCD];
  const mine = belongsToCustomer(customer);

  // ─── Handlers ───────────────────────────────────────────────
  const handleSubmitClaim = (e) => {
    e.preventDefault();
    if (coverageMismatch) return;
    setClaimSubmitting(true);
    setTimeout(() => {
      const claimNumber = `CLM-${Math.floor(100000 + Math.random() * 900000)}`;
      const claim = {
        ...claimForm,
        claimNumber,
        vehicle: vehicleDetails ? `${vehicleDetails.year} ${vehicleDetails.make} ${vehicleDetails.model}` : 'Your vehicle',
        plate: claimForm.plateNumber || vehicleDetails?.plateNumber || 'N/A',
        supportingDocs: docItems.map(d => ({ name: d.name, fileName: d.file?.name || null })),
      };
      addClaim(claim);
      setSubmittedClaim(claim);
      setClaimSubmitting(false);
      setClaimForm({ insurer: '', type: '', incidentDate: '', location: '', description: '', policeReport: false, policeReportNumber: '', estimatedLoss: '', phone: customer?.phone || '', fullName: customer?.fullName || '', lateReason: '', plateNumber: '', coverageType: '' });
      setDocItems([]);
      setPlateLookupResult(null);
      setCoverageMismatch(null);
      setClaimView('success');
    }, 1400);
  };

  const handleSubmitNcd = (e) => {
    e.preventDefault();
    if (!ncdForm.declaration) { setNcdDeclarationError('Please acknowledge the declaration before submitting.'); return; }
    setNcdDeclarationError('');
    setNcdSubmitting(true);
    setTimeout(() => {
      const refNumber = `NCDA-${Math.floor(100000 + Math.random() * 900000)}`;
      addNcdApplication({ ...ncdForm, applicationNumber: refNumber, yearsClaimFree: parseInt(ncdForm.yearsClaimFree) });
      setSubmittedRef(refNumber);
      setNcdSubmitting(false);
      setNcdForm({ insurer: '', policyNumber: '', yearsClaimFree: '', phone: '', fullName: '', declaration: false });
      setNcdView('success');
    }, 1400);
  };


  // ═══════════════════════════════════════════════════════════════
  // VIEWS: Claims
  // ═══════════════════════════════════════════════════════════════

  // ── Success ──
  if (mainTab === 'claims' && claimView === 'success' && submittedClaim) {
    return <ClaimHandoff claim={submittedClaim} onDone={() => setClaimView('list')} />;
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
          result = { insurer: ownPolicy.insurer, coverage, make: ownPolicy.vehicle, year: '', plate };
        } else {
          const hash = plate.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
          const insurer = INSURER_RATES[hash % INSURER_RATES.length];
          result = { insurer: insurer.name, coverage: hash % 3 === 0 ? 'Third Party' : 'Comprehensive', make: MAKES[hash % MAKES.length], year: YEARS[(hash + 3) % YEARS.length], plate };
        }
        setPlateLookupResult(result);
        setClaimField('insurer', result.insurer);
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
          <button onClick={() => setClaimView('list')} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h1 className="text-[24px] font-bold text-primary">Start a claim</h1>
            <p className="text-[13px] text-on-surface-variant">This is the first notification. You get a claim number immediately, then call your insurer to continue.</p>
          </div>
        </div>

        <form onSubmit={handleSubmitClaim} className="space-y-5">

          {/* 14-Day Rule Banner */}
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-5 flex items-start gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-red-600 text-2xl">timer</span>
            </div>
            <div>
              <p className="font-extrabold text-red-900 text-[15px]">14-Day Claim Submission Rule</p>
              <p className="text-[13px] text-red-800 mt-1 leading-relaxed">
                Claims must be submitted <strong>within 14 days of the incident</strong>. Claims received after this window will
                not be processed unless a valid written reason for the delay is provided.
              </p>
            </div>
          </div>

          {/* ─── SECTION 1: Contact ─── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-[15px] border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-bold">1</span>
              Your Contact Details
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Full Name *</label>
                <input required value={claimForm.fullName} onChange={e => setClaimField('fullName', e.target.value)}
                  placeholder="e.g. Mwiza Banda"
                  className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Mobile Number *</label>
                <input required type="tel" value={claimForm.phone} onChange={e => setClaimField('phone', e.target.value)}
                  placeholder="e.g. 0970 123 456"
                  className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
                <p className="text-[11px] text-on-surface-variant mt-1">Must match the number on your policy — the insurer will call you back on it.</p>
              </div>
            </div>
          </div>

          {/* ─── SECTION 2: Vehicle Verification ─── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-[15px] border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-bold">2</span>
              Vehicle & Policy Verification
            </h3>

            {/* Plate Number */}
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Vehicle Registration / Plate Number *</label>
              <div className="flex gap-2">
                <input
                  required
                  value={claimForm.plateNumber}
                  onChange={e => { setClaimField('plateNumber', e.target.value.toUpperCase()); setPlateLookupResult(null); setCoverageMismatch(null); }}
                  placeholder="e.g. BAA 1234"
                  className="flex-1 bg-surface-container-low border border-outline-variant rounded-xl p-3 text-[15px] font-mono uppercase tracking-widest focus:ring-2 focus:ring-primary outline-none"
                />
                <button
                  type="button"
                  onClick={handlePlateLookup}
                  disabled={!claimForm.plateNumber.trim() || plateScanning}
                  className="flex items-center gap-2 bg-primary text-white font-bold px-4 py-3 rounded-xl hover:bg-primary-container transition-all disabled:opacity-50 text-[13px] flex-shrink-0"
                >
                  {plateScanning
                    ? <><span className="material-symbols-outlined animate-spin text-[18px]">sync</span> Scanning...</>
                    : <><span className="material-symbols-outlined text-[18px]">document_scanner</span> Verify</>}
                </button>
              </div>

              {/* Plate Lookup Result */}
              {plateLookupResult && !plateLookupResult.notFound && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                  className="mt-3 bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
                  <span className="material-symbols-outlined text-primary text-[20px] mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                  <div>
                    <p className="font-bold text-[13px] text-primary">Policy Found — {plateLookupResult.plate}</p>
                    <p className="text-[12px] text-on-surface-variant mt-0.5">
                      {plateLookupResult.year} {plateLookupResult.make} · Insurer: <strong>{plateLookupResult.insurer}</strong> · Coverage: <strong>{plateLookupResult.coverage}</strong>
                    </p>
                  </div>
                </motion.div>
              )}

            </div>

            {/* Coverage Type */}
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Coverage Type *</label>
              <div className="relative">
                <select
                  required
                  value={claimForm.coverageType}
                  onChange={e => handleCoverageChange(e.target.value)}
                  className={`w-full appearance-none rounded-xl p-3 text-[15px] focus:ring-2 outline-none border-2 ${
                    coverageMismatch
                      ? 'bg-red-50 border-red-400 text-red-900 focus:ring-red-400'
                      : claimForm.coverageType && !coverageMismatch
                        ? 'bg-primary/5 border-primary/40 focus:ring-primary'
                        : 'bg-surface-container-low border-outline-variant focus:ring-primary'
                  }`}
                >
                  <option value="">Select coverage type...</option>
                  <option value="Comprehensive">Comprehensive</option>
                  <option value="Third Party">Third Party</option>
                </select>
                <span className="material-symbols-outlined absolute right-3 top-3.5 text-gray-400 pointer-events-none">expand_more</span>
              </div>
              {/* Coverage mismatch error */}
              {coverageMismatch && (
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
                  className="mt-3 bg-red-50 border-2 border-red-400 rounded-xl p-4 flex items-start gap-3">
                  <span className="material-symbols-outlined text-red-600 text-[22px] mt-0.5">block</span>
                  <div>
                    <p className="font-extrabold text-red-900 text-[14px]">Coverage Mismatch — Cannot Proceed</p>
                    <p className="text-[12px] text-red-800 mt-1 leading-relaxed">{coverageMismatch}</p>
                    <p className="text-[11px] text-red-700 mt-2 font-semibold">Please select the correct coverage type that matches your policy, or contact your insurer.</p>
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
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Insurance Company *</label>
              <div className="relative">
                <select required value={claimForm.insurer} onChange={e => setClaimField('insurer', e.target.value)}
                  className="w-full appearance-none bg-surface-container-low border-2 border-outline-variant rounded-xl p-3.5 text-[15px] focus:ring-2 focus:ring-primary focus:border-primary outline-none">
                  <option value="">Select the insurance company...</option>
                  {INSURER_RATES.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
                </select>
                <span className="material-symbols-outlined absolute right-3 top-3.5 text-gray-400 pointer-events-none">expand_more</span>
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
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-[15px] border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-bold">3</span>
              Claim Details
            </h3>

            {/* Claim Type */}
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Claim Type *</label>
              <div className="relative mb-2">
                <select
                  required
                  value={CLAIM_TYPES.includes(claimForm.type) ? claimForm.type : claimForm.type ? 'Other' : ''}
                  onChange={e => {
                    if (e.target.value === 'Other') { setClaimField('type', 'Other'); }
                    else { setClaimField('type', e.target.value); }
                  }}
                  className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none"
                >
                  <option value="">Select claim type...</option>
                  {CLAIM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="material-symbols-outlined absolute right-3 top-3.5 text-gray-400 pointer-events-none">expand_more</span>
              </div>
              {(claimForm.type === 'Other' || (claimForm.type && !CLAIM_TYPES.slice(0, -1).includes(claimForm.type))) && (
                <div className="mt-2">
                  <input
                    required
                    value={claimForm.type === 'Other' ? '' : claimForm.type}
                    onChange={e => setClaimField('type', e.target.value || 'Other')}
                    placeholder="Please describe the type of claim..."
                    className="w-full bg-surface-container-low border-2 border-primary/40 rounded-xl p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none"
                    autoFocus
                  />
                  <p className="text-[11px] text-secondary mt-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">edit</span> Type your claim description above
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Date of Incident *</label>
                <input required type="date" value={claimForm.incidentDate} max={new Date().toISOString().split('T')[0]}
                  onChange={e => setClaimField('incidentDate', e.target.value)}
                  className={`w-full border rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none ${
                    isLate ? 'bg-red-50 border-red-400 text-red-900 focus:ring-red-400'
                      : daysSinceIncident !== null ? 'bg-primary/5 border-primary/40 focus:ring-primary/40'
                      : 'bg-surface-container-low border-outline-variant'
                  }`} />
                {daysSinceIncident !== null && (
                  <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold ${
                    isLate ? 'bg-red-100 text-red-800' : 'bg-primary/10 text-primary'
                  }`}>
                    <span className="material-symbols-outlined text-[15px]">{isLate ? 'warning' : 'check_circle'}</span>
                    {isLate
                      ? `${daysSinceIncident} days since incident — outside 14-day window`
                      : `${daysSinceIncident} day${daysSinceIncident !== 1 ? 's' : ''} since incident — within 14-day window ✓`}
                  </div>
                )}
              </div>
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Estimated Loss (ZMW)</label>
                <input type="number" min="0" value={claimForm.estimatedLoss} onChange={e => setClaimField('estimatedLoss', e.target.value)}
                  placeholder="e.g. 15000"
                  className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
              </div>
            </div>

            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Incident Location *</label>
              <input required value={claimForm.location} onChange={e => setClaimField('location', e.target.value)}
                placeholder="e.g. Great East Road, near Arcades, Lusaka"
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
            </div>

            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Describe What Happened *</label>
              <textarea required rows={4} value={claimForm.description} onChange={e => setClaimField('description', e.target.value)}
                placeholder="Provide a clear and detailed description of the incident..."
                className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none resize-none" />
            </div>
          </div>

          {/* ─── SECTION 4: Police Report ─── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
            <h3 className="font-bold text-[15px] border-b pb-2 flex items-center gap-2">
              <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-bold">4</span>
              Police Report
            </h3>
            <div className="flex items-center gap-3 p-3 bg-surface-container-low rounded-xl border border-outline-variant cursor-pointer"
              onClick={() => setClaimField('policeReport', !claimForm.policeReport)}>
              <input type="checkbox" checked={claimForm.policeReport} readOnly className="w-5 h-5 rounded text-primary focus:ring-primary" />
              <div>
                <p className="font-semibold text-[14px]">Police Report Filed</p>
                <p className="text-[12px] text-on-surface-variant">Strongly recommended — speeds up claim processing significantly</p>
              </div>
            </div>
            {claimForm.policeReport && (
              <input value={claimForm.policeReportNumber} onChange={e => setClaimField('policeReportNumber', e.target.value)}
                placeholder="Police Case / Report Number e.g. ZP/2025/4421"
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
            )}
          </div>

          {/* ─── SECTION 5: Supporting Documents (Dynamic) ─── */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="font-bold text-[15px] flex items-center gap-2">
                <span className="w-6 h-6 bg-primary text-white text-[11px] rounded-full flex items-center justify-center font-bold">5</span>
                Supporting Documents
              </h3>
              <button type="button" onClick={addDocItem}
                className="flex items-center gap-2 bg-primary/10 text-primary font-bold px-4 py-2 rounded-xl hover:bg-primary/20 transition-colors text-[13px] active:scale-95">
                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                Add Document
              </button>
            </div>

            <div className="mb-4 rounded-xl border border-primary/15 bg-surface-container-low p-4">
              <p className="flex items-center gap-2 text-[13px] font-bold text-on-surface"><span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">checklist</span>Documents usually required for an insurance claim</p>
              <ul className="mt-3 grid gap-1.5 text-[13px] leading-relaxed text-on-surface-variant sm:grid-cols-2">
                {CLAIM_DOCUMENT_GUIDANCE.map(item => <li key={item} className="flex gap-2"><span className="material-symbols-outlined mt-0.5 text-[16px] text-primary" aria-hidden="true">check_circle</span><span>{item}</span></li>)}
              </ul>
              <p className="mt-3 text-[12px] text-secondary">Requirements may vary by insurer and claim type. Add any available supporting documents below.</p>
            </div>

            {docItems.length === 0 ? (
              <div className="border-2 border-dashed border-outline-variant rounded-xl p-8 text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="material-symbols-outlined text-primary text-[24px]">attach_file</span>
                </div>
                <p className="font-semibold text-[14px] text-on-surface">No documents added yet</p>
                <p className="text-[12px] text-on-surface-variant mt-1">Click <strong>Add Document</strong> above to attach photos, a police report, repair quotation, or any other supporting file.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {docItems.map((doc, idx) => (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-outline-variant rounded-xl p-4 bg-surface-container-low/50"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold text-secondary uppercase tracking-wider">Document {idx + 1}</p>
                      <button type="button" onClick={() => removeDocItem(doc.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-50 text-secondary hover:text-red-600 transition-colors">
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
                        className="w-full bg-white border border-outline-variant rounded-lg p-2.5 text-[14px] focus:ring-2 focus:ring-primary outline-none"
                      />
                      {/* File Upload */}
                      <label className={`flex items-center gap-3 p-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                        doc.file ? 'border-primary/40 bg-primary/5' : 'border-outline-variant hover:border-primary/30 hover:bg-gray-50'
                      }`}>
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          doc.file ? 'bg-primary text-white' : 'bg-primary/10 text-primary'
                        }`}>
                          <span className="material-symbols-outlined text-[18px]">{doc.file ? 'check' : 'upload'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {doc.file
                            ? <p className="text-[13px] font-semibold text-primary truncate">{doc.file.name}</p>
                            : <p className="text-[13px] text-secondary">Upload photo or PDF</p>}
                          <p className="text-[10px] text-secondary mt-0.5">JPG, PNG, PDF supported</p>
                        </div>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          onChange={e => e.target.files[0] && updateDocFile(doc.id, e.target.files[0])}
                        />
                        {doc.file && (
                          <button type="button" onClick={e => { e.preventDefault(); updateDocFile(doc.id, null); }}
                            className="text-secondary hover:text-red-500 transition-colors flex-shrink-0">
                            <span className="material-symbols-outlined text-[16px]">close</span>
                          </button>
                        )}
                      </label>
                    </div>
                  </motion.div>
                ))}

                <button type="button" onClick={addDocItem}
                  className="w-full py-3 border-2 border-dashed border-primary/30 text-primary font-semibold rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-all text-[13px] flex items-center justify-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  Add Another Document
                </button>
              </div>
            )}
          </div>

          {/* Late Submission Reason */}
          {isLate && (
            <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600 text-[22px] mt-0.5">report</span>
                <div>
                  <p className="font-extrabold text-red-900 text-[15px]">Late Submission — Reason Required</p>
                  <p className="text-[13px] text-red-800 mt-1">
                    Your incident was <strong>{daysSinceIncident} days ago</strong>, outside the standard 14-day window.
                    You must provide a valid reason. The insurer may still decline at their discretion.
                  </p>
                </div>
              </div>
              <div>
                <label className="text-[12px] font-bold uppercase tracking-wider text-red-800 mb-1.5 block">Reason for Late Submission *</label>
                <textarea required={isLate} rows={4} value={claimForm.lateReason}
                  onChange={e => setClaimField('lateReason', e.target.value)}
                  placeholder="e.g. I was hospitalised following the accident and only discharged on [date]..."
                  className="w-full bg-white border-2 border-red-300 rounded-xl p-3 text-[14px] focus:ring-2 focus:ring-red-400 outline-none resize-none" />
              </div>
            </div>
          )}

          {/* Info Note */}
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-2">
            <span className="material-symbols-outlined text-amber-700 text-[18px] mt-0.5">info</span>
            <p className="text-[13px] text-amber-900">
              <strong>What happens next:</strong> you get a claim number straight away. You then call <strong>{claimForm.insurer || 'the insurer'}</strong>, quote the number, and they handle the assessment and settlement with you directly. Filing a claim may affect future No Claim Discount eligibility.
            </p>
          </div>

          {/* Submit */}
          <button type="submit" disabled={claimSubmitting || isSubmitBlocked || !!coverageMismatch}
            className="w-full bg-primary text-white font-bold text-[16px] py-4 rounded-xl shadow-lg hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50">
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
          <button type="button" onClick={() => setClaimView('list')} aria-label="Back to claims" className="rounded-full p-2 hover:bg-gray-100"><span className="material-symbols-outlined" aria-hidden="true">arrow_back</span></button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-[24px] font-bold text-primary">{claimNumber}</h1>
              <CopyButton value={claimNumber} className="bg-primary/10 text-primary hover:bg-primary/15" />
              <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${CLAIM_STATUSES[claim.status] || 'bg-gray-100 text-gray-700'}`}>{claim.status}</span>
            </div>
            <p className="mt-1 text-[13px] text-secondary">{claim.type} · notified {formatDate(claim.submittedAt)}{received && claim.receivedAt ? ` · received by ${claim.insurer} ${formatDate(claim.receivedAt)}` : ''}</p>
          </div>
        </div>

        <p className={`mt-5 flex items-start gap-3 rounded-xl border p-4 text-[13px] leading-5 ${received ? 'border-primary/20 bg-primary/5 text-on-primary-container' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{received ? 'task_alt' : 'phone_in_talk'}</span>
          <span>{received
            ? <>{claim.insurer} has your claim. They will continue the assessment and settlement with you directly — contact them for any updates.</>
            : <>InsurShield has recorded your notification. <strong>Call {claim.insurer} and quote {claimNumber}</strong> so they can open the claim; everything from there is handled by the insurer.</>}</span>
        </p>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <InsurerCallCard insurerName={claim.insurer} claimNumber={claimNumber} />
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-secondary">What you reported</p>
            <dl className="mt-3 space-y-3">
              <InfoRow label="Vehicle" value={`${claim.vehicle || ''}${claim.plate ? ` · ${claim.plate}` : ''}`} />
              <InfoRow label="Incident date" value={formatDate(claim.incidentDate)} />
              <InfoRow label="Location" value={claim.location} />
              {claim.estimatedLoss && <InfoRow label="Estimated loss" value={formatZMW(parseFloat(claim.estimatedLoss))} highlight />}
              <InfoRow label="Police report" value={claim.policeReport ? `Yes · ${claim.policeReportNumber || 'filed'}` : 'No'} />
            </dl>
            {claim.description && <p className="mt-3 rounded-xl bg-surface-container-low p-3 text-[13px] leading-5 text-on-surface">{claim.description}</p>}
            {claim.supportingDocs?.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {claim.supportingDocs.map((doc, index) => <li key={`${doc.name}-${index}`} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[12px] font-semibold text-secondary"><span className="material-symbols-outlined text-[14px]" aria-hidden="true">attach_file</span>{doc.name || doc.fileName || 'Document'}</li>)}
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
          <button onClick={() => setNcdView('list')} className="p-2 hover:bg-gray-100 rounded-full">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h1 className="text-[24px] font-bold text-primary">Apply for No Claim Discount</h1>
            <p className="text-[13px] text-on-surface-variant">You'll receive a reference number to track this application.</p>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 mb-6">
          <h4 className="font-bold text-blue-900 text-[14px] mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-700 text-[18px]">info</span>
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
                <span className="w-5 h-5 bg-primary text-white text-[11px] font-bold rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-[13px] text-blue-900">{step}</p>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmitNcd} className="space-y-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
            <h3 className="font-bold text-[15px] border-b pb-2">Contact & Application Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Full Name *</label>
                <input required value={ncdForm.fullName} onChange={e => setNcdField('fullName', e.target.value)} placeholder="e.g. Mwiza Banda"
                  className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Mobile Number *</label>
                <input required type="tel" value={ncdForm.phone} onChange={e => setNcdField('phone', e.target.value)} placeholder="e.g. 0970 123 456"
                  className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none" />
                <p className="text-[11px] text-on-surface-variant mt-1">Used to verify and track this application.</p>
              </div>
            </div>

            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Insurance Company *</label>
              <div className="relative">
                <select required value={ncdForm.insurer} onChange={e => setNcdField('insurer', e.target.value)}
                  className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl p-3.5 text-[15px] focus:ring-2 focus:ring-primary outline-none">
                  <option value="">Select insurer you have been using...</option>
                  {INSURER_RATES.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
                </select>
                <span className="material-symbols-outlined absolute right-3 top-3.5 text-gray-400 pointer-events-none">expand_more</span>
              </div>
              <p className="text-[11px] text-on-surface-variant mt-1">You must have been continuously insured with this company for a minimum of 1 year.</p>
            </div>

            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Existing Policy Number *</label>
              <input required value={ncdForm.policyNumber} onChange={e => setNcdField('policyNumber', e.target.value.toUpperCase())} placeholder="e.g. PA-2023-0045"
                className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 font-mono text-[15px] uppercase focus:ring-2 focus:ring-primary outline-none" />
            </div>

            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-2 block">Years Continuously Insured Without a Claim *</label>
              <div className="grid grid-cols-4 gap-2">
                {NCD_TIERS.map(tier => (
                  <div key={tier.years} onClick={() => setNcdField('yearsClaimFree', String(tier.years))}
                    className={`p-3 rounded-xl border-2 cursor-pointer text-center transition-all ${ncdForm.yearsClaimFree === String(tier.years) ? 'bg-primary border-primary text-white' : 'border-gray-200 bg-white hover:border-primary/40'}`}>
                    <p className="text-[20px] font-extrabold">{tier.years}</p>
                    <p className="text-[10px] font-bold uppercase">yr{tier.years > 1 ? 's' : ''}</p>
                    <p className={`text-[12px] font-extrabold mt-1 ${ncdForm.yearsClaimFree === String(tier.years) ? 'text-white' : 'text-primary'}`}>{tier.percentage}%</p>
                  </div>
                ))}
              </div>
              {ncdForm.yearsClaimFree && (
                <div className="mt-3 bg-primary/5 border border-primary/20 p-3 rounded-xl flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <p className="text-[13px] text-on-primary-container">
                    <strong>{NCD_TIERS.find(t => t.years === parseInt(ncdForm.yearsClaimFree))?.percentage}% discount</strong> may apply — subject to insurer verification.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Declaration */}
          <div className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${ncdForm.declaration ? 'bg-primary/5 border-primary/40' : 'bg-white border-gray-200 hover:border-primary/40'}`}
            onClick={() => { setNcdField('declaration', !ncdForm.declaration); setNcdDeclarationError(''); }}>
            <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${ncdForm.declaration ? 'bg-primary/50 border-primary' : 'border-gray-300'}`}>
              {ncdForm.declaration && <span className="material-symbols-outlined text-white text-[14px]">check</span>}
            </div>
            <p className="text-[13px] leading-relaxed text-on-surface">
              <strong>I declare</strong> that I have been continuously insured with the selected company for the stated period and have not made any insurance claims during that time. I understand that false information may result in rejection and legal action.
            </p>
          </div>

          {ncdDeclarationError && <p className="text-[12px] font-medium text-red-700">{ncdDeclarationError}</p>}

          <button type="submit" disabled={ncdSubmitting || !ncdForm.yearsClaimFree || !ncdForm.declaration}
            className="w-full bg-primary text-white font-bold py-4 rounded-xl shadow-lg hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50">
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
          <button onClick={() => setNcdView('list')} className="p-2 hover:bg-gray-100 rounded-full">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="flex-1">
            <h1 className="text-[22px] font-bold text-primary font-mono">{app.applicationNumber}</h1>
            <span className={`text-[11px] font-bold px-3 py-0.5 rounded-full ${statusInfo?.color || 'bg-gray-100 text-gray-700'}`}>{app.status}</span>
          </div>
        </div>

        <dl className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5 space-y-3">
          <InfoRow label="Insurance Company" value={app.insurer} highlight />
          <InfoRow label="Policy Number" value={app.policyNumber} />
          <InfoRow label="Years Claim-Free" value={`${app.yearsClaimFree} year${app.yearsClaimFree > 1 ? 's' : ''}`} />
          <InfoRow label="Potential Discount" value={`${tier?.percentage || app.yearsClaimFree * 10}%`} highlight />
          <InfoRow label="Submitted" value={formatDate(app.submittedAt)} />
        </dl>

        {/* Progress */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5">
          <h3 className="font-bold text-[13px] uppercase text-on-surface-variant border-b pb-2 mb-4">Application Progress</h3>
          <div className="relative">
            <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gray-100" />
            <div className="space-y-4">
              {NCD_APPLICATION_STATUSES.filter(s => s.id !== 'Rejected').map((status, idx) => {
                const isDone = idx <= currentStatusIdx;
                const isCurrent = idx === currentStatusIdx;
                return (
                  <div key={status.id} className="relative flex items-center gap-4 pl-2">
                    <div className={`w-6 h-6 rounded-full z-10 flex-shrink-0 flex items-center justify-center ${isDone ? 'bg-primary' : 'border-2 border-gray-200 bg-white'}`}>
                      {isDone && <span className="material-symbols-outlined text-white text-[12px]">check</span>}
                    </div>
                    <div className={`text-[13px] ${isCurrent ? 'font-bold text-primary' : isDone ? 'text-on-surface' : 'text-on-surface-variant opacity-40'}`}>
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
          <div className="bg-primary/5 border-2 border-primary/40 rounded-2xl p-5 text-center">
            <span className="material-symbols-outlined text-primary text-4xl mb-2" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
            <h3 className="font-extrabold text-on-primary-container text-[18px] mb-1">NCD Approved!</h3>
            <p className="text-[13px] text-primary mb-3">Use this code when requesting a quotation from <strong>{app.insurer}</strong>.</p>
            <div className="bg-white border border-primary/30 rounded-xl p-4 mb-3">
              <p className="text-[12px] text-primary font-bold uppercase mb-1">Your NCD Code</p>
              <p className="text-[32px] font-extrabold text-primary font-mono tracking-widest">{app.approvedCode}</p>
              <p className="text-[11px] text-amber-700 font-bold mt-1">⚠️ Valid for {app.insurer} only · Single use</p>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => navigator.clipboard?.writeText(app.approvedCode)} className="flex items-center gap-2 px-5 py-2.5 border-2 border-primary text-primary font-bold rounded-xl hover:bg-primary/5">
                <span className="material-symbols-outlined text-[18px]">content_copy</span> Copy Code
              </button>
              <button onClick={() => navigate('/insurance-type')} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary-container">
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-5xl px-5 py-10 pb-24 sm:px-8">
      <header className="max-w-2xl">
        <h1 className="text-[36px] font-extrabold tracking-[-.04em] text-on-surface sm:text-[42px]">Claims & NCD</h1>
        <p className="mt-2 text-[16px] text-on-surface-variant">Notify your insurer of an incident, follow each claim's progress, and apply for a No Claim Discount — all linked to your account.</p>
      </header>

      <div role="tablist" aria-label="Claims and NCD" className="mt-7 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {[
          { id: 'claims', label: 'Claims', icon: 'report_problem', count: myClaims.length },
          { id: 'ncd', label: 'NCD applications', icon: 'sell', count: myNcdApps.length },
        ].map(tab => (
          <button key={tab.id} type="button" role="tab" aria-selected={mainTab === tab.id} onClick={() => setMainTab(tab.id)}
            className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-[14px] font-semibold transition-all ${mainTab === tab.id ? 'bg-primary text-white shadow-sm' : 'text-secondary hover:text-primary'}`}>
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{tab.icon}</span>
            {tab.label}
            {tab.count > 0 && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${mainTab === tab.id ? 'bg-white/20' : 'bg-primary/10 text-primary'}`}>{tab.count}</span>}
          </button>
        ))}
      </div>

      {mainTab === 'claims' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
          <div className="min-w-0 space-y-6">
            <button type="button" onClick={() => setClaimView('new')}
              className="group flex w-full items-center gap-5 rounded-2xl bg-primary p-6 text-left text-white transition-colors hover:bg-primary-container">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15"><span className="material-symbols-outlined text-[28px]" aria-hidden="true">add_circle</span></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[18px] font-extrabold">Start a claim</span>
                <span className="mt-1 block text-[13px] text-white/85">Complete the first notification and get a claim number to quote to your insurer.</span>
              </span>
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
            </button>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-[20px] font-extrabold">My claims</h2>
              {myClaims.length ? (
                <ul className="mt-4 divide-y divide-slate-100">
                  {myClaims.map(claim => (
                    <li key={claim.id}>
                      <button type="button" onClick={() => openClaim(claim)} className="flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-slate-50">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">directions_car</span></span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-bold text-on-surface">{claim.type || 'Claim'} <span className="font-mono text-[13px] text-secondary">· {claim.claimNumber || claim.id}</span></span>
                          <span className="mt-0.5 block text-[12px] text-secondary">{claim.insurer} · incident {formatDate(claim.incidentDate)}</span>
                          <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold sm:hidden ${CLAIM_STATUSES[claim.status] || 'bg-gray-100 text-gray-700'}`}>{claim.status}</span>
                        </span>
                        <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold sm:inline-block ${CLAIM_STATUSES[claim.status] || 'bg-gray-100 text-gray-700'}`}>{claim.status}</span>
                        <span className="material-symbols-outlined shrink-0 text-secondary" aria-hidden="true">chevron_right</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 rounded-xl bg-surface-container-low p-4 text-[14px] text-secondary">No claims yet. If something happens, start a claim here and your insurer will pick it up.</p>
              )}
            </section>
          </div>

          <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-[16px] font-extrabold">How a claim works</h2>
            <ol className="mt-4 space-y-4">
              {[
                { icon: 'description', title: 'Tell us what happened', desc: 'Choose the insurer, describe the incident and attach photos or a police report.' },
                { icon: 'confirmation_number', title: 'Get a claim number', desc: 'You receive it immediately and it is saved to your account.' },
                { icon: 'phone_in_talk', title: 'Your insurer takes over', desc: 'Quote the number when you call; the insurer handles assessment and settlement with you directly.' },
              ].map((item, index) => (
                <li key={item.title} className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-extrabold text-white">{index + 1}</span>
                  <span>
                    <span className="block text-[14px] font-bold text-on-surface">{item.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-5 text-on-surface-variant">{item.desc}</span>
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
              className="group flex w-full items-center gap-5 rounded-2xl bg-primary p-6 text-left text-white transition-colors hover:bg-primary-container">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15"><span className="material-symbols-outlined text-[28px]" aria-hidden="true">sell</span></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[18px] font-extrabold">Apply for a No Claim Discount</span>
                <span className="mt-1 block text-[13px] text-white/85">One or more claim-free years can earn up to 40% off your next premium.</span>
              </span>
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
            </button>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-[20px] font-extrabold">My applications</h2>
              {myNcdApps.length ? (
                <ul className="mt-4 divide-y divide-slate-100">
                  {myNcdApps.map(app => {
                    const status = NCD_APPLICATION_STATUSES.find(item => item.id === app.status);
                    return (
                      <li key={app.id}>
                        <button type="button" onClick={() => openNcdApp(app)} className="flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-slate-50">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">sell</span></span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-bold text-on-surface">{app.yearsClaimFree} claim-free year{app.yearsClaimFree === 1 ? '' : 's'} <span className="font-mono text-[13px] text-secondary">· {app.applicationNumber}</span></span>
                            <span className="mt-0.5 block text-[12px] text-secondary">{app.insurer} · policy {app.policyNumber}{app.approvedCode ? ` · code ${app.approvedCode}` : ''}</span>
                            <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold sm:hidden ${status?.color || 'bg-gray-100 text-gray-700'}`}>{app.status}</span>
                          </span>
                          <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold sm:inline-block ${status?.color || 'bg-gray-100 text-gray-700'}`}>{app.status}</span>
                          <span className="material-symbols-outlined shrink-0 text-secondary" aria-hidden="true">chevron_right</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 rounded-xl bg-surface-container-low p-4 text-[14px] text-secondary">No applications yet. Apply once you have at least one claim-free year with an insurer.</p>
              )}
            </section>
          </div>

          <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-[16px] font-extrabold">Discount scale</h2>
            <ul className="mt-4 grid grid-cols-2 gap-3">
              {NCD_TIERS.map(tier => (
                <li key={tier.years} className="rounded-xl border border-primary/10 bg-primary/5 p-3 text-center">
                  <p className="text-[24px] font-extrabold text-primary">{tier.percentage}%</p>
                  <p className="text-[11px] font-bold uppercase text-secondary">{tier.years} claim-free yr{tier.years > 1 ? 's' : ''}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-5 text-on-surface-variant">Maximum 40% after four consecutive claim-free years. Subject to insurer approval; the approved code is applied when you next request quotes.</p>
          </aside>
        </div>
      )}
    </motion.div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase text-secondary">{label}</dt>
      <dd className={`text-[14px] font-semibold ${highlight ? 'text-primary' : 'text-on-surface'}`}>{value || '—'}</dd>
    </div>
  );
}
