import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';
import { formatZMW } from '../utils/premiumEngine';
import { INSURER_RATES } from '../utils/insurerRates';

const CLAIM_TYPES = [
  'Accident / Collision', 'Theft', 'Fire Damage', 'Natural Disaster',
  'Third Party Liability', 'Windscreen Damage', 'Medical Expenses', 'Towing & Recovery',
  'Other',
];

const CLAIM_STATUSES = {
  Submitted:    'bg-blue-100 text-blue-800',
  'Under Review': 'bg-amber-100 text-amber-800',
  'Additional Information Required': 'bg-orange-100 text-orange-800',
  Approved:     'bg-green-100 text-green-800',
  Rejected:     'bg-red-100 text-red-800',
  Settled:      'bg-emerald-100 text-emerald-800',
};

const NCD_TIERS = [
  { years: 1, percentage: 10 }, { years: 2, percentage: 20 },
  { years: 3, percentage: 30 }, { years: 4, percentage: 40 },
];

const NCD_APPLICATION_STATUSES = [
  { id: 'Submitted', color: 'bg-blue-100 text-blue-800' },
  { id: 'Under Review', color: 'bg-amber-100 text-amber-800' },
  { id: 'Verification Required', color: 'bg-orange-100 text-orange-800' },
  { id: 'Approved', color: 'bg-green-100 text-green-800' },
  { id: 'Rejected', color: 'bg-red-100 text-red-800' },
];

const CLAIM_DOCUMENT_GUIDANCE = [
  'Completed claim form',
  'Copy of the driver\'s licence',
  'Police report or case reference (for accidents, theft, or malicious damage)',
  'Vehicle registration / White Book',
  'Accident photos and repair quotation, where available',
];

