import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Meta from '@/components/ui/Meta';
import { useStore } from '@/store';

// The directory is derived from the live insurer list so onboarding, edits and removals show immediately.
const toContact = (insurer) => ({ id: insurer.id, name: insurer.tradingName || insurer.name, logo: insurer.icon, logoUrl: insurer.logoUrl, contactPerson: '', role: '', phone: '', mobile: '', whatsapp: '', email: '', address: '', hours: '', tagline: '', ...insurer.contact });

const FAQS = [
  {
    q: 'How do I start a claim?',
    a: "Sign in, go to Claims and choose \"Start a claim\". InsurShield records your first notification and gives you a claim number straight away. You then call your insurer, quote the claim number, and they handle the assessment and settlement with you directly.",
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
    a: 'Once you have called your insurer with your claim number, the claim is handled entirely by them. Most insurers aim to assess a claim within 5–7 business days; contact their claims desk (listed on this page) for progress updates.',
  },
  {
    q: 'Can I get a copy of my policy certificate?',
    a: 'Your policy certificate is saved under My account as soon as payment is confirmed, and your insurer also emails the official document. If it does not arrive, contact your insurer using the details on this page.',
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────
function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-[1px] border border-line bg-canvas">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors duration-200 ease-out hover:bg-canvas-2"
      >
        <p className="text-[14px] font-medium text-ink">{q}</p>
        <span className={`material-symbols-outlined shrink-0 text-[20px] text-ink-faint transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="px-4 pb-4"
        >
          <p className="text-[13px] text-ink-muted leading-relaxed">{a}</p>
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
      className="overflow-hidden rounded-[1px] border border-line bg-canvas transition-colors duration-200 ease-out"
    >
      <div className="flex items-center gap-4 border-b border-dashed border-line p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1px] border border-dashed border-line-strong text-primary">
          {insurer.logoUrl ? <img src={insurer.logoUrl} alt="" className="h-8 w-8 object-contain" /> : <span className="material-symbols-outlined text-[22px]">{insurer.logo}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-medium leading-tight tracking-[-0.01em] text-ink">{insurer.name}</h3>
          <p className="mt-1 text-[12px] text-ink-muted">{insurer.tagline}</p>
        </div>
      </div>

      {/* Contact Person Badge */}
      <div className="px-5 py-3 border-b border-line-strong flex items-center gap-3">
        <div className="w-9 h-9 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-primary text-[18px]">person</span>
        </div>
        <div>
          <p className="font-medium text-[14px] text-ink">{insurer.contactPerson}</p>
          <p className="text-[11px] text-ink-muted">{insurer.role}</p>
        </div>
      </div>

      {/* Quick Contact Actions — all use theme tokens */}
      <div className="p-4 grid grid-cols-3 gap-2">
        <a
          href={`tel:${insurer.mobile}`}
          className="flex flex-col items-center gap-1.5 p-3 bg-primary/5 border border-primary/15 rounded-[1px] hover:bg-primary/10 transition-colors group"
        >
          <div className="w-9 h-9 bg-white rounded-[1px] flex items-center justify-center group-hover:scale-110 transition-transform border border-line-strong">
            <span className="material-symbols-outlined text-primary text-[20px]">phone</span>
          </div>
          <p className="text-[10px] font-medium text-primary uppercase tracking-wide">Call</p>
        </a>
        <a
          href={`https://wa.me/${insurer.whatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-1.5 p-3 bg-primary/5 border border-primary/15 rounded-[1px] hover:bg-primary/10 transition-colors group"
        >
          <div className="w-9 h-9 bg-white rounded-[1px] flex items-center justify-center group-hover:scale-110 transition-transform border border-line-strong">
            <span className="material-symbols-outlined text-primary text-[20px]">chat</span>
          </div>
          <p className="text-[10px] font-medium text-primary uppercase tracking-wide">WhatsApp</p>
        </a>
        <a
          href={`mailto:${insurer.email}`}
          className="flex flex-col items-center gap-1.5 p-3 bg-primary/5 border border-primary/15 rounded-[1px] hover:bg-primary/10 transition-colors group"
        >
          <div className="w-9 h-9 bg-white rounded-[1px] flex items-center justify-center group-hover:scale-110 transition-transform border border-line-strong">
            <span className="material-symbols-outlined text-primary text-[20px]">email</span>
          </div>
          <p className="text-[10px] font-medium text-primary uppercase tracking-wide">Email</p>
        </a>
      </div>

      {/* Expand / Collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 border-t border-line-strong text-[13px] font-semibold text-ink-muted hover:text-primary hover:bg-canvas-2 transition-colors"
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
          className="px-5 pb-5 space-y-3 border-t border-line-strong pt-4 bg-canvas-2/40"
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
      <div className="w-8 h-8 bg-white border border-line-strong rounded-[1px] flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="material-symbols-outlined text-ink-muted text-[16px]">{icon}</span>
      </div>
      <div>
        <p className="text-[10px] uppercase font-medium tracking-wider text-ink-muted">{label}</p>
        <p className="text-[13px] text-ink font-medium mt-0.5">{value}</p>
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
  const insurersList = useStore((state) => state.insurersList);
  const directory = insurersList.filter((insurer) => insurer.status !== 'Deleted').map(toContact);

  const filtered = directory.filter(ins =>
    ins.name.toLowerCase().includes(search.toLowerCase()) ||
    ins.contactPerson.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative overflow-hidden">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-[1100px] px-6 py-12 pb-24 lg:px-10">
      {/* Header */}
      <header className="border-b border-line pb-8">
        <span className="inline-flex items-center gap-3">
          <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
          <Meta className="text-ink-muted">Insurer directory</Meta>
        </span>
        <h1 className="mt-6 text-[36px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[44px]">Contact your insurer</h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-[1.6] text-ink-muted">
          Reach your insurance company's claims desk directly for policy queries, claims assistance and more.
        </p>
      </header>

      {/* Two things people usually came here to do, but can do on InsurShield. */}
      <div className="mt-8 flex flex-col gap-4 border border-dashed border-line-strong p-5 sm:flex-row sm:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1px] border border-dashed border-line-strong text-primary">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">info</span>
        </span>
        <div className="flex-1">
          <p className="text-[15px] font-medium text-ink">Need to file a claim or apply for NCD?</p>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-muted">
            You can do this directly through InsurShield — no account needed. For all other questions, contact your insurer below.
          </p>
        </div>
        <div className="flex w-full shrink-0 gap-3 sm:w-auto">
          <button
            onClick={() => navigate('/claims')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-primary text-white font-medium px-4 py-2.5 rounded-[1px] hover:bg-[#b91c1c] transition-all text-[13px] active:scale-95"
          >
            <span className="material-symbols-outlined text-[16px]">report_problem</span>
            File Claim
          </button>
          <button
            onClick={() => navigate('/claims')}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-white border-2 border-primary/20 text-primary font-medium px-4 py-2.5 rounded-[1px] hover:border-primary/40 transition-all text-[13px] active:scale-95"
          >
            <span className="material-symbols-outlined text-[16px]">sell</span>
            Apply NCD
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-[20px]">search</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by insurer name or contact person..."
          className="w-full bg-white border border-line-strong rounded-[1px] pl-10 pr-4 py-3 text-[14px] focus:ring-2 focus:ring-primary outline-none"
        />
      </div>

      {/* Insurer Cards */}
      <div className="space-y-4 mb-10">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-ink-muted">
            <span className="material-symbols-outlined text-4xl mb-2 block opacity-40">search_off</span>
            <p className="font-semibold">No insurer found matching "{search}"</p>
            <button onClick={() => setSearch('')} className="mt-3 text-primary font-medium text-[14px] underline">
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
      <div className="bg-canvas-2 border border-line-strong rounded-[1px] p-5 mb-8 flex items-start gap-3">
        <span className="material-symbols-outlined text-ink-muted text-[22px] flex-shrink-0 mt-0.5">gavel</span>
        <div>
          <p className="font-medium text-ink text-[14px]">Regulated by the PIA</p>
          <p className="text-[12px] text-ink-muted mt-1 leading-relaxed">
            All insurance companies listed are regulated by the{' '}
            <strong className="text-ink">Pensions and Insurance Authority (PIA) of Zambia</strong>.
            If you have an unresolved dispute with any insurer, you may escalate to the PIA directly at{' '}
            <a href="tel:+260211254644" className="font-medium text-primary underline">+260 211 254 644</a> or{' '}
            <a href="mailto:info@pia.org.zm" className="font-medium text-primary underline">info@pia.org.zm</a>.
          </p>
        </div>
      </div>

      {/* FAQs */}
      <div>
        <div className="mb-5 flex items-center gap-4">
          <Meta className="text-primary">Frequently asked</Meta>
          <span className="h-px w-12 bg-line" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          {FAQS.map((faq, i) => <FAQItem key={i} q={faq.q} a={faq.a} />)}
        </div>
      </div>
      </div>
    </motion.div>
  );
}
