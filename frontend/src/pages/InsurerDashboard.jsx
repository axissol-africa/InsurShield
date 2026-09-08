import { useState } from 'react';
import { useStore } from '../store/useStore';
import { motion, AnimatePresence } from 'framer-motion';
import { formatZMW } from '../utils/premiumEngine';

// The insurer this portal is logged in as (in a real app this comes from auth)
const MY_INSURER = 'Prestige Assurance';

const CLAIM_STATUSES = {
  Submitted:    { color: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500' },
  'Under Review': { color: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  'Additional Information Required': { color: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500' },
  Approved:     { color: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  Rejected:     { color: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
  Settled:      { color: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
};

const CLAIM_NEXT_STATUSES = {
  Submitted:    ['Under Review', 'Additional Information Required', 'Rejected'],
  'Under Review': ['Approved', 'Additional Information Required', 'Rejected'],
  'Additional Information Required': ['Under Review', 'Approved', 'Rejected'],
  Approved:     ['Settled'],
  Rejected:     [],
  Settled:      [],
};

const NCD_STATUSES = {
  Submitted: { color: 'bg-blue-100 text-blue-800' },
  'Under Review': { color: 'bg-amber-100 text-amber-800' },
  Approved: { color: 'bg-green-100 text-green-800' },
  Rejected: { color: 'bg-red-100 text-red-800' },
};

// Seed mock claims for demo
const SEED_CLAIMS = [
  {
    id: 'CLM-882031', referenceNumber: 'CLM-882031', phone: '0970123456',
    insurer: 'Prestige Assurance', type: 'Accident / Collision',
    fullName: 'Mwiza Banda', incidentDate: '2025-06-10', location: 'Great East Road, near Arcades',
    description: 'Rear-ended at traffic lights. Third party vehicle fled the scene.',
    estimatedLoss: '45000', policeReport: true, policeReportNumber: 'ZP/2025/4421',
    status: 'Under Review',
    submittedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    timeline: [
      { status: 'Submitted', note: 'Claim received and logged.', date: new Date(Date.now() - 4 * 86400000).toISOString() },
      { status: 'Under Review', note: 'Assigned to claims assessor.', date: new Date(Date.now() - 2 * 86400000).toISOString() },
    ],
    messages: [
      { id: 1, senderType: 'insurer', message: 'Your claim has been received and assigned to our assessment team.', sentAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    ],
  },
  {
    id: 'CLM-774510', referenceNumber: 'CLM-774510', phone: '0977334455',
    insurer: 'Prestige Assurance', type: 'Theft',
    fullName: 'Chanda Phiri', incidentDate: '2025-06-15', location: 'Woodlands, Lusaka',
    description: 'Vehicle stolen from outside residence overnight.',
    estimatedLoss: '95000', policeReport: true, policeReportNumber: 'ZP/2025/5820',
    status: 'Submitted',
    submittedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    timeline: [
      { status: 'Submitted', note: 'Claim received and logged.', date: new Date(Date.now() - 1 * 86400000).toISOString() },
    ],
    messages: [],
  },
];

const SEED_NCD = [
  {
    id: 'NCDA-991200', applicationNumber: 'NCDA-991200', phone: '0970123456',
    insurer: 'Prestige Assurance', policyNumber: 'PA-2023-0045',
    fullName: 'Mwiza Banda', yearsClaimFree: 2, status: 'Submitted',
    submittedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    approvedCode: null,
  },
  {
    id: 'NCDA-882204', applicationNumber: 'NCDA-882204', phone: '0955001122',
    insurer: 'Prestige Assurance', policyNumber: 'PA-2022-0188',
    fullName: 'Thandiwe Zulu', yearsClaimFree: 3, status: 'Under Review',
    submittedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    approvedCode: null,
  },
];

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Claim Detail Panel ───────────────────────────────────────────────────────
function ClaimDetail({ claim, onBack, allClaims, onUpdate }) {
  const { updateClaimStatusWithMsg } = useStore();
  const live = allClaims.find(c => c.id === claim.id) || claim;
  const meta = CLAIM_STATUSES[live.status] || { color: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' };
  const nextStatuses = CLAIM_NEXT_STATUSES[live.status] || [];

  const [replyText, setReplyText] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [updating, setUpdating] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [sending, setSending] = useState(false);

  const handleUpdateStatus = () => {
    if (!selectedStatus) return;
    setUpdating(true);
    setTimeout(() => {
      updateClaimStatusWithMsg(live.id, selectedStatus, statusNote || `Status changed to ${selectedStatus}.`, replyText.trim() || null);
      setUpdating(false);
      setShowStatusModal(false);
      setSelectedStatus('');
      setStatusNote('');
      setReplyText('');
      onUpdate?.();
    }, 500);
  };

  const handleSendMessage = () => {
    if (!replyText.trim()) return;
    setSending(true);
    setTimeout(() => {
      updateClaimStatusWithMsg(live.id, live.status, null, replyText.trim());
      setReplyText('');
      setSending(false);
    }, 300);
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col h-full">
      {/* Header */}
      <div className="p-5 border-b border-gray-100 bg-white">
        <div className="flex items-start gap-3 mb-3">
          <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-full md:hidden">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-bold text-[13px] text-secondary font-mono">{live.referenceNumber || live.id}</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.color}`}>{live.status}</span>
            </div>
            <h2 className="font-bold text-[17px] text-primary">{live.type}</h2>
            <p className="text-[13px] text-secondary mt-0.5">{live.fullName} · {live.phone}</p>
          </div>
        </div>

        {/* Claim key facts */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          {[
            { label: 'Incident Date', value: live.incidentDate },
            { label: 'Estimated Loss', value: live.estimatedLoss ? formatZMW(parseFloat(live.estimatedLoss)) : 'Not stated' },
            { label: 'Location', value: live.location },
            { label: 'Police Report', value: live.policeReport ? `Yes — ${live.policeReportNumber || 'Filed'}` : 'No' },
          ].map(f => (
            <div key={f.label}>
              <p className="text-[10px] font-bold uppercase text-secondary">{f.label}</p>
              <p className="text-[13px] font-semibold text-primary">{f.value}</p>
            </div>
          ))}
        </div>

        {live.description && (
          <div className="mt-3 bg-gray-50 rounded-xl p-3">
            <p className="text-[11px] font-bold text-secondary uppercase mb-1">Incident Description</p>
            <p className="text-[13px] text-on-surface leading-relaxed">{live.description}</p>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="p-4 border-b border-gray-100 bg-white">
        <p className="text-[11px] font-bold text-secondary uppercase tracking-wider mb-3">Timeline</p>
        <div className="relative">
          <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-gray-100" />
          <div className="space-y-3">
            {(live.timeline || []).map((step, i) => (
              <div key={i} className="relative flex items-start gap-3 pl-1">
                <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center z-10 flex-shrink-0">
                  <span className="material-symbols-outlined text-white text-[10px]">check</span>
                </div>
                <div>
                  <p className="font-bold text-[12px] text-primary">{step.status}</p>
                  {step.note && <p className="text-[11px] text-secondary">{step.note}</p>}
                  <p className="text-[10px] text-secondary">{timeAgo(step.date)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-4 space-y-3">
        <p className="text-[11px] font-bold text-secondary uppercase tracking-wider">Communication with Claimant</p>
        {(live.messages || []).length === 0 && (
          <div className="text-center py-8">
            <span className="material-symbols-outlined text-gray-300 text-4xl">chat_bubble_outline</span>
            <p className="text-[13px] text-secondary mt-2">No messages yet. Send the first message below.</p>
          </div>
        )}
        {(live.messages || []).map((msg, i) => (
          <div key={msg.id || i} className={`flex ${msg.senderType === 'insurer' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-[13px] ${
              msg.senderType === 'insurer'
                ? 'bg-primary text-white rounded-tr-sm'
                : 'bg-white text-on-surface border border-gray-200 rounded-tl-sm'
            }`}>
              {msg.senderType !== 'insurer' && (
                <p className="text-[10px] font-bold text-primary/70 mb-1">{live.fullName?.toUpperCase()}</p>
              )}
              <p>{msg.message}</p>
              <p className={`text-[10px] mt-1 ${msg.senderType === 'insurer' ? 'text-white/60' : 'text-secondary'}`}>
                {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Action Bar */}
      {!['Rejected', 'Settled'].includes(live.status) && (
        <div className="p-4 bg-white border-t border-gray-100 space-y-3">
          {/* Status update */}
          {nextStatuses.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <p className="text-[11px] font-bold text-secondary uppercase w-full">Update Status:</p>
              {nextStatuses.map(s => (
                <button key={s} onClick={() => { setSelectedStatus(s); setShowStatusModal(true); }}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-bold border-2 transition-all ${
                    s === 'Approved' ? 'border-green-400 text-green-700 hover:bg-green-50' :
                    s === 'Rejected' ? 'border-red-400 text-red-700 hover:bg-red-50' :
                    s === 'Settled' ? 'border-emerald-400 text-emerald-700 hover:bg-emerald-50' :
                    'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}>
                  → {s}
                </button>
              ))}
            </div>
          )}
          {/* Message */}
          <div className="flex gap-2">
            <input value={replyText} onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              placeholder={`Message to ${live.fullName || 'claimant'}...`}
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] focus:ring-2 focus:ring-primary outline-none" />
            <button onClick={handleSendMessage} disabled={!replyText.trim() || sending}
              className="bg-primary text-white px-4 py-2.5 rounded-xl hover:bg-primary-container transition-colors disabled:opacity-50">
              <span className="material-symbols-outlined text-[20px]">send</span>
            </button>
          </div>
        </div>
      )}

      {/* Status Modal */}
      <AnimatePresence>
        {showStatusModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
              <h3 className="font-bold text-[18px] text-primary mb-4">Update Claim Status</h3>
              <div className={`p-3 rounded-xl mb-4 ${
                selectedStatus === 'Approved' ? 'bg-green-50 border border-green-200' :
                selectedStatus === 'Rejected' ? 'bg-red-50 border border-red-200' :
                'bg-amber-50 border border-amber-200'
              }`}>
                <p className="text-[13px] font-semibold">
                  Change status to: <strong>{selectedStatus}</strong>
                </p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-[12px] font-bold uppercase text-secondary mb-1.5 block">Internal Note (optional)</label>
                  <input value={statusNote} onChange={e => setStatusNote(e.target.value)}
                    placeholder="e.g. Approved — vehicle inspection completed"
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-[14px] outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                  <label className="text-[12px] font-bold uppercase text-secondary mb-1.5 block">Message to Claimant (optional)</label>
                  <textarea rows={3} value={replyText} onChange={e => setReplyText(e.target.value)}
                    placeholder={`Notify ${live.fullName} about this status change...`}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-[14px] outline-none focus:ring-2 focus:ring-primary resize-none" />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowStatusModal(false)}
                    className="flex-1 py-3 border-2 border-gray-200 rounded-xl font-semibold text-secondary hover:bg-gray-50">
                    Cancel
                  </button>
                  <button onClick={handleUpdateStatus} disabled={updating}
                    className={`flex-1 py-3 rounded-xl font-bold text-white transition-colors ${
                      selectedStatus === 'Approved' || selectedStatus === 'Settled' ? 'bg-green-600 hover:bg-green-700' :
                      selectedStatus === 'Rejected' ? 'bg-red-600 hover:bg-red-700' :
                      'bg-primary hover:bg-primary-container'
                    }`}>
                    {updating ? 'Updating...' : `Confirm — ${selectedStatus}`}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main InsurerDashboard ────────────────────────────────────────────────────
export default function InsurerDashboard() {
  const { claims, ncdApplications, quoteRequests, updateNcdApplicationStatus, addInsurerQuote } = useStore();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [quotePremium, setQuotePremium] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [ncdActioning, setNcdActioning] = useState(null);

  // Merge store + seed (deduplicated)
  const allClaims = [...claims, ...SEED_CLAIMS].reduce((acc, c) => {
    if (!acc.some(x => x.id === c.id)) acc.push(c);
    return acc;
  }, []).filter(c => c.insurer === MY_INSURER);

  const allNcd = [...ncdApplications, ...SEED_NCD].reduce((acc, n) => {
    if (!acc.some(x => x.id === n.id)) acc.push(n);
    return acc;
  }, []).filter(n => n.insurer === MY_INSURER);

  const openClaims = allClaims.filter(c => !['Settled', 'Rejected'].includes(c.status));
  const urgentClaims = allClaims.filter(c => c.status === 'Submitted');
  const pendingNcd = allNcd.filter(n => n.status === 'Submitted' || n.status === 'Under Review');

  const seedRequests = [
    { id: 'QR-9901', vehicle: '2024 Toyota Hilux', time: '2 mins ago', priority: 'High Priority', value: 'ZMW 520,000', client: 'Platinum', usage: 'Private', coverage: 'Comprehensive' },
    { id: 'QR-9895', vehicle: '2022 BMW X5', time: '15 mins ago', priority: 'Standard', value: 'ZMW 685,000', client: 'Private', usage: 'Commercial', coverage: 'Third Party, Fire & Theft' },
    { id: 'QR-9890', vehicle: '2019 Toyota Hilux', time: '1 hour ago', priority: 'Standard', value: 'ZMW 250,000', client: 'Corporate', usage: 'Commercial', coverage: 'Comprehensive' },
  ];
  const requests = [
    ...quoteRequests.filter(request => request.insurers?.includes(MY_INSURER)).map(request => ({
      ...request,
      vehicle: request.vehicle || 'Vehicle pending',
      value: formatZMW(request.vehicleValue || 0), usage: request.vehicleUsage || 'Private',
      coverage: request.coverageDurationId || 'Comprehensive', client: request.customer?.fullName || 'Customer',
      time: timeAgo(request.submittedAt), priority: 'New request',
    })),
    ...seedRequests,
  ];

  const handleSubmitQuote = (e) => {
    e.preventDefault();
    setTimeout(() => {
      if (selectedRequest.id.startsWith('QR-')) {
        addInsurerQuote(selectedRequest.id, MY_INSURER, { premium: Number(quotePremium), notes: quoteNotes });
      }
      setSelectedRequest(null);
      setQuotePremium('');
      setQuoteNotes('');
    }, 800);
  };

  const handleNcdAction = (ncdId, action) => {
    setNcdActioning(ncdId);
    setTimeout(() => {
      const code = action === 'Approved' ? `NCD-${Math.random().toString(36).substring(2, 7).toUpperCase()}` : null;
      updateNcdApplicationStatus(ncdId, action, code);
      setNcdActioning(null);
    }, 700);
  };

  // ── Process Quote ──
  if (selectedRequest) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pb-8 w-full">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => setSelectedRequest(null)}
            className="w-9 h-9 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center hover:bg-gray-50 transition-colors">
            <span className="material-symbols-outlined text-[20px] text-secondary">arrow_back</span>
          </button>
          <h2 className="text-[22px] font-bold text-primary">Process Quotation: {selectedRequest.id}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-[16px] font-bold text-primary mb-4 border-b pb-2">Client & Vehicle Information</h3>
            <div className="space-y-4">
              {[['Vehicle', selectedRequest.vehicle], ['Estimated Value', selectedRequest.value], ['Declared Usage', selectedRequest.usage], ['Requested Coverage', selectedRequest.coverage], ['Client Profile', selectedRequest.client]].map(([k, v]) => (
                <div key={k}>
                  <p className="text-[12px] font-bold tracking-wider text-secondary uppercase">{k}</p>
                  <p className="text-[16px] font-semibold">{v}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-primary/20">
            <h3 className="text-[16px] font-bold text-primary mb-4 border-b pb-2">Create Quotation</h3>
            <form onSubmit={handleSubmitQuote} className="space-y-6">
              <div>
                <label className="text-[12px] font-bold tracking-wider text-secondary uppercase block mb-2">Calculated Premium (ZMW)</label>
                <input required type="number" value={quotePremium} onChange={e => setQuotePremium(e.target.value)} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary" placeholder="e.g. 12000" />
              </div>
              <div>
                <label className="text-[12px] font-bold tracking-wider text-secondary uppercase block mb-2">Special Conditions / Notes</label>
                <textarea rows="3" value={quoteNotes} onChange={e => setQuoteNotes(e.target.value)} className="w-full bg-surface-container-low border border-outline-variant rounded-lg p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary" placeholder="e.g. Requires tracking device installation..." />
              </div>
              <button type="submit" className="w-full bg-primary text-white font-semibold text-[16px] py-4 rounded-xl shadow-lg hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                <span className="material-symbols-outlined">send</span> Send Quote to Client
              </button>
            </form>
          </div>
        </div>
      </motion.div>
    );
  }

  const TABS = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    { id: 'claims', label: 'Claims', icon: 'report_problem', badge: urgentClaims.length },
    { id: 'ncd', label: 'NCD Applications', icon: 'discount', badge: pendingNcd.length },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pb-8 w-full">
      {/* Header */}
      <section className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-[12px] font-bold tracking-wider text-secondary mb-1 uppercase">Insurer Portal</p>
          <h2 className="text-[30px] font-bold text-primary leading-tight">{MY_INSURER}</h2>
          <p className="text-[14px] text-secondary mt-0.5">{urgentClaims.length} new claim{urgentClaims.length !== 1 ? 's' : ''} · {pendingNcd.length} NCD application{pendingNcd.length !== 1 ? 's' : ''} pending</p>
        </div>
        <div className="relative cursor-pointer bg-white p-3 rounded-full shadow-sm border border-gray-100 hover:bg-gray-50 transition-colors">
          <span className="material-symbols-outlined text-primary text-2xl">notifications</span>
          {(urgentClaims.length + pendingNcd.length) > 0 && (
            <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
          )}
        </div>
      </section>

      {/* Tab Bar */}
      <div className="flex border-b border-gray-200 mb-6">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSelectedClaim(null); }}
            className={`flex items-center gap-2 px-5 py-3 text-[14px] font-semibold border-b-2 transition-colors relative ${
              activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'
            }`}>
            <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
            {tab.label}
            {tab.badge > 0 && (
              <span className="w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeTab === 'overview' && (
        <>
          {/* KPI Cards */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'New Claims', value: urgentClaims.length, color: 'bg-red-50 border-red-100', tag: 'Urgent', tagColor: 'bg-red-500', icon: 'hourglass_top', textColor: 'text-red-700' },
              { label: 'Claims Under Review', value: openClaims.length, color: 'bg-amber-50 border-amber-100', tag: 'Active', tagColor: 'bg-amber-500', icon: 'policy', textColor: 'text-amber-700' },
              { label: 'Pending NCD Apps', value: pendingNcd.length, color: 'bg-blue-50 border-blue-100', tag: 'Review', tagColor: 'bg-blue-500', icon: 'discount', textColor: 'text-blue-700' },
              { label: 'Active Policies', value: 152, color: 'bg-white border-gray-100', tag: null, icon: 'verified_user', textColor: 'text-primary' },
            ].map((kpi, i) => (
              <div key={i} className={`${kpi.color} p-6 rounded-xl shadow-sm border flex flex-col gap-2 relative overflow-hidden`}>
                {kpi.tag && <div className={`absolute top-0 right-0 ${kpi.tagColor} text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg uppercase`}>{kpi.tag}</div>}
                <span className={`material-symbols-outlined ${kpi.textColor} text-2xl`}>{kpi.icon}</span>
                <p className={`text-[10px] font-bold tracking-wider text-secondary uppercase`}>{kpi.label}</p>
                <p className={`text-[32px] font-bold ${kpi.textColor} leading-tight`}>{kpi.value}</p>
              </div>
            ))}
          </section>

          {/* Quote Requests */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[20px] font-semibold text-on-surface">Recent Quote Requests</h3>
              <button className="text-primary font-semibold text-[14px]">View All</button>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-50">
                {requests.map((req, idx) => (
                  <div key={idx} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-primary">directions_car</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[16px] font-semibold text-primary">{req.vehicle}</p>
                          {req.priority === 'High Priority' && (
                            <span className="px-2 py-[2px] bg-red-50 text-red-900 text-[10px] font-bold rounded uppercase">High Priority</span>
                          )}
                        </div>
                        <p className="text-[12px] text-secondary">ID: {req.id} · {req.value} · {req.usage}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 md:w-auto w-full justify-between md:justify-end">
                      <span className="text-[12px] text-secondary">{req.time}</span>
                      <button onClick={() => setSelectedRequest(req)} className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary hover:text-white font-semibold text-[14px] rounded-lg transition-colors flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px]">edit_document</span> Process
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {/* ── CLAIMS ── */}
      {activeTab === 'claims' && (
        <div className="flex gap-4 min-h-[500px]">
          {/* Claims List */}
          <div className={`flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${selectedClaim ? 'hidden md:flex md:w-80' : 'w-full md:w-80'} flex-shrink-0`}>
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-bold text-[16px] text-primary">Claims Inbox</h3>
              <p className="text-[12px] text-secondary">{allClaims.length} total · {urgentClaims.length} new</p>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {allClaims.length === 0 && (
                <div className="text-center py-12">
                  <span className="material-symbols-outlined text-gray-200 text-5xl">inbox</span>
                  <p className="text-[13px] text-secondary mt-2">No claims yet.</p>
                </div>
              )}
              {allClaims.map(claim => {
                const meta = CLAIM_STATUSES[claim.status] || { color: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' };
                return (
                  <button key={claim.id} onClick={() => setSelectedClaim(claim)}
                    className={`w-full text-left p-4 transition-all ${selectedClaim?.id === claim.id ? 'bg-primary/5 border-l-4 border-l-primary' : 'hover:bg-gray-50'}`}>
                    <div className="flex items-start gap-2">
                      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${meta.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[13px] text-primary truncate">{claim.type}</p>
                        <p className="text-[11px] text-secondary">{claim.fullName} · {claim.referenceNumber || claim.id}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color}`}>{claim.status}</span>
                          <span className="text-[10px] text-secondary">{timeAgo(claim.submittedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Claim Detail */}
          <div className={`flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${selectedClaim ? 'flex flex-col' : 'hidden md:flex items-center justify-center'}`}>
            {!selectedClaim ? (
              <div className="text-center p-8">
                <span className="material-symbols-outlined text-gray-200 text-5xl">policy</span>
                <p className="font-bold text-[16px] text-primary mt-3 mb-1">Select a Claim</p>
                <p className="text-[13px] text-secondary">Choose a claim from the list to review details and take action.</p>
              </div>
            ) : (
              <ClaimDetail
                key={selectedClaim.id}
                claim={selectedClaim}
                allClaims={allClaims}
                onBack={() => setSelectedClaim(null)}
                onUpdate={() => {}}
              />
            )}
          </div>
        </div>
      )}

      {/* ── NCD APPLICATIONS ── */}
      {activeTab === 'ncd' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[18px] font-bold text-primary">NCD Applications</h3>
            <span className="text-[13px] text-secondary">{allNcd.length} total</span>
          </div>
          {allNcd.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
              <span className="material-symbols-outlined text-gray-200 text-5xl">discount</span>
              <p className="text-[14px] text-secondary mt-3">No NCD applications yet.</p>
            </div>
          )}
          {allNcd.map(app => {
            const meta = NCD_STATUSES[app.status] || { color: 'bg-gray-100 text-gray-700' };
            const isOpen = app.status === 'Submitted' || app.status === 'Under Review';
            return (
              <div key={app.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-bold text-[14px] text-primary">{app.fullName}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color}`}>{app.status}</span>
                    </div>
                    <p className="text-[12px] text-secondary font-mono">{app.applicationNumber || app.id}</p>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div>
                        <p className="text-[10px] text-secondary uppercase font-bold">Policy No.</p>
                        <p className="text-[13px] font-semibold font-mono">{app.policyNumber}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-secondary uppercase font-bold">Years Claim-Free</p>
                        <p className="text-[13px] font-semibold">{app.yearsClaimFree} yr{app.yearsClaimFree !== 1 ? 's' : ''}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-secondary uppercase font-bold">Expected Discount</p>
                        <p className="text-[13px] font-bold text-primary">{app.yearsClaimFree * 10}%</p>
                      </div>
                    </div>
                    {app.approvedCode && (
                      <div className="mt-3 bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                        <span className="material-symbols-outlined text-green-600 text-[18px]">check_circle</span>
                        <div>
                          <p className="text-[12px] text-green-800 font-semibold">Approved — NCD Code Issued</p>
                          <p className="font-mono text-[14px] font-bold text-green-900">{app.approvedCode}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button
                        disabled={ncdActioning === app.id}
                        onClick={() => handleNcdAction(app.id, 'Approved')}
                        className="px-4 py-2 bg-green-600 text-white font-bold text-[13px] rounded-xl hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">check</span>
                        Approve & Issue Code
                      </button>
                      <button
                        disabled={ncdActioning === app.id}
                        onClick={() => handleNcdAction(app.id, 'Under Review')}
                        className="px-4 py-2 bg-amber-100 text-amber-800 font-bold text-[13px] rounded-xl hover:bg-amber-200 disabled:opacity-50 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">pending</span>
                        Mark Under Review
                      </button>
                      <button
                        disabled={ncdActioning === app.id}
                        onClick={() => handleNcdAction(app.id, 'Rejected')}
                        className="px-4 py-2 bg-red-50 text-red-700 font-bold text-[13px] rounded-xl hover:bg-red-100 disabled:opacity-50 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">close</span>
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