// Mock seeded data for tracking demo
const SEED_CLAIMS = [
  {
    id: 'CLM-882031', referenceNumber: 'CLM-882031', phone: '0970123456',
    insurer: 'Prestige Assurance', type: 'Accident / Collision',
    incidentDate: '2025-06-10', location: 'Great East Road, near Arcades',
    description: 'Rear-ended at traffic lights. Third party vehicle fled the scene.',
    estimatedLoss: '45000', policeReport: true, policeReportNumber: 'ZP/2025/4421',
    status: 'Under Review',
    submittedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    deadlineDate: new Date(Date.now() + 10 * 86400000).toISOString(),
    timeline: [
      { status: 'Submitted', note: 'Claim received and logged.', date: new Date(Date.now() - 4 * 86400000).toISOString() },
      { status: 'Under Review', note: 'Assigned to claims assessor. Site inspection scheduled.', date: new Date(Date.now() - 2 * 86400000).toISOString() },
    ],
    messages: [
      { id: 1, senderType: 'insurer', message: 'Your claim has been received and assigned to our assessment team. An assessor will contact you within 2 business days to schedule a vehicle inspection.', sentAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    ],
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
function SuccessBanner({ refNumber, phone, onDone, type = 'claim' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(refNumber); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-lg mx-auto px-4 py-12 text-center">
      <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
        <span className="material-symbols-outlined text-green-500 text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
      </div>
      <h2 className="text-[26px] font-extrabold text-primary mb-2">
        {type === 'claim' ? 'Claim Submitted!' : 'NCD Application Submitted!'}
      </h2>
      <p className="text-[14px] text-on-surface-variant mb-6">
        {type === 'claim' ? 'Your claim notification has been recorded. Save the claim number below and call the insurer directly so they can begin processing it.' : 'Your NCD application has been sent to the insurer. Save your reference number below.'}
      </p>

      {/* Reference Number Card */}
      <div className="bg-primary text-white rounded-2xl p-6 mb-5 relative overflow-hidden shadow-lg shadow-primary/20">
        <div className="absolute inset-0 opacity-10 text-[5rem] font-black flex items-center justify-center select-none">REF</div>
        <p className="text-[12px] font-bold uppercase tracking-widest text-white/70 mb-2">Your Reference Number</p>
        <p className="text-[32px] font-extrabold tracking-widest font-mono">{refNumber}</p>
        <button onClick={copy} className="mt-3 flex items-center gap-2 mx-auto bg-white/20 hover:bg-white/30 text-white font-bold px-5 py-2 rounded-xl transition-colors text-[13px]">
          <span className="material-symbols-outlined text-[16px]">{copied ? 'check' : 'content_copy'}</span>
          {copied ? 'Copied!' : 'Copy Reference'}
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-left">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-amber-600 text-[18px] mt-0.5">warning</span>
          <div>
            <p className="font-bold text-amber-900 text-[13px]">Important — Save This Number</p>
            <p className="text-[12px] text-amber-800 mt-1">
            {type === 'claim' ? <>Call the insurer you selected and quote this <strong>claim number</strong>. They will guide the remaining assessment and settlement process. Keep the phone number <strong>{phone}</strong> available for verification.</> : <>You will need the phone number <strong>{phone}</strong> you provided to track this application.</>}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={onDone} className="py-3 bg-surface-container-low text-primary font-semibold rounded-xl border border-outline-variant hover:bg-gray-100 transition-colors">
          Back to Claims
        </button>
        <button onClick={onDone} className="py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-container transition-colors">
          {type === 'claim' ? 'I have saved my claim number' : 'Track Application'}
        </button>
      </div>
    </motion.div>
  );
}

function TrackingLookup({ type = 'claim', onFound }) {
  const [refInput, setRefInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { claims, ncdApplications } = useStore();

  const handleSearch = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      const allClaims = [...claims, ...SEED_CLAIMS];
      const allNcd = [...ncdApplications, ...SEED_NCD];
      const pool = type === 'claim' ? allClaims : allNcd;
      const refKey = type === 'claim' ? 'referenceNumber' : 'applicationNumber';
      const record = pool.find(r =>
        (r[refKey] || r.id) === refInput.trim().toUpperCase() &&
        (r.phone || '').replace(/\s/g, '') === phoneInput.replace(/\s/g, '')
      );
      if (record) {
        onFound(record);
      } else {
        setError('No record found. Please check your reference number and phone number.');
      }
    }, 1000);
  };

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-2xl">manage_search</span>
          </div>
          <div>
            <h3 className="font-bold text-[17px] text-primary">Track Your {type === 'claim' ? 'Claim' : 'NCD Application'}</h3>
            <p className="text-[12px] text-on-surface-variant">Enter your reference number and phone</p>
          </div>
        </div>
        <form onSubmit={handleSearch} className="space-y-4">
          <div>
            <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">
              Reference Number
            </label>
            <input
              required
              value={refInput}
              onChange={e => setRefInput(e.target.value.toUpperCase())}
              placeholder={type === 'claim' ? 'e.g. CLM-882031' : 'e.g. NCDA-991200'}
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 font-mono text-[15px] uppercase tracking-widest focus:ring-2 focus:ring-primary outline-none"
            />
          </div>
          <div>
            <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">
              Mobile Number Used When Submitting
            </label>
            <input
              required
              type="tel"
              value={phoneInput}
              onChange={e => setPhoneInput(e.target.value)}
              placeholder="e.g. 0970123456"
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 p-3 rounded-lg">
              <span className="material-symbols-outlined text-red-600 text-[16px]">error</span>
              <p className="text-[13px] text-red-800">{error}</p>
            </div>
          )}
          <button type="submit" disabled={loading} className="w-full bg-primary text-white font-bold py-3.5 rounded-xl hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? <><span className="material-symbols-outlined animate-spin text-[18px]">sync</span> Searching...</> : <><span className="material-symbols-outlined text-[18px]">search</span> Find My {type === 'claim' ? 'Claim' : 'Application'}</>}
          </button>
        </form>
        <div className="mt-4 bg-blue-50 border border-blue-100 p-3 rounded-xl">
          <p className="text-[12px] text-blue-800">
            <strong>Tip:</strong> Your reference number was shown on screen when you submitted, and sent via SMS to your phone. For demo: use ref <strong>{type === 'claim' ? 'CLM-882031' : 'NCDA-991200'}</strong> and phone <strong>0970123456</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ClaimsPage() {
  const navigate = useNavigate();
  const { claims, addClaim, addClaimMessage, vehicleDetails, ncdApplications, addNcdApplication, customer } = useStore();

  // Main tab
  const [mainTab, setMainTab] = useState('claims');
  // Sub-view per tab: 'list' | 'new' | 'track' | 'detail' | 'success'
  const [claimView, setClaimView] = useState('list');
  const [ncdView, setNcdView] = useState('list');

  const [selectedClaim, setSelectedClaim] = useState(null);
  const [selectedNcdApp, setSelectedNcdApp] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [submittedRef, setSubmittedRef] = useState(null);
  const [submittedPhone, setSubmittedPhone] = useState('');

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

  // ─── Handlers ───────────────────────────────────────────────
  const handleSubmitClaim = (e) => {
    e.preventDefault();
    if (coverageMismatch) return; // block if mismatch
    setClaimSubmitting(true);
    setTimeout(() => {
      const refNumber = `CLM-${Math.floor(100000 + Math.random() * 900000)}`;
      addClaim({
        ...claimForm, referenceNumber: refNumber, status: 'Submitted',
        vehicle: vehicleDetails ? `${vehicleDetails.year} ${vehicleDetails.make} ${vehicleDetails.model}` : 'Your Vehicle',
        plate: claimForm.plateNumber || vehicleDetails?.plateNumber || 'N/A',
        claimNumber: refNumber,
        timeline: [{ status: 'Submitted', note: 'Claim submitted. Forwarded to insurer.', date: new Date().toISOString() }],
        messages: [],
        deadlineDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        supportingDocs: docItems.map(d => ({ name: d.name, fileName: d.file?.name || null })),
      });
      setSubmittedRef(refNumber);
      setSubmittedPhone(claimForm.phone);
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
      setSubmittedPhone(ncdForm.phone);
      setNcdSubmitting(false);
      setNcdForm({ insurer: '', policyNumber: '', yearsClaimFree: '', phone: '', fullName: '', declaration: false });
      setNcdView('success');
    }, 1400);
  };

  const handleSendClaimMessage = (claimId) => {
    if (!newMessage.trim()) return;
    addClaimMessage(claimId, { senderType: 'customer', message: newMessage.trim() });
    setNewMessage('');
  };

  // ═══════════════════════════════════════════════════════════════
  // VIEWS: Claims
  // ═══════════════════════════════════════════════════════════════

  // ── Success ──
  if (mainTab === 'claims' && claimView === 'success') {
    return <SuccessBanner refNumber={submittedRef} phone={submittedPhone} type="claim"
      onDone={() => { setClaimView('track'); }} />;
  }

  // ── New Claim Form ──
  if (mainTab === 'claims' && claimView === 'new') {

    // Prototype plate lookup — always returns a realistic result for any plate
    const INSURERS_LIST = [
      { name: 'Prestige Assurance', coverage: 'Comprehensive' },
      { name: 'Madison General Insurance', coverage: 'Third Party' },
      { name: 'ZSIC General Insurance', coverage: 'Comprehensive' },
      { name: 'Hollard Insurance Zambia', coverage: 'Third Party' },
      { name: 'Professional Insurance Corp.', coverage: 'Comprehensive' },
      { name: 'NICO Insurance', coverage: 'Third Party' },
    ];
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
        // Generate a deterministic-looking result from the plate string
        const hash = plate.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const insurer = INSURERS_LIST[hash % INSURERS_LIST.length];
        const make = MAKES[hash % MAKES.length];
        const year = YEARS[(hash + 3) % YEARS.length];
        const result = { insurer: insurer.name, coverage: insurer.coverage, make, year, plate };
        setPlateLookupResult(result);
        setClaimField('insurer', insurer.name);
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
            <h1 className="text-[24px] font-bold text-primary">Submit a Claim</h1>
            <p className="text-[13px] text-on-surface-variant">You will receive a reference number to track your claim — no account needed.</p>
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
                <p className="text-[11px] text-on-surface-variant mt-1">⚠️ Must match the number on your policy. Used to verify your claim status later.</p>
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
                      : daysSinceIncident !== null ? 'bg-green-50 border-green-400 focus:ring-green-400'
                      : 'bg-surface-container-low border-outline-variant'
                  }`} />
                {daysSinceIncident !== null && (
                  <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold ${
                    isLate ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
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

            <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-[13px] font-bold text-blue-900">Documents usually required for an insurance claim</p>
              <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-blue-800">
                {CLAIM_DOCUMENT_GUIDANCE.map(item => <li key={item} className="flex gap-2"><span aria-hidden="true">•</span><span>{item}</span></li>)}
              </ul>
              <p className="mt-2 text-[11px] text-blue-700">Requirements may vary by insurer and claim type. Add any available supporting documents below.</p>
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
              <strong>Note:</strong> Once submitted, your claim is forwarded directly to <strong>{claimForm.insurer || 'the selected insurer'}</strong>. Filing a claim may affect future No Claim Discount eligibility.
            </p>
          </div>

          {/* Submit */}
          <button type="submit" disabled={claimSubmitting || isSubmitBlocked || !!coverageMismatch}
            className="w-full bg-primary text-white font-bold text-[16px] py-4 rounded-xl shadow-lg hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50">
            {claimSubmitting
              ? <><span className="material-symbols-outlined animate-spin">sync</span> Submitting Claim...</>
              : coverageMismatch
                ? <><span className="material-symbols-outlined">block</span> Fix Coverage Mismatch to Submit</>
                : isSubmitBlocked
                  ? <><span className="material-symbols-outlined">lock</span> Provide Late Reason to Submit</>
                  : <><span className="material-symbols-outlined">send</span> Submit Claim to {claimForm.insurer || 'Insurer'}</>}
          </button>
        </form>
      </motion.div>
    );
  }

  // ── Claim Detail (after tracking lookup) ──
  if (mainTab === 'claims' && claimView === 'detail' && selectedClaim) {
    const claim = allClaims.find(c => c.id === selectedClaim.id) || selectedClaim;
    const daysLeft = Math.max(0, Math.ceil((new Date(claim.deadlineDate) - new Date()) / 86400000));
    const statusColor = CLAIM_STATUSES[claim.status] || 'bg-gray-100 text-gray-700';

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setClaimView('track')} className="p-2 hover:bg-gray-100 rounded-full">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="flex-1">
            <h1 className="text-[22px] font-bold text-primary font-mono">{claim.referenceNumber || claim.id}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className={`text-[11px] font-bold px-3 py-0.5 rounded-full ${statusColor}`}>{claim.status}</span>
              {claim.insurer && <span className="text-[12px] text-secondary">· {claim.insurer}</span>}
              <span className="text-[12px] text-secondary">· {claim.type}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <h3 className="font-bold text-[13px] uppercase tracking-wider text-on-surface-variant border-b pb-2">Claim Details</h3>
            {claim.insurer && <InfoRow label="Insurance Company" value={claim.insurer} highlight />}
            <InfoRow label="Claim Type" value={claim.type} />
            <InfoRow label="Incident Date" value={claim.incidentDate} />
            <InfoRow label="Location" value={claim.location} />
            {claim.estimatedLoss && <InfoRow label="Estimated Loss" value={formatZMW(parseFloat(claim.estimatedLoss))} highlight />}
            <div>
              <p className="text-[11px] uppercase text-secondary font-bold mb-1">Resolution Deadline</p>
              <span className={`inline-flex items-center gap-1 text-[12px] font-bold px-3 py-1 rounded-full ${daysLeft < 3 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>
                <span className="material-symbols-outlined text-[14px]">schedule</span> {daysLeft} days remaining
              </span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-bold text-[13px] uppercase tracking-wider text-on-surface-variant border-b pb-2 mb-4">Progress Timeline</h3>
            <div className="relative">
              <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gray-100" />
              <div className="space-y-4">
                {(claim.timeline || []).map((step, i) => (
                  <div key={i} className="relative flex items-start gap-4 pl-2">
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center z-10 flex-shrink-0">
                      <span className="material-symbols-outlined text-white text-[12px]">check</span>
                    </div>
                    <div>
                      <p className="font-bold text-[13px] text-primary">{step.status}</p>
                      <p className="text-[12px] text-on-surface-variant">{step.note}</p>
                      <p className="text-[10px] text-secondary mt-0.5">{new Date(step.date).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-bold text-[13px] uppercase tracking-wider text-on-surface-variant border-b pb-2 mb-4">
            Messages from {claim.insurer || 'Insurer'}
          </h3>
          <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
            {(claim.messages || []).length === 0 && (
              <p className="text-[13px] text-on-surface-variant text-center py-4">No messages yet. The insurer will contact you here.</p>
            )}
            {(claim.messages || []).map(msg => (
              <div key={msg.id} className={`flex ${msg.senderType === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-sm p-3 rounded-2xl text-[13px] ${msg.senderType === 'customer' ? 'bg-primary text-white rounded-br-sm' : 'bg-surface-container-low text-on-surface rounded-bl-sm'}`}>
                  {msg.senderType !== 'customer' && <p className="text-[10px] font-bold text-primary mb-1 opacity-70">{claim.insurer?.toUpperCase() || 'INSURER'}</p>}
                  <p>{msg.message}</p>
                  <p className={`text-[10px] mt-1 ${msg.senderType === 'customer' ? 'text-white/60' : 'text-secondary'}`}>
                    {new Date(msg.sentAt).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}
                    {' · '}
                    {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newMessage} onChange={e => setNewMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendClaimMessage(claim.id)}
              placeholder={`Message to ${claim.insurer || 'insurer'}...`}
              className="flex-1 bg-surface-container-low border border-outline-variant rounded-xl px-4 py-2.5 text-[14px] focus:ring-2 focus:ring-primary outline-none" />
            <button onClick={() => handleSendClaimMessage(claim.id)} className="bg-primary text-white px-4 py-2.5 rounded-xl hover:bg-primary-container transition-colors">
              <span className="material-symbols-outlined text-[20px]">send</span>
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  // ── Claim Track ──
  if (mainTab === 'claims' && claimView === 'track') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setClaimView('list')} className="p-2 hover:bg-gray-100 rounded-full">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="text-[24px] font-bold text-primary">Track Your Claim</h1>
        </div>
        <TrackingLookup type="claim" onFound={record => { setSelectedClaim(record); setClaimView('detail'); }} />
      </motion.div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // VIEWS: NCD Applications
  // ════════════════════════════════════════════════════════════════

  if (mainTab === 'ncd' && ncdView === 'success') {
    return <SuccessBanner refNumber={submittedRef} phone={submittedPhone} type="ncd"
      onDone={() => { setNcdView('track'); }} />;
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
                <div className="mt-3 bg-green-50 border border-green-200 p-3 rounded-xl flex items-center gap-2">
                  <span className="material-symbols-outlined text-green-600 text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                  <p className="text-[13px] text-green-900">
                    <strong>{NCD_TIERS.find(t => t.years === parseInt(ncdForm.yearsClaimFree))?.percentage}% discount</strong> may apply — subject to insurer verification.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Declaration */}
          <div className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${ncdForm.declaration ? 'bg-green-50 border-green-400' : 'bg-white border-gray-200 hover:border-primary/40'}`}
            onClick={() => { setNcdField('declaration', !ncdForm.declaration); setNcdDeclarationError(''); }}>
            <div className={`w-6 h-6 rounded-md border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${ncdForm.declaration ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
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

  if (mainTab === 'ncd' && ncdView === 'track') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setNcdView('list')} className="p-2 hover:bg-gray-100 rounded-full">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="text-[24px] font-bold text-primary">Track NCD Application</h1>
        </div>
        <TrackingLookup type="ncd" onFound={record => { setSelectedNcdApp(record); setNcdView('detail'); }} />
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
          <button onClick={() => setNcdView('track')} className="p-2 hover:bg-gray-100 rounded-full">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="flex-1">
            <h1 className="text-[22px] font-bold text-primary font-mono">{app.applicationNumber}</h1>
            <span className={`text-[11px] font-bold px-3 py-0.5 rounded-full ${statusInfo?.color || 'bg-gray-100 text-gray-700'}`}>{app.status}</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-5 space-y-3">
          <InfoRow label="Insurance Company" value={app.insurer} highlight />
          <InfoRow label="Policy Number" value={app.policyNumber} />
          <InfoRow label="Years Claim-Free" value={`${app.yearsClaimFree} year${app.yearsClaimFree > 1 ? 's' : ''}`} />
          <InfoRow label="Potential Discount" value={`${tier?.percentage || app.yearsClaimFree * 10}%`} highlight />
          <InfoRow label="Submitted" value={new Date(app.submittedAt).toLocaleDateString()} />
        </div>

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
          <div className="bg-green-50 border-2 border-green-400 rounded-2xl p-5 text-center">
            <span className="material-symbols-outlined text-green-600 text-4xl mb-2" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
            <h3 className="font-extrabold text-green-900 text-[18px] mb-1">NCD Approved!</h3>
            <p className="text-[13px] text-green-800 mb-3">Use this code when requesting a quotation from <strong>{app.insurer}</strong>.</p>
            <div className="bg-white border border-green-300 rounded-xl p-4 mb-3">
              <p className="text-[12px] text-green-700 font-bold uppercase mb-1">Your NCD Code</p>
              <p className="text-[32px] font-extrabold text-primary font-mono tracking-widest">{app.approvedCode}</p>
              <p className="text-[11px] text-amber-700 font-bold mt-1">⚠️ Valid for {app.insurer} only · Single use</p>
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={() => navigator.clipboard?.writeText(app.approvedCode)} className="flex items-center gap-2 px-5 py-2.5 border-2 border-primary text-primary font-bold rounded-xl hover:bg-primary/5">
                <span className="material-symbols-outlined text-[18px]">content_copy</span> Copy Code
              </button>
              <button onClick={() => navigate('/select-insurers')} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-bold rounded-xl hover:bg-primary-container">
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
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-[1500px] mx-auto px-5 py-10 pb-24 sm:px-8 lg:py-12">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[40px] font-extrabold tracking-[-.045em] text-primary">Claims & NCD</h1>
        <p className="mt-2 text-[18px] text-on-surface-variant">Manage claim notifications and No Claim Discount applications from your account.</p>
      </div>

      {/* Account banner */}
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-7 flex items-start gap-4">
        <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary text-2xl">badge</span>
        </div>
        <div>
          <p className="font-bold text-primary text-[15px]">Your account keeps everything together.</p>
          <p className="text-[13px] text-on-surface-variant mt-1">
            Signed in as <strong>{customer?.fullName || customer?.phone}</strong>. Your claim notifications and NCD applications are connected to this account, so you can return to them without a tracking link.
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <div className="flex gap-2 mb-7 bg-white p-1 rounded-xl border border-slate-200">
        {[
          { id: 'claims', label: 'Claims', icon: 'report_problem' },
          { id: 'ncd', label: 'NCD applications', icon: 'discount' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setMainTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-[15px] font-semibold transition-all ${mainTab === tab.id ? 'bg-white shadow text-primary border border-gray-100' : 'text-secondary hover:text-primary'}`}>
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Claims Tab ── */}
      {mainTab === 'claims' && (
        <>
          {/* Action Cards */}
          <div className="grid grid-cols-1 mb-8">
            <button onClick={() => setClaimView('new')}
              className="bg-primary text-white rounded-2xl p-8 text-left hover:shadow-sm transition-colors group">
              <span className="material-symbols-outlined text-3xl mb-3 block opacity-80">add_circle</span>
              <p className="font-extrabold text-[18px] mb-1">Start a Claim</p>
              <p className="text-[13px] text-white/80">Complete the first notification step and receive a claim number to quote when you call your insurer.</p>
              <div className="mt-4 flex items-center gap-1 font-bold text-[13px]">
                Start Claim <span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </div>
            </button>

          </div>

          {/* What to Expect */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="font-extrabold text-[22px] mb-5">How the Claims Process Works</h3>
            <div className="space-y-4">
              {[
                { icon: 'description', step: '1', title: 'Submit Your Claim', desc: 'Fill in the claim form selecting the insurer and describing the incident. Attach photos and police report if available.' },
                { icon: 'sms', step: '2', title: 'Save Your Claim Number', desc: 'You will receive a claim number immediately after submitting this form.' },
                { icon: 'phone_in_talk', step: '3', title: 'Call Your Insurer', desc: 'Call the insurer directly and quote your claim number so their claims team can open and process the case.' },
              ].map(item => (
                <div key={item.step} className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-primary text-[20px]">{item.icon}</span>
                  </div>
                  <div>
                    <p className="font-bold text-[14px] text-primary">{item.title}</p>
                    <p className="text-[13px] text-on-surface-variant mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── NCD Tab ── */}
      {mainTab === 'ncd' && (
        <>
          <div className="grid grid-cols-1 mb-6">
            <button onClick={() => setNcdView('new')}
              className="bg-primary text-white rounded-2xl p-6 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all group">
              <span className="material-symbols-outlined text-3xl mb-3 block opacity-80">discount</span>
              <p className="font-extrabold text-[18px] mb-1">Apply for NCD</p>
              <p className="text-[13px] text-white/80">Have 1+ year with no claims? Apply for up to 40% discount.</p>
              <div className="mt-4 flex items-center gap-1 font-bold text-[13px]">
                Apply Now <span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
              </div>
            </button>
          </div>

          {/* NCD Scale Reference */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-bold text-[15px] text-primary mb-4">NCD Discount Scale</h3>
            <div className="grid grid-cols-4 gap-3 mb-3">
              {NCD_TIERS.map(tier => (
                <div key={tier.years} className="bg-primary/5 border border-primary/10 rounded-xl p-3 text-center">
                  <p className="text-[24px] font-extrabold text-primary">{tier.percentage}%</p>
                  <p className="text-[11px] font-bold uppercase text-secondary">{tier.years} Yr{tier.years > 1 ? 's' : ''}</p>
                </div>
              ))}
            </div>
            <p className="text-[12px] text-on-surface-variant text-center">Maximum discount: 40% after 4 consecutive claim-free years. Subject to insurer approval.</p>
          </div>
        </>
      )}
    </motion.div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div>
      <p className="text-[11px] uppercase text-secondary font-bold">{label}</p>
      <p className={`text-[14px] font-semibold ${highlight ? 'text-primary' : 'text-on-surface'}`}>{value}</p>
    </div>
  );
}
