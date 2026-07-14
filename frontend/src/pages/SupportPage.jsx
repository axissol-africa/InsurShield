import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

// ─── Insurer Contact Directory ────────────────────────────────────────────────
const INSURER_CONTACTS = [
  {
    id: 'prestige',
    name: 'Prestige Assurance',
    logo: 'shield',
    tagline: 'Premium motor coverage since 1995',
    contactPerson: 'Mrs. Chanda Mwale',
    role: 'Client Relations Manager',
    phone: '+260 211 255 100',
    mobile: '+260 977 255 100',
    whatsapp: '+260977255100',
    email: 'claims@prestigeassurance.zm',
    address: 'Cairo Road, Prestige House, 4th Floor, Lusaka',
    hours: 'Mon–Fri: 08:00–17:00 · Sat: 09:00–12:00',
  },
  {
    id: 'madison',
    name: 'Madison General Insurance',
    logo: 'assured_workload',
    tagline: "Zambia's most trusted insurer",
    contactPerson: 'Mr. Bwalya Kapasa',
    role: 'Motor Claims Officer',
    phone: '+260 211 374 700',
    mobile: '+260 966 374 700',
    whatsapp: '+260966374700',
    email: 'motorinsurance@madisongeneral.zm',
    address: 'Madison House, Plot 64489, Lusaka Central',
    hours: 'Mon–Fri: 08:00–17:00 · Sat: 08:30–12:30',
  },
  {
    id: 'zsic',
    name: 'ZSIC General Insurance',
    logo: 'verified_user',
    tagline: 'Government-backed, nationally trusted',
    contactPerson: 'Ms. Natasha Phiri',
    role: 'Senior Insurance Advisor',
    phone: '+260 211 228 000',
    mobile: '+260 955 228 000',
    whatsapp: '+260955228000',
    email: 'general@zsicinsurance.zm',
    address: 'ZSIC House, Independence Avenue, Lusaka',
    hours: 'Mon–Fri: 07:30–17:00',
  },
  {
    id: 'professional',
    name: 'Professional Insurance Corp.',
    logo: 'business_center',
    tagline: 'Tailored coverage for professionals',
    contactPerson: 'Mr. Musonda Tembo',
    role: 'Claims & Underwriting Lead',
    phone: '+260 211 239 500',
    mobile: '+260 971 239 500',
    whatsapp: '+260971239500',
    email: 'info@picinsurance.zm',
    address: 'Farmers House, Central Business District, Lusaka',
    hours: 'Mon–Fri: 08:00–17:00 · Sat: 09:00–13:00',
  },
  {
    id: 'hollard',
    name: 'Hollard Insurance Zambia',
    logo: 'domain',
    tagline: 'Pan-African expertise, local service',
    contactPerson: 'Ms. Grace Lungu',
    role: 'Motor Products Specialist',
    phone: '+260 211 374 950',
    mobile: '+260 968 374 950',
    whatsapp: '+260968374950',
    email: 'motorquotes@hollard.zm',
    address: 'Hollard House, Addis Ababa Drive, Longacres, Lusaka',
    hours: 'Mon–Fri: 08:00–17:00',
  },
  {
    id: 'nico',
    name: 'NICO Insurance',
    logo: 'security',
    tagline: 'Comprehensive protection, always',
    contactPerson: 'Mr. Joseph Banda',
    role: 'Regional Claims Coordinator',
    phone: '+260 211 231 600',
    mobile: '+260 962 231 600',
    whatsapp: '+260962231600',
    email: 'claims@nico.zm',
    address: 'Nkwazi House, Nkwazi Road, Lusaka',
    hours: 'Mon–Fri: 08:00–17:00 · Sat: 09:00–12:00',
  },
];

