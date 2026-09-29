import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useStore, useActiveInsurers } from '@/store';
import Meta from '@/components/ui/Meta';
import { PIA_CONFIG } from '@/domain/insurers';
import DotBand from '../components/DotBand';
import QuoteFanSchematic from '../components/QuoteFanSchematic';
import ComparisonSplit from '../components/ComparisonSplit';
import CtaBand from '../components/CtaBand';

const BENEFITS = [
  {
    index: '01',
    icon: 'layers',
    title: 'One request, every insurer',
    text: 'Enter your vehicle details once. The same request reaches every registered insurer at the same moment.',
  },
  {
    index: '02',
    icon: 'balance',
    title: 'No favourites, no ranking',
    text: 'Insurers compete on the same brief. You see each final quote exactly as the insurer issued it.',
  },
  {
    index: '03',
    icon: 'shield',
    title: 'Claims start here',
    text: 'File the first notification from your account and get a reference to take to your insurer.',
  },
];

const STEPS = [
  ['Describe the vehicle', 'Pick your cover, confirm the registration details, declare a value and state how the vehicle is used.'],
  ['Send one request', 'Create your account and submit once. Every insurer on the platform receives an identical brief.'],
  ['Compare and pay', 'Each insurer returns its own final quote and document. Compare price and cover, then pay to issue.'],
  ['Manage the cover', 'Policies, renewals, quote history and claim notifications all stay attached to your account.'],
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, resetJourney } = useStore();
  const activeInsurers = useActiveInsurers();
  const reduceMotion = useReducedMotion();

  const partnerLogos = activeInsurers.filter((insurer) => insurer.logoUrl);
  const displayedPartners = partnerLogos.length ? partnerLogos : activeInsurers;

  // One shared reveal, so sections enter with the same restrained motion.
  const reveal = {
    initial: reduceMotion ? {} : { opacity: 0, y: 14 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-80px' },
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  };

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.55]" aria-hidden="true" />
        {/* Vertical rules that register the hero to the page grid. */}
        <div className="pointer-events-none absolute inset-y-0 left-[8%] hidden w-px bg-line lg:block" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-y-0 right-[8%] hidden w-px bg-line lg:block" aria-hidden="true" />

        <div className="relative mx-auto grid max-w-[1200px] grid-cols-1 gap-14 px-6 py-20 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:px-10 lg:py-28">
          <div>
            <span className="inline-flex items-center gap-3 border border-dashed border-line-strong bg-canvas px-3 py-1.5">
              <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
              <Meta className="text-ink-muted">Zambia · Motor insurance marketplace</Meta>
            </span>

            <h1 className="mt-8 text-[44px] font-semibold leading-[1.02] tracking-[-0.04em] text-ink sm:text-[58px] lg:text-[68px]">
              Every insurer.
              <br />
              <span className="text-primary">One request.</span>
            </h1>

            <p className="mt-7 max-w-lg text-[17px] leading-[1.6] text-ink-muted">
              Tell us about your vehicle once. Your request goes to every insurer on InsurShield
              simultaneously, and you compare the quotes they send back — priced by them, not by us.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => { resetJourney(); navigate('/insurance-type'); }}
                className="group relative inline-flex min-h-[52px] items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary px-7 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]"
              >
                {/* Beam sweeps once across the button on hover. */}
                <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
                <span className="relative">Get insurance</span>
                <span className="material-symbols-outlined relative text-[18px] transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
              </button>

              {!isAuthenticated && (
                <button
                  type="button"
                  onClick={() => navigate('/create-account?mode=create&next=%2Fquote-request')}
                  className="inline-flex min-h-[52px] items-center justify-center rounded-[1px] border border-dashed border-line-strong bg-canvas px-7 text-[15px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary"
                >
                  Create account
                </button>
              )}
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
              {['All active insurers', 'Insurer documents', 'Secure account'].map((item, index) => (
                <span key={item} className="inline-flex items-center gap-3">
                  {index > 0 && <span className="hidden h-3 w-px bg-line-strong sm:block" aria-hidden="true" />}
                  <Meta className="text-ink-faint">{item}</Meta>
                </span>
              ))}
            </div>
          </div>

          {/* Schematic panel: the mechanism, drawn. */}
          <div className="ticked border border-line bg-canvas p-6 sm:p-8">
            <div className="flex items-center justify-between border-b border-dashed border-line pb-4">
              <Meta className="text-ink-muted">Request routing</Meta>
              <Meta className="text-primary">{activeInsurers.length} active</Meta>
            </div>
            <div className="py-6">
              <QuoteFanSchematic insurers={activeInsurers} />
            </div>
            <div className="flex items-center justify-between border-t border-dashed border-line pt-4">
              <Meta className="text-ink-faint">Simultaneous delivery</Meta>
              <DotBand count={10} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Facts band ───────────────────────────────────────────── */}
      <section className="border-b border-line bg-canvas-2">
        <div className="mx-auto grid max-w-[1200px] grid-cols-2 px-6 lg:grid-cols-4 lg:px-10">
          {[
            [String(activeInsurers.length), 'Insurers receive every request'],
            ['1', 'Form to complete, ever'],
            [`${PIA_CONFIG.piaRatePercentage}%`, 'PIA regulated minimum rate'],
            ['3–12', 'Month cover periods'],
          ].map(([value, label], index) => (
            <div
              key={label}
              className={`border-line py-8 lg:py-10 ${index % 2 === 0 ? 'pr-5' : 'border-l pl-5'} ${index < 2 ? 'border-b lg:border-b-0' : ''} lg:border-l lg:pl-6 ${index === 0 ? 'lg:border-l-0 lg:pl-0' : ''}`}
            >
              <p className="text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink">{value}</p>
              <p className="mt-3 max-w-[180px] text-[13px] leading-[1.45] text-ink-muted">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── The argument, side by side ───────────────────────────── */}
      <ComparisonSplit insurerCount={activeInsurers.length} />

      {/* ── Benefits ─────────────────────────────────────────────── */}
      <section className="border-b border-line">
        <motion.div {...reveal} className="mx-auto max-w-[1200px] px-6 py-20 lg:px-10 lg:py-24">
          <div className="flex items-center gap-4">
            <Meta className="text-primary">How it differs</Meta>
            <span className="h-px flex-1 bg-line" aria-hidden="true" />
          </div>

          <h2 className="mt-7 max-w-2xl text-[32px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink sm:text-[42px]">
            The whole market, in one pass.
          </h2>

          <div className="mt-12 grid border-t border-line md:grid-cols-3">
            {BENEFITS.map((item) => (
              <article
                key={item.title}
                className="group relative overflow-hidden border-b border-line p-7 transition-colors duration-200 ease-out hover:bg-canvas-2 md:border-b-0 md:border-r md:last:border-r-0"
              >
                <span className="beam pointer-events-none absolute left-0 top-0 h-px w-1/3 bg-primary" aria-hidden="true" />
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[1px] border border-dashed border-line-strong text-primary transition-colors duration-200 ease-out group-hover:border-primary">
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{item.icon}</span>
                  </span>
                  <Meta className="text-ink-faint">{item.index}</Meta>
                </div>
                <h3 className="mt-7 text-[19px] font-semibold tracking-[-0.02em] text-ink">{item.title}</h3>
                <p className="mt-3 text-[15px] leading-[1.6] text-ink-muted">{item.text}</p>
              </article>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── Steps ────────────────────────────────────────────────── */}
      <section className="border-b border-line bg-canvas-2">
        <motion.div {...reveal} className="mx-auto grid max-w-[1200px] gap-14 px-6 py-20 lg:grid-cols-[.85fr_1.15fr] lg:px-10 lg:py-24">
          <div>
            <div className="flex items-center gap-4">
              <Meta className="text-primary">Sequence</Meta>
              <span className="h-px flex-1 bg-line" aria-hidden="true" />
            </div>
            <h2 className="mt-7 text-[32px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink sm:text-[40px]">
              Four steps, start to cover.
            </h2>
            <p className="mt-5 max-w-md text-[16px] leading-[1.6] text-ink-muted">
              Explore as a visitor for as long as you like. An account is only required when you
              send a request, start a claim, or apply for a no-claims discount.
            </p>
            <Link
              to={isAuthenticated ? '/account' : '/create-account?next=%2Faccount'}
              className="group mt-8 inline-flex items-center gap-2 border-b border-primary pb-1 text-[15px] font-medium text-primary"
            >
              {isAuthenticated ? 'Go to my account' : 'Create your account'}
              <span className="material-symbols-outlined text-[18px] transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
            </Link>

            <div className="mt-12 border border-dashed border-line-strong p-5">
              <div className="flex items-center justify-between">
                <Meta className="text-ink-muted">Account required from</Meta>
                <Meta className="text-primary">Step 02</Meta>
              </div>
              <p className="mt-4 text-[13px] leading-[1.55] text-ink-muted">
                Steps 1 and 3 onward are tied to your account so quotes, documents and claim
                references stay in one place.
              </p>
              <DotBand count={12} className="mt-5" />
            </div>
          </div>

          <ol className="border-t border-line">
            {STEPS.map(([title, text], index) => (
              <li key={title} className="group flex gap-6 border-b border-line py-6 transition-colors duration-200 ease-out hover:bg-canvas">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[1px] border border-line-strong bg-canvas font-mono text-[12px] text-primary transition-colors duration-200 ease-out group-hover:border-primary group-hover:bg-primary group-hover:text-white">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">{title}</h3>
                  <p className="mt-2 max-w-xl text-[14px] leading-[1.6] text-ink-muted">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </motion.div>
      </section>

      {/* ── Insurer network ──────────────────────────────────────── */}
      {displayedPartners.length > 0 && (
        <section className="overflow-hidden border-b border-line py-16 lg:py-20">
          <div className="mx-auto max-w-[1200px] px-6 lg:px-10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Meta className="text-ink-muted">The network</Meta>
              <DotBand count={12} />
            </div>
          </div>

          <div className="mt-10 flex overflow-hidden border-y border-line">
            <div className="partner-marquee flex w-max shrink-0">
              {[...displayedPartners, ...displayedPartners].map((insurer, index) => (
                <div
                  key={`${insurer.id}-${index}`}
                  className="flex h-[104px] w-[220px] shrink-0 items-center justify-center border-r border-dashed border-line px-6"
                >
                  {insurer.logoUrl ? (
                    <img src={insurer.logoUrl} alt={`${insurer.name} logo`} className="max-h-12 max-w-[150px] object-contain" />
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-[1px] bg-primary text-white">
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">shield</span>
                      </span>
                      <span className="max-w-[110px] text-[13px] font-medium leading-[1.3] tracking-[-0.01em] text-ink">{insurer.name}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Closing call to action ───────────────────────────────── */}
      <CtaBand />

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="bg-ink px-6 pb-12 pt-4 lg:px-10">
        <div className="mx-auto max-w-[1200px] border-t border-white/10 pt-12">
          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <p className="font-serif text-[28px] leading-none tracking-[-0.05em] text-white">
                Insur<span className="text-primary">Shield</span>
              </p>
              <p className="mt-5 max-w-sm text-[14px] leading-[1.6] text-white/50">
                A motor-insurance marketplace for Zambia: compare cover from every registered
                insurer, manage your policies, and start a claim notification.
              </p>
              <DotBand count={16} className="mt-7" />
            </div>
            <div>
              <Meta className="text-white/40">Company</Meta>
              <ul className="mt-5 space-y-3 text-[14px]">
                <li><Link to="/support" className="text-white/70 transition-colors duration-200 ease-out hover:text-white">Contact support</Link></li>
                <li><Link to="/admin-login" className="text-white/70 transition-colors duration-200 ease-out hover:text-white">Staff portal</Link></li>
              </ul>
            </div>
            <div>
              <Meta className="text-white/40">Legal</Meta>
              <ul className="mt-5 space-y-3 text-[14px]">
                <li><Link to="/support#privacy" className="text-white/70 transition-colors duration-200 ease-out hover:text-white">Privacy notice</Link></li>
                <li><Link to="/support#terms" className="text-white/70 transition-colors duration-200 ease-out hover:text-white">Terms of use</Link></li>
              </ul>
            </div>
          </div>

          <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Meta className="text-white/35">© {new Date().getFullYear()} InsurShield Aggregator Ltd</Meta>
            <Meta className="text-white/35">Lusaka, Zambia</Meta>
          </div>
        </div>
      </footer>
    </>
  );
}
