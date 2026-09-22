import { Link, useNavigate } from 'react-router-dom';
import { useStore, useActiveInsurers } from '@/store';

const BENEFITS = [
  { icon: 'layers', title: 'Unified Insurer Ecosystem', text: 'Compare trusted Zambian insurance providers through one secure, straightforward process.' },
  { icon: 'balance', title: 'Fair to every insurer', text: 'Your request reaches all registered insurers at once, so you see the full market and each insurer competes for your business.' },
  { icon: 'shield', title: 'Claims Support', text: 'Submit the first claim notification from your account and receive a reference for your insurer.' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useStore();
  const activeInsurers = useActiveInsurers();
  const partnerLogos = activeInsurers.filter(insurer => insurer.logoUrl);
  const displayedPartners = partnerLogos.length ? partnerLogos : activeInsurers;

  return <>
    <section className="mx-auto grid max-w-[1500px] grid-cols-1 gap-12 px-7 py-14 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:px-12 lg:py-24">
      <div>
        <p className="text-[13px] font-extrabold uppercase tracking-[.12em] text-primary">Zambia’s premium insurance portal</p>
        <h1 className="mt-8 max-w-3xl text-[43px] font-extrabold leading-[1.04] tracking-[-.045em] text-on-surface sm:text-[56px] lg:text-[68px]">Compare motor insurance quotes from <span className="text-primary">Zambia’s top insurers</span></h1>
        <p className="mt-8 max-w-2xl text-[18px] leading-7 text-secondary sm:text-[20px]">Tell us about your vehicle once. Your request goes to every insurer on InsurShield at the same time, and you compare the quotes they send back.</p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <button onClick={() => navigate('/insurance-type')} className="inline-flex min-h-14 items-center justify-center gap-3 rounded-lg bg-primary px-7 text-[17px] font-bold text-white shadow-sm hover:bg-primary-container">Get insurance <span className="material-symbols-outlined">arrow_forward</span></button>
          {!isAuthenticated && <button onClick={() => navigate('/create-account?mode=create&next=%2Fquote-request')} className="min-h-14 rounded-lg border border-slate-200 bg-white px-7 text-[17px] font-bold text-on-surface hover:border-primary hover:text-primary">Create account</button>}
        </div>
        <div className="mt-9 flex flex-wrap gap-x-8 gap-y-3 text-[13px] font-bold text-secondary"><span className="inline-flex items-center gap-2"><span className="material-symbols-outlined text-primary">verified_user</span>Trusted insurance access</span><span className="inline-flex items-center gap-2"><span className="material-symbols-outlined text-primary">lock</span>Secure account protection</span></div>
      </div>

      <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
        <div className="rounded-xl bg-primary p-7 text-white sm:p-9"><p className="text-[12px] font-extrabold uppercase tracking-[.13em] text-white/75">Simple customer journey</p><h2 className="mt-3 text-[30px] font-extrabold leading-tight">One request. Every insurer. Your choice.</h2><p className="mt-4 text-[16px] leading-6 text-white/90">Every registered insurer receives the same request and replies with its own final quote — no favourites, no repeated forms.</p></div>
        <div className="mt-5 grid gap-3">
          <button onClick={() => navigate('/insurance-type')} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-primary"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><span className="material-symbols-outlined">description</span></span><span><span className="block font-bold">Get a motor quote</span><span className="text-[13px] text-secondary">Available now — compare insurer offers</span></span><span className="material-symbols-outlined ml-auto text-primary">arrow_forward</span></button>
          <Link to={isAuthenticated ? '/account' : '/create-account?next=%2Faccount'} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:border-primary"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><span className="material-symbols-outlined">person</span></span><span><span className="block font-bold">Manage my insurance</span><span className="text-[13px] text-secondary">Policies, renewals and claim notifications</span></span><span className="material-symbols-outlined ml-auto text-primary">arrow_forward</span></Link>
        </div>
      </aside>
    </section>

    <section className="bg-slate-50 px-7 py-16 lg:px-12 lg:py-24"><div className="mx-auto max-w-[1500px]"><div className="mx-auto max-w-3xl text-center"><h2 className="text-[32px] font-extrabold tracking-[-.035em] sm:text-[42px]">Insurance made easier to understand</h2><p className="mt-4 text-[17px] leading-7 text-secondary">Clear choices and useful guidance at every step, on desktop or mobile.</p></div><div className="mt-10 grid gap-5 md:grid-cols-3">{BENEFITS.map(item => <article key={item.title} className="rounded-xl border border-slate-200 bg-white p-7"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><span className="material-symbols-outlined">{item.icon}</span></span><h3 className="mt-6 text-[20px] font-extrabold">{item.title}</h3><p className="mt-3 text-[15px] leading-6 text-secondary">{item.text}</p></article>)}</div></div></section>

    <section className="px-7 py-16 lg:px-12 lg:py-24">
      <div className="mx-auto grid max-w-[1500px] gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
        <div><p className="text-[13px] font-extrabold uppercase tracking-[.12em] text-primary">How InsurShield works</p><h2 className="mt-4 text-[34px] font-extrabold leading-tight tracking-[-.04em] sm:text-[44px]">One secure account for every stage of your motor insurance.</h2><p className="mt-5 max-w-xl text-[17px] leading-7 text-secondary">Start as a visitor and explore the platform freely. Create an account when you are ready to request quotes, then return to manage your insurance at any time.</p><Link to={isAuthenticated ? '/account' : '/create-account?next=%2Faccount'} className="mt-7 inline-flex min-h-12 items-center gap-2 font-bold text-primary hover:underline">{isAuthenticated ? 'Go to my account' : 'Create your secure account'} <span className="material-symbols-outlined">arrow_forward</span></Link></div>
        <ol className="grid gap-4 sm:grid-cols-2">{[
          ['1', 'Tell us about your vehicle', 'Choose your cover, verify vehicle details, declare a fair value, and select its main use.'],
          ['2', 'Send one request to all insurers', 'Create your account and send a single request. Every insurer on the platform receives it at the same time.'],
          ['3', 'Compare final quotes and pay', 'Insurers reply with their own quotes. Compare price, cover and requirements side by side, then pay to issue your policy.'],
          ['4', 'Manage your cover', 'Keep policies, renewals, quote activity and claim notifications safely connected to your account.'],
        ].map(([number, title, text]) => <li key={number} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-[14px] font-extrabold text-white">{number}</span><div><h3 className="text-[17px] font-extrabold">{title}</h3><p className="mt-2 text-[14px] leading-5 text-secondary">{text}</p></div></li>)}</ol>
      </div>
    </section>

    <section className="border-t border-slate-200 bg-slate-50 px-7 py-14 lg:px-12">
      <div className="mx-auto max-w-[1500px]">
        <div className="text-center"><p className="text-[13px] font-extrabold uppercase tracking-[.12em] text-primary">Our insurer network</p><h2 className="mt-3 text-[28px] font-extrabold tracking-[-.035em] sm:text-[36px]">Partnering with trusted insurers</h2></div>
        {displayedPartners.length ? <div className="mx-auto mt-8 max-w-6xl overflow-hidden"><div className="partner-marquee flex w-max gap-5 pr-5">{[...displayedPartners, ...displayedPartners].map((insurer, index) => <div key={`${insurer.id}-${index}`} className="flex h-24 w-48 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-5">{insurer.logoUrl ? <img src={insurer.logoUrl} alt={`${insurer.name} logo`} className="max-h-14 max-w-[150px] object-contain" /> : <div className="flex items-center gap-2.5"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white"><span className="material-symbols-outlined text-[21px]">shield</span></span><span className="max-w-[100px] text-left text-[13px] font-extrabold leading-4 text-on-surface">{insurer.name}</span></div>}</div>)}</div></div> : null}
      </div>
    </section>

    <footer className="bg-slate-950 px-7 py-12 text-slate-300 lg:px-12">
      <div className="mx-auto max-w-[1500px]">
        <div className="grid gap-9 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2"><p className="font-serif text-[31px] tracking-[-.05em] text-white">Insur<span className="text-primary">Shield</span></p><p className="mt-4 max-w-md text-[14px] leading-6 text-slate-400">A secure motor-insurance platform for comparing cover, managing policies, and submitting the first step of a claim notification.</p></div>
          <div><h3 className="text-[13px] font-extrabold uppercase tracking-[.1em] text-white">Company</h3><ul className="mt-4 space-y-3 text-[14px]"><li><Link to="/support" className="hover:text-white">Contact support</Link></li><li><Link to="/admin-login" className="hover:text-white">Staff portal</Link></li></ul></div>
          <div><h3 className="text-[13px] font-extrabold uppercase tracking-[.1em] text-white">Legal</h3><ul className="mt-4 space-y-3 text-[14px]"><li><Link to="/support#privacy" className="hover:text-white">Privacy notice</Link></li><li><Link to="/support#terms" className="hover:text-white">Terms of use</Link></li></ul></div>
        </div>
        <div className="mt-10 flex flex-col gap-3 border-t border-slate-800 pt-6 text-[12px] text-slate-500 sm:flex-row sm:items-center sm:justify-between"><p>© {new Date().getFullYear()} InsurShield Aggregator Ltd. All rights reserved.</p><p>Secure insurance access for Zambia.</p></div>
      </div>
    </footer>
  </>;
}