const FAQS = [
  {
    q: 'How do I start a claim?',
    a: "Go to the Claims section of InsurShield and click \"Submit a New Claim\". You'll receive a unique reference number instantly that you can use to track the claim — no account needed. Your insurer will also be notified automatically.",
  },
  {
    q: 'How do I apply for a No Claim Discount (NCD)?',
    a: 'Navigate to Claims → NCD Applications and click "Apply for NCD". You need at least 1 consecutive claim-free year with your insurer. Once approved, you\'ll receive a discount code to use on your next quotation.',
  },
  {
    q: 'Why should I contact my insurer directly?',
    a: "For policy-specific queries, premium disputes, document requests, and complex claim questions, your insurer's dedicated team can access your full policy file and provide the most accurate, authoritative answers.",
  },
  {
    q: 'What is the minimum premium under PIA regulations?',
    a: "The Pensions and Insurance Authority (PIA) of Zambia requires a minimum annual premium of 4% of your vehicle's declared market value for comprehensive motor insurance. InsurShield enforces this automatically during quoting.",
  },
  {
    q: 'How long does a claim take to be processed?',
    a: 'Most insurers aim to assess claims within 5–7 business days. Complex claims or those requiring physical inspection may take longer. Track your claim progress at any time using your reference number under Claims.',
  },
  {
    q: 'Can I get a copy of my policy certificate?',
    a: 'Your policy certificate is emailed after payment confirmation. If not received, contact your insurer directly using the details on this page — they can resend it or issue a certified replacement.',
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-outline-variant rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-surface-container-low transition-colors"
      >
        <p className="font-semibold text-[14px] text-primary pr-4">{q}</p>
        <span className={`material-symbols-outlined text-secondary flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="px-4 pb-4"
        >
          <p className="text-[13px] text-on-surface-variant leading-relaxed">{a}</p>
        </motion.div>
      )}
    </div>
  );
}

function InsurerCard({ insurer }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      layout
      className="bg-white rounded-2xl border border-outline-variant shadow-sm overflow-hidden hover:shadow-md transition-shadow"
    >
      {/* Card Header — uses system primary color */}
      <div className="bg-primary p-5 flex items-center gap-4">
        <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-white text-2xl">{insurer.logo}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-white text-[16px] leading-tight">{insurer.name}</h3>
          <p className="text-white/75 text-[12px] mt-0.5">{insurer.tagline}</p>
        </div>
      </div>

      {/* Contact Person Badge */}
      <div className="px-5 py-3 border-b border-outline-variant flex items-center gap-3">
        <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary text-[18px]">person</span>
        </div>
        <div>
          <p className="font-bold text-[14px] text-on-surface">{insurer.contactPerson}</p>
          <p className="text-[11px] text-secondary">{insurer.role}</p>
        </div>
      </div>

      {/* Quick Contact Actions — all use theme tokens */}
      <div className="p-4 grid grid-cols-3 gap-2">
        <a
          href={`tel:${insurer.mobile}`}
          className="flex flex-col items-center gap-1.5 p-3 bg-primary/5 border border-primary/15 rounded-xl hover:bg-primary/10 transition-colors group"
        >
          <div className="w-9 h-9 bg-white rounded-lg shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform border border-outline-variant">
            <span className="material-symbols-outlined text-primary text-[20px]">phone</span>
          </div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-wide">Call</p>
        </a>
        <a
          href={`https://wa.me/${insurer.whatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-1.5 p-3 bg-primary/5 border border-primary/15 rounded-xl hover:bg-primary/10 transition-colors group"
        >
          <div className="w-9 h-9 bg-white rounded-lg shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform border border-outline-variant">
            <span className="material-symbols-outlined text-primary text-[20px]">chat</span>
          </div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-wide">WhatsApp</p>
        </a>
        <a
          href={`mailto:${insurer.email}`}
          className="flex flex-col items-center gap-1.5 p-3 bg-primary/5 border border-primary/15 rounded-xl hover:bg-primary/10 transition-colors group"
        >
          <div className="w-9 h-9 bg-white rounded-lg shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform border border-outline-variant">
            <span className="material-symbols-outlined text-primary text-[20px]">email</span>
          </div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-wide">Email</p>
        </a>
      </div>

      {/* Expand / Collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 border-t border-outline-variant text-[13px] font-semibold text-secondary hover:text-primary hover:bg-surface-container-low transition-colors"
      >
        <span>{expanded ? 'Hide details' : 'View full contact details'}</span>
        <span className={`material-symbols-outlined text-[18px] transition-transform ${expanded ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>

      {expanded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-5 pb-5 space-y-3 border-t border-outline-variant pt-4 bg-surface-container-low/40"
        >
          <DetailRow icon="phone" label="Office Line" value={insurer.phone} href={`tel:${insurer.phone}`} />
          <DetailRow icon="smartphone" label="Mobile / WhatsApp" value={insurer.mobile} href={`tel:${insurer.mobile}`} />
          <DetailRow icon="email" label="Email" value={insurer.email} href={`mailto:${insurer.email}`} />
          <DetailRow icon="location_on" label="Address" value={insurer.address} />
          <DetailRow icon="schedule" label="Operating Hours" value={insurer.hours} />
        </motion.div>
      )}
    </motion.div>
  );
}

function DetailRow({ icon, label, value, href }) {
  const content = (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 bg-white border border-outline-variant rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
        <span className="material-symbols-outlined text-secondary text-[16px]">{icon}</span>
      </div>
      <div>
        <p className="text-[10px] uppercase font-bold tracking-wider text-secondary">{label}</p>
        <p className="text-[13px] text-on-surface font-medium mt-0.5">{value}</p>
      </div>
    </div>
  );
  if (href) {
    return (
      <a href={href} className="block hover:opacity-75 transition-opacity">
        {content}
      </a>
    );
  }
  return content;
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SupportPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const filtered = INSURER_CONTACTS.filter(ins =>
    ins.name.toLowerCase().includes(search.toLowerCase()) ||
    ins.contactPerson.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-3xl mx-auto px-4 py-8 pb-24"
    >
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[28px] font-bold text-primary">Contact Your Insurer</h1>
        <p className="text-[14px] text-on-surface-variant mt-1">
          Reach your insurance company's dedicated team directly for policy queries, claims assistance, and more.
        </p>
      </div>

      {/* Quick Action Banner */}
      <div className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-12 h-12 bg-primary/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary text-2xl">info</span>
        </div>
        <div className="flex-1">
          <p className="font-bold text-primary text-[15px]">Need to file a claim or apply for NCD?</p>
          <p className="text-[13px] text-on-surface-variant mt-1">
            You can do this directly through InsurShield — no account needed. For all other questions, contact your insurer below.
          </p>
        </div>
        <div className="flex gap-3 flex-shrink-0 w-full sm:w-auto">
          <button
            onClick={() => navigate('/claims')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary text-white font-bold px-4 py-2.5 rounded-xl hover:bg-primary-container transition-all text-[13px] active:scale-95"
          >
            <span className="material-symbols-outlined text-[16px]">report_problem</span>
            File Claim
          </button>
          <button
            onClick={() => navigate('/claims')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-white border-2 border-primary/20 text-primary font-bold px-4 py-2.5 rounded-xl hover:border-primary/40 transition-all text-[13px] active:scale-95"
          >
            <span className="material-symbols-outlined text-[16px]">discount</span>
            Apply NCD
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-secondary text-[20px]">search</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by insurer name or contact person..."
          className="w-full bg-white border border-outline-variant rounded-xl pl-10 pr-4 py-3 text-[14px] focus:ring-2 focus:ring-primary outline-none shadow-sm"
        />
      </div>

      {/* Insurer Cards */}
      <div className="space-y-4 mb-10">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-secondary">
            <span className="material-symbols-outlined text-4xl mb-2 block opacity-40">search_off</span>
            <p className="font-semibold">No insurer found matching "{search}"</p>
            <button onClick={() => setSearch('')} className="mt-3 text-primary font-bold text-[14px] underline">
              Clear search
            </button>
          </div>
        ) : (
          filtered.map((insurer, i) => (
            <motion.div
              key={insurer.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <InsurerCard insurer={insurer} />
            </motion.div>
          ))
        )}
      </div>

      {/* PIA Regulatory Notice */}
      <div className="bg-surface-container-low border border-outline-variant rounded-2xl p-5 mb-8 flex items-start gap-3">
        <span className="material-symbols-outlined text-secondary text-[22px] flex-shrink-0 mt-0.5">gavel</span>
        <div>
          <p className="font-bold text-on-surface text-[14px]">Regulated by the PIA</p>
          <p className="text-[12px] text-on-surface-variant mt-1 leading-relaxed">
            All insurance companies listed are regulated by the{' '}
            <strong className="text-on-surface">Pensions and Insurance Authority (PIA) of Zambia</strong>.
            If you have an unresolved dispute with any insurer, you may escalate to the PIA directly at{' '}
            <a href="tel:+260211254644" className="font-bold text-primary underline">+260 211 254 644</a> or{' '}
            <a href="mailto:info@pia.org.zm" className="font-bold text-primary underline">info@pia.org.zm</a>.
          </p>
        </div>
      </div>

      {/* FAQs */}
      <div>
        <h2 className="text-[20px] font-bold text-primary mb-4">Frequently Asked Questions</h2>
        <div className="space-y-2">
          {FAQS.map((faq, i) => <FAQItem key={i} q={faq.q} a={faq.a} />)}
        </div>
      </div>
    </motion.div>
  );
}
