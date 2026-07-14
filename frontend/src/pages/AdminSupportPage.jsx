import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { motion, AnimatePresence } from 'framer-motion';

const SUPPORT_AGENTS = ['Mwango Chirwa', 'Nalishebo Mutale', 'Bwalya Tembo', 'Chanda Phiri'];

const STATUS_OPTIONS = ['Open', 'In Progress', 'Waiting for Insurer', 'Resolved', 'Closed'];

const STATUS_META = {
  Open: { color: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500', icon: 'inbox' },
  'In Progress': { color: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500', icon: 'pending' },
  'Waiting for Insurer': { color: 'bg-purple-100 text-purple-800', dot: 'bg-purple-500', icon: 'hourglass_top' },
  Resolved: { color: 'bg-green-100 text-green-800', dot: 'bg-green-500', icon: 'check_circle' },
  Closed: { color: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400', icon: 'lock' },
};

const CATEGORY_ICONS = {
  'Policy Enquiry': 'policy',
  'Premium Dispute': 'payments',
  'Claim Assistance': 'report_problem',
  'Document Request': 'description',
  'NCD Enquiry': 'discount',
  'Technical Issue': 'build',
  'Renewal Assistance': 'event_repeat',
  'General Enquiry': 'help',
};

// Seed demo tickets so agents have something to work with
const SEED_TICKETS = [
  {
    id: 'TKT-441027', referenceNumber: 'TKT-441027', phone: '0970123456',
    subject: 'Premium calculation seems too high', category: 'Premium Dispute',
    fullName: 'Mwiza Banda', status: 'In Progress', assignedTo: 'Mwango Chirwa',
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    messages: [
      { id: 1, senderType: 'customer', message: 'My quoted premium seems higher than expected for a ZMW 150,000 vehicle.', sentAt: new Date(Date.now() - 2 * 86400000).toISOString() },
      { id: 2, senderType: 'support', message: 'Hello! The PIA regulatory minimum is 4% of your declared vehicle value. For ZMW 150,000 this is ZMW 6,000/year. I\'ll check with the underwriting team and get back to you.', sentAt: new Date(Date.now() - 1 * 86400000).toISOString(), agentName: 'Mwango Chirwa' },
    ],
    internalNotes: [
      { id: 10, text: 'Checked with Prestige Assurance — their rate is 4.5% which is above PIA min. Client needs explanation.', agentName: 'Mwango Chirwa', createdAt: new Date(Date.now() - 86400000).toISOString() },
    ],
    escalations: [],
  },
  {
    id: 'TKT-552843', referenceNumber: 'TKT-552843', phone: '0955001122',
    subject: 'Claim CLM-882031 has not been responded to', category: 'Claim Assistance',
    fullName: 'Thandiwe Zulu', status: 'Waiting for Insurer', assignedTo: 'Nalishebo Mutale',
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    messages: [
      { id: 1, senderType: 'customer', message: 'I submitted a claim 5 days ago and have received no response from the insurer.', sentAt: new Date(Date.now() - 5 * 86400000).toISOString() },
      { id: 2, senderType: 'support', message: 'Hi Thandiwe, we have escalated this to Prestige Assurance and requested an urgent update. You should hear back within 2 business days.', sentAt: new Date(Date.now() - 3 * 86400000).toISOString(), agentName: 'Nalishebo Mutale' },
    ],
    internalNotes: [],
    escalations: [
      { id: 20, insurerName: 'Prestige Assurance', note: 'Client waiting 5 days on claim CLM-882031. Please provide update urgently.', agentName: 'Nalishebo Mutale', createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
    ],
  },
  {
    id: 'TKT-664491', referenceNumber: 'TKT-664491', phone: '0977334455',
    subject: 'Cannot download my policy certificate', category: 'Document Request',
    fullName: 'Chanda Phiri', status: 'Open', assignedTo: null,
    createdAt: new Date(Date.now() - 1 * 86400000).toISOString(),
    messages: [
      { id: 1, senderType: 'customer', message: 'I paid for my policy three days ago but cannot find my certificate. Please help.', sentAt: new Date(Date.now() - 1 * 86400000).toISOString() },
    ],
    internalNotes: [],
    escalations: [],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Ticket Row ───────────────────────────────────────────────────────────────
function TicketRow({ ticket, onSelect, isSelected }) {
  const meta = STATUS_META[ticket.status] || STATUS_META.Open;
  const unread = (ticket.messages || []).filter(m => m.senderType === 'customer').length;
  return (
    <button
      onClick={() => onSelect(ticket)}
      className={`w-full text-left p-4 border-b border-gray-50 transition-all ${isSelected ? 'bg-primary/5 border-l-4 border-l-primary' : 'hover:bg-gray-50'}`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${meta.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="font-semibold text-[14px] text-primary truncate">{ticket.subject}</p>
            {!ticket.assignedTo && (
              <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold flex-shrink-0">Unassigned</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-secondary">{ticket.fullName || 'Unknown'}</span>
            <span className="text-secondary">·</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color}`}>{ticket.status}</span>
            <span className="text-secondary">·</span>
            <span className="text-[11px] text-secondary">{timeAgo(ticket.createdAt)}</span>
          </div>
          {ticket.category && (
            <p className="text-[11px] text-secondary mt-0.5">{ticket.category}</p>
          )}
        </div>
        {ticket.assignedTo && (
          <span className="text-[10px] text-secondary bg-gray-100 px-2 py-1 rounded-full flex-shrink-0 hidden sm:block">
            {ticket.assignedTo.split(' ')[0]}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Ticket Detail ────────────────────────────────────────────────────────────
function TicketDetail({ ticket, allTickets, onBack, agentName, onClose }) {
  const { addTicketMessage, updateTicketStatus, assignTicket, addTicketInternalNote, addTicketEscalation, insurersList } = useStore();

  const live = allTickets.find(t => t.id === ticket.id) || ticket;
  const meta = STATUS_META[live.status] || STATUS_META.Open;

  const [replyText, setReplyText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [activeTab, setActiveTab] = useState('conversation'); // conversation | notes | escalation
  const [escalateInsurer, setEscalateInsurer] = useState('');
  const [escalateNote, setEscalateNote] = useState('');
  const [escalating, setEscalating] = useState(false);
  const [statusDropOpen, setStatusDropOpen] = useState(false);
  const [assignDropOpen, setAssignDropOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [live.messages]);

  const handleSendReply = () => {
    if (!replyText.trim()) return;
    setSending(true);
    setTimeout(() => {
      addTicketMessage(live.id, { senderType: 'support', message: replyText.trim(), agentName });
      if (live.status === 'Open') updateTicketStatus(live.id, 'In Progress');
      setReplyText('');
      setSending(false);
    }, 300);
  };

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    addTicketInternalNote(live.id, { text: noteText.trim(), agentName });
    setNoteText('');
  };

  const handleEscalate = (e) => {
    e.preventDefault();
    if (!escalateInsurer || !escalateNote.trim()) return;
    setEscalating(true);
    setTimeout(() => {
      addTicketEscalation(live.id, { insurerName: escalateInsurer, note: escalateNote.trim(), agentName });
      setEscalateInsurer('');
      setEscalateNote('');
      setEscalating(false);
      setActiveTab('conversation');
    }, 600);
  };

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 bg-white">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors mt-0.5 md:hidden">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-[16px] text-primary leading-snug">{live.subject}</h2>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${meta.color}`}>{live.status}</span>
              <span className="text-[12px] text-secondary font-mono">{live.referenceNumber || live.id}</span>
              {live.category && <span className="text-[12px] text-secondary">· {live.category}</span>}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[12px] text-secondary">
              <span><strong>{live.fullName}</strong> · {live.phone}</span>
              <span>{timeAgo(live.createdAt)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full ml-auto">
            <span className="material-symbols-outlined text-[20px] text-secondary">close</span>
          </button>
        </div>

        {/* Quick Action Row */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {/* Status */}
          <div className="relative">
            <button
              onClick={() => setStatusDropOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-[12px] font-semibold hover:bg-gray-100 transition-colors"
            >
              <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
              {live.status}
              <span className="material-symbols-outlined text-[14px] text-secondary">expand_more</span>
            </button>
            {statusDropOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 min-w-[180px] overflow-hidden">
                {STATUS_OPTIONS.filter(s => s !== live.status).map(s => (
                  <button key={s} onClick={() => { updateTicketStatus(live.id, s); setStatusDropOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-gray-50 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${STATUS_META[s]?.dot || 'bg-gray-400'}`} />
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Assign */}
          <div className="relative">
            <button
              onClick={() => setAssignDropOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-[12px] font-semibold hover:bg-gray-100 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px] text-secondary">person</span>
              {live.assignedTo || 'Unassigned'}
              <span className="material-symbols-outlined text-[14px] text-secondary">expand_more</span>
            </button>
            {assignDropOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 min-w-[180px] overflow-hidden">
                {SUPPORT_AGENTS.map(agent => (
                  <button key={agent} onClick={() => { assignTicket(live.id, agent); setAssignDropOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-[13px] hover:bg-gray-50 ${live.assignedTo === agent ? 'font-bold text-primary' : ''}`}>
                    {agent}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Escalation tag */}
          {(live.escalations || []).length > 0 && (
            <span className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-[12px] font-semibold text-purple-800">
              <span className="material-symbols-outlined text-[14px]">call_merge</span>
              Escalated to {live.escalations[live.escalations.length - 1].insurerName}
            </span>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-gray-100 bg-white px-4">
        {[
          { key: 'conversation', label: 'Conversation', icon: 'chat' },
          { key: 'notes', label: 'Internal Notes', icon: 'sticky_note_2', count: (live.internalNotes || []).length },
          { key: 'escalation', label: 'Escalate', icon: 'call_merge' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors ${activeTab === tab.key ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}`}>
            <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
            {tab.label}
            {tab.count > 0 && <span className="w-4 h-4 bg-primary text-white text-[9px] rounded-full flex items-center justify-center">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {/* ── Conversation ── */}
        {activeTab === 'conversation' && (
          <div className="p-4 space-y-3 pb-2">
            {(live.messages || []).length === 0 && (
              <div className="text-center py-10">
                <span className="material-symbols-outlined text-gray-300 text-5xl">chat_bubble_outline</span>
                <p className="text-[13px] text-secondary mt-2">No messages yet. Reply below to start the conversation.</p>
              </div>
            )}
            {(live.messages || []).map((msg, i) => (
              <div key={msg.id || i} className={`flex ${msg.senderType === 'customer' ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[80%] ${msg.senderType === 'customer' ? 'items-start' : 'items-end'} flex flex-col gap-1`}>
                  {msg.senderType !== 'customer' && (
                    <span className="text-[10px] text-secondary px-1 font-semibold">{msg.agentName || 'Support Agent'}</span>
                  )}
                  <div className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed ${
                    msg.senderType === 'customer'
                      ? 'bg-white text-on-surface border border-gray-200 rounded-tl-sm'
                      : 'bg-primary text-white rounded-tr-sm'
                  }`}>
                    <p>{msg.message}</p>
                    <p className={`text-[10px] mt-1 ${msg.senderType === 'customer' ? 'text-secondary' : 'text-white/60'}`}>
                      {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* ── Internal Notes ── */}
        {activeTab === 'notes' && (
          <div className="p-4 space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <span className="material-symbols-outlined text-amber-600 text-[16px] mt-0.5">lock</span>
              <p className="text-[12px] text-amber-800">Internal notes are only visible to the support team — not to the client.</p>
            </div>
            {(live.internalNotes || []).length === 0 && (
              <div className="text-center py-8">
                <span className="material-symbols-outlined text-gray-300 text-4xl">sticky_note_2</span>
                <p className="text-[13px] text-secondary mt-2">No internal notes yet.</p>
              </div>
            )}
            {(live.internalNotes || []).map((note, i) => (
              <div key={note.id || i} className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-bold text-amber-900">{note.agentName}</span>
                  <span className="text-[11px] text-amber-700">{timeAgo(note.createdAt)}</span>
                </div>
                <p className="text-[13px] text-amber-900 leading-relaxed">{note.text}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Escalate ── */}
        {activeTab === 'escalation' && (
          <div className="p-4">
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                  <span className="material-symbols-outlined text-purple-600 text-2xl">call_merge</span>
                </div>
                <div>
                  <h3 className="font-bold text-[15px] text-primary">Escalate to Insurance Company</h3>
                  <p className="text-[12px] text-secondary">Forward this ticket to a specific insurer for urgent action.</p>
                </div>
              </div>

              {/* Past escalations */}
              {(live.escalations || []).length > 0 && (
                <div className="mb-5 space-y-2">
                  <p className="text-[11px] font-bold text-secondary uppercase tracking-wider mb-2">Previous Escalations</p>
                  {live.escalations.map((esc, i) => (
                    <div key={esc.id || i} className="bg-purple-50 border border-purple-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-bold text-purple-900">{esc.insurerName}</span>
                        <span className="text-[11px] text-purple-700">{timeAgo(esc.createdAt)}</span>
                      </div>
                      <p className="text-[12px] text-purple-800">{esc.note}</p>
                      <p className="text-[10px] text-purple-600 mt-1">by {esc.agentName}</p>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleEscalate} className="space-y-4">
                <div>
                  <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Insurance Company *</label>
                  <div className="relative">
                    <select required value={escalateInsurer} onChange={e => setEscalateInsurer(e.target.value)}
                      className="w-full appearance-none bg-surface-container-low border border-outline-variant rounded-xl p-3 text-[14px] focus:ring-2 focus:ring-purple-500 outline-none">
                      <option value="">Select insurer to escalate to...</option>
                      {insurersList.map(ins => (
                        <option key={ins.id} value={ins.name}>{ins.name}</option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-3 top-3 text-gray-400 pointer-events-none">expand_more</span>
                  </div>
                </div>
                <div>
                  <label className="text-[12px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5 block">Escalation Note *</label>
                  <textarea required rows={4} value={escalateNote} onChange={e => setEscalateNote(e.target.value)}
                    placeholder="Describe what action is needed from the insurer and any relevant context..."
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-[14px] focus:ring-2 focus:ring-purple-500 outline-none resize-none" />
                </div>
                <button type="submit" disabled={escalating || !escalateInsurer || !escalateNote.trim()}
                  className="w-full bg-purple-600 text-white font-bold py-3 rounded-xl hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                  {escalating
                    ? <><span className="material-symbols-outlined animate-spin text-[18px]">sync</span> Escalating...</>
                    : <><span className="material-symbols-outlined text-[18px]">call_merge</span> Escalate to {escalateInsurer || 'Insurer'}</>
                  }
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Reply Box — only in conversation tab */}
      {activeTab === 'conversation' && live.status !== 'Closed' && (
        <div className="p-4 bg-white border-t border-gray-100">
          <div className="flex gap-2 items-end">
            <textarea
              rows={2}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendReply(); } }}
              placeholder="Reply to client... (Enter to send, Shift+Enter for new line)"
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] focus:ring-2 focus:ring-primary outline-none resize-none"
            />
            <button onClick={handleSendReply} disabled={!replyText.trim() || sending}
              className="bg-primary text-white p-3 rounded-xl hover:bg-primary-container transition-colors disabled:opacity-50 flex-shrink-0">
              <span className="material-symbols-outlined text-[22px]">send</span>
            </button>
          </div>
          {/* Add note button */}
          {activeTab === 'conversation' && (
            <div className="mt-2 flex items-center gap-2">
              <input value={noteText} onChange={e => setNoteText(e.target.value)}
                placeholder="Quick internal note (not visible to client)..."
                className="flex-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[12px] outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-amber-400" />
              <button onClick={handleAddNote} disabled={!noteText.trim()}
                className="text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg text-[12px] font-semibold hover:bg-amber-100 disabled:opacity-40">
                <span className="material-symbols-outlined text-[16px]">sticky_note_2</span>
              </button>
            </div>
          )}
        </div>
      )}
      {activeTab === 'conversation' && live.status === 'Closed' && (
        <div className="p-4 bg-white border-t border-gray-100 text-center">
          <p className="text-[13px] text-secondary">This ticket is closed. Reopen it by changing the status above.</p>
        </div>
      )}
    </motion.div>
  );
}

// ─── Main AdminSupportPage ────────────────────────────────────────────────────
export default function AdminSupportPage({ agentName = 'Support Agent', agentRole = 'support' }) {
  const { supportTickets, addTicketMessage, updateTicketStatus } = useStore();

  const allTickets = [...supportTickets, ...SEED_TICKETS].reduce((acc, t) => {
    if (!acc.some(x => x.id === t.id)) acc.push(t);
    return acc;
  }, []);

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterAssigned, setFilterAssigned] = useState('all');
  const [searchQ, setSearchQ] = useState('');
  const [selectedTicket, setSelectedTicket] = useState(null);

  const filtered = allTickets.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterAssigned === 'mine' && t.assignedTo !== agentName) return false;
    if (filterAssigned === 'unassigned' && t.assignedTo) return false;
    if (searchQ && !t.subject?.toLowerCase().includes(searchQ.toLowerCase()) &&
        !t.fullName?.toLowerCase().includes(searchQ.toLowerCase()) &&
        !(t.referenceNumber || t.id)?.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Metrics
  const open = allTickets.filter(t => t.status === 'Open').length;
  const inProgress = allTickets.filter(t => t.status === 'In Progress').length;
  const waitingInsurer = allTickets.filter(t => t.status === 'Waiting for Insurer').length;
  const resolved = allTickets.filter(t => t.status === 'Resolved').length;

  const METRICS = [
    { label: 'Open', value: open, color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500' },
    { label: 'In Progress', value: inProgress, color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500' },
    { label: 'At Insurer', value: waitingInsurer, color: 'text-purple-600', bg: 'bg-purple-50', dot: 'bg-purple-500' },
    { label: 'Resolved', value: resolved, color: 'text-green-600', bg: 'bg-green-50', dot: 'bg-green-500' },
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-2xl">headset_mic</span>
          </div>
          <div>
            <h2 className="text-[24px] font-bold text-primary">Support Centre</h2>
            <p className="text-[13px] text-secondary">Helpdesk · {agentRole === 'admin' ? 'All Agents' : agentName}</p>
          </div>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {METRICS.map(m => (
          <button key={m.label} onClick={() => setFilterStatus(m.label === 'At Insurer' ? 'Waiting for Insurer' : m.label)}
            className={`${m.bg} rounded-xl p-4 text-left hover:shadow-md transition-all active:scale-[0.98]`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${m.dot}`} />
              <span className={`text-[11px] font-bold uppercase tracking-wider ${m.color}`}>{m.label}</span>
            </div>
            <p className={`text-[28px] font-extrabold ${m.color}`}>{m.value}</p>
          </button>
        ))}
      </div>

      {/* Main Area */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex" style={{ minHeight: '620px' }}>
        {/* Left: Ticket List */}
        <div className={`flex flex-col border-r border-gray-100 ${selectedTicket ? 'hidden md:flex md:w-[340px]' : 'w-full md:w-[340px]'} flex-shrink-0`}>
          {/* Filters */}
          <div className="p-3 border-b border-gray-100 space-y-2">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-gray-400">search</span>
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                placeholder="Search tickets..."
                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div className="flex gap-2">
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] outline-none">
                <option value="all">All Status</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filterAssigned} onChange={e => setFilterAssigned(e.target.value)}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] outline-none">
                <option value="all">All</option>
                <option value="mine">Mine</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {filtered.length === 0 && (
              <div className="text-center py-12 px-4">
                <span className="material-symbols-outlined text-gray-200 text-5xl">inbox</span>
                <p className="text-[13px] text-secondary mt-2">No tickets match your filters.</p>
              </div>
            )}
            {filtered.map(t => (
              <TicketRow key={t.id} ticket={t} onSelect={setSelectedTicket} isSelected={selectedTicket?.id === t.id} />
            ))}
          </div>

          <div className="p-3 border-t border-gray-100 bg-gray-50">
            <p className="text-[11px] text-secondary text-center">{filtered.length} ticket{filtered.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Right: Ticket Detail */}
        <div className={`flex-1 flex flex-col ${selectedTicket ? 'flex' : 'hidden md:flex'}`}>
          {!selectedTicket ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-gray-300 text-4xl">mark_email_unread</span>
              </div>
              <h3 className="font-bold text-[18px] text-primary mb-2">Select a Ticket</h3>
              <p className="text-[14px] text-secondary max-w-xs">Choose a support ticket from the list to view the conversation and take action.</p>
            </div>
          ) : (
            <TicketDetail
              key={selectedTicket.id}
              ticket={selectedTicket}
              allTickets={allTickets}
              agentName={agentName}
              onBack={() => setSelectedTicket(null)}
              onClose={() => setSelectedTicket(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
