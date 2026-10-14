import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { useStore } from '@/store';
import { hydrateDirectory } from '@/api/sync';

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
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 p-4 text-left text-sm font-medium transition-colors hover:bg-muted/60"
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
          <p className="text-sm leading-6 text-muted-foreground">{a}</p>
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
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-none transition-colors duration-200 ease-out"
    >
      <div className="flex items-center gap-4 border-b border-border p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {insurer.logoUrl ? <img src={insurer.logoUrl} alt="" className="h-8 w-8 object-contain" /> : <span className="material-symbols-outlined text-[22px]">{insurer.logo}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-medium leading-tight tracking-[-0.01em] text-ink">{insurer.name}</h3>
          <p className="mt-1 text-[12px] text-ink-muted">{insurer.tagline}</p>
        </div>
      </div>

      {/* Contact Person Badge */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <span className="material-symbols-outlined text-primary text-[18px]">person</span>
        </div>
        <div>
          <p className="font-medium text-[14px] text-ink">{insurer.contactPerson}</p>
          <p className="text-[11px] text-ink-muted">{insurer.role}</p>
        </div>
      </div>

      {/* Quick Contact Actions — all use theme tokens */}
      <div className="grid grid-cols-3 gap-2 p-4">
        <a
          href={`tel:${insurer.mobile}`}
          className="group flex flex-col items-center gap-1.5 rounded-lg border border-primary/15 bg-primary/5 p-3 transition-colors hover:bg-primary/10"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background transition-transform group-hover:scale-105">
            <span className="material-symbols-outlined text-primary text-[20px]">phone</span>
          </div>
          <p className="text-[10px] font-medium text-primary uppercase tracking-wide">Call</p>
        </a>
        <a
          href={`https://wa.me/${insurer.whatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col items-center gap-1.5 rounded-lg border border-primary/15 bg-primary/5 p-3 transition-colors hover:bg-primary/10"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background transition-transform group-hover:scale-105">
            <span className="material-symbols-outlined text-primary text-[20px]">chat</span>
          </div>
          <p className="text-[10px] font-medium text-primary uppercase tracking-wide">WhatsApp</p>
        </a>
        <a
          href={`mailto:${insurer.email}`}
          className="group flex flex-col items-center gap-1.5 rounded-lg border border-primary/15 bg-primary/5 p-3 transition-colors hover:bg-primary/10"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background transition-transform group-hover:scale-105">
            <span className="material-symbols-outlined text-primary text-[20px]">email</span>
          </div>
          <p className="text-[10px] font-medium text-primary uppercase tracking-wide">Email</p>
        </a>
      </div>

      {/* Expand / Collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between border-t border-border px-5 py-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-primary"
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
          className="space-y-3 border-t border-border bg-muted/40 px-5 pb-5 pt-4"
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
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
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

  // The directory is the public insurer list; load it when the page opens.
  useEffect(() => { void hydrateDirectory(); }, []);
  const directory = insurersList.filter((insurer) => insurer.status !== 'Deleted').map(toContact);

  const filtered = directory.filter(ins =>
    ins.name.toLowerCase().includes(search.toLowerCase()) ||
    ins.contactPerson.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="pwa-main min-h-full bg-muted/60">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <header className="border-b border-border pb-7">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">support_agent</span>
          Help centre
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Contact your insurer</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Find the right claims desk, contact your insurer directly, or get quick answers about InsurShield.
        </p>
      </header>

      <Card className="mt-6 gap-0 border-border shadow-none">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">info</span></span>
            <div><p className="text-sm font-medium text-foreground">Need to file a claim or apply for NCD?</p><p className="mt-1 text-sm leading-5 text-muted-foreground">Start the process in InsurShield, then use this directory for insurer-specific help.</p></div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" size="sm" onClick={() => navigate('/claims')}><span className="material-symbols-outlined" aria-hidden="true">report_problem</span>File claim</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => navigate('/claims')}><span className="material-symbols-outlined" aria-hidden="true">sell</span>Apply NCD</Button>
          </div>
        </CardContent>
      </Card>

      <section className="mt-6">
        <Card className="gap-0 border-border shadow-none">
          <CardHeader className="gap-4 border-b lg:grid-cols-[1fr_minmax(280px,420px)] lg:items-center">
            <div><CardTitle>Insurer directory</CardTitle><p className="mt-1 text-sm text-muted-foreground">Search the participating insurers and contact the right team.</p></div>
            <label className="relative block">
              <span className="sr-only">Search insurers</span>
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-muted-foreground" aria-hidden="true">search</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search insurer or contact person" className="h-10 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50" />
            </label>
          </CardHeader>
          <CardContent className="pt-5">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center text-muted-foreground">
            <span className="material-symbols-outlined mb-2 block text-4xl opacity-40">search_off</span>
            <p className="font-medium text-foreground">No insurer found matching “{search}”</p>
            <Button type="button" variant="link" size="sm" onClick={() => setSearch('')} className="mt-2">Clear search</Button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((insurer, i) => (
            <motion.div
              key={insurer.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <InsurerCard insurer={insurer} />
            </motion.div>
          ))}
          </div>
        )}
          </CardContent>
        </Card>
      </section>

      <Card className="mt-6 gap-0 border-border bg-muted/40 shadow-none"><CardContent className="flex items-start gap-3 py-5">
        <span className="material-symbols-outlined mt-0.5 shrink-0 text-[22px] text-primary">gavel</span>
        <div>
          <p className="text-sm font-medium text-foreground">Regulated by the PIA</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            All insurance companies listed are regulated by the{' '}
            <strong className="text-foreground">Pensions and Insurance Authority (PIA) of Zambia</strong>.
            If you have an unresolved dispute with any insurer, you may escalate to the PIA directly at{' '}
            <a href="tel:+260211254644" className="font-medium text-primary underline">+260 211 254 644</a> or{' '}
            <a href="mailto:info@pia.org.zm" className="font-medium text-primary underline">info@pia.org.zm</a>.
          </p>
        </div>
      </CardContent></Card>

      <section className="mt-6">
        <Card className="gap-0 border-border shadow-none">
          <CardHeader className="border-b"><CardTitle>Frequently asked questions</CardTitle><p className="text-sm text-muted-foreground">Quick answers before you contact an insurer.</p></CardHeader>
          <CardContent className="grid gap-2 pt-5 lg:grid-cols-2">
          {FAQS.map((faq, i) => <FAQItem key={i} q={faq.q} a={faq.a} />)}
          </CardContent>
        </Card>
      </section>
      </motion.div>
    </main>
  );
}
