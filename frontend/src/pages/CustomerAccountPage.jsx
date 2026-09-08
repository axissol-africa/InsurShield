import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { formatZMW } from '../utils/premiumEngine';

export default function CustomerAccountPage() {
  const { customer, policies, quoteRequests, claims } = useStore();
  const belongsToCustomer = item => item.customer?.email === customer?.email || item.customerEmail === customer?.email || item.phone === customer?.phone || item.customerPhone === customer?.phone;
  const myPolicies = policies.filter(belongsToCustomer);
  const myQuotes = quoteRequests.filter(belongsToCustomer);
  const myClaims = claims.filter(belongsToCustomer);

  return <main className="mx-auto w-full max-w-[1500px] px-5 py-10 pb-24 sm:px-8 lg:py-12">
    <section className="rounded-2xl bg-primary p-7 text-white md:p-10">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/70">My InsurShield</p>
      <h1 className="mt-3 text-[38px] font-extrabold tracking-[-.04em] sm:text-[48px]">Welcome back, {customer?.fullName?.split(' ')[0] || 'customer'}.</h1>
      <p className="mt-3 max-w-3xl text-[17px] text-white/90">Manage your policies, renewals, quote requests and claim notifications from one secure account.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link to="/insurance-type" className="rounded-lg bg-white px-5 py-3 text-sm font-bold text-primary">Get quotes</Link>
        <Link to="/renewal" className="rounded-lg border-2 border-white px-5 py-3 text-sm font-bold text-white">Renew policy</Link>
        <Link to="/claims" className="rounded-lg border-2 border-white px-5 py-3 text-sm font-bold text-white">Claims & NCD</Link>
      </div>
    </section>

    <section className="mt-6 grid gap-4 sm:grid-cols-3">
      {[['Active policies', myPolicies.length, 'verified_user'], ['Quote requests', myQuotes.length, 'request_quote'], ['Claim notifications', myClaims.length, 'report_problem']].map(([label, value, icon]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><span className="material-symbols-outlined text-primary">{icon}</span><p className="mt-4 text-4xl font-extrabold tracking-[-.04em] text-on-surface">{value}</p><p className="mt-1 text-[15px] text-secondary">{label}</p></div>)}
    </section>

    <section className="mt-7 grid gap-5 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between gap-3"><h2 className="text-[22px] font-extrabold">Policies</h2><Link to="/renewal" className="text-sm font-bold text-primary">Renew a policy</Link></div>{myPolicies.length ? <div className="mt-4 space-y-3">{myPolicies.map(policy => <div key={policy.policyNumber} className="rounded-xl bg-slate-50 p-4"><div className="flex justify-between gap-3"><div><p className="font-bold text-primary">{policy.insurer}</p><p className="text-xs text-secondary">{policy.policyNumber} · {policy.vehicle}</p></div><span className="rounded-md bg-green-100 px-2 py-1 text-xs font-bold text-green-700">Active</span></div><p className="mt-2 text-sm font-semibold">{formatZMW(policy.premium || 0)}</p><Link to="/renewal" className="mt-3 inline-flex min-h-10 items-center text-xs font-bold text-primary">Renew this policy <span className="material-symbols-outlined ml-1 text-[16px]">arrow_forward</span></Link></div>)}</div> : <Empty text="Your issued policies will appear here after payment." />}</div>
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"><h2 className="font-bold text-primary">Quote activity</h2>{myQuotes.length ? <div className="mt-4 space-y-3">{myQuotes.map(quote => <div key={quote.id} className="rounded-xl bg-surface-container-low p-4"><p className="font-bold text-primary">{quote.vehicle}</p><p className="mt-1 text-xs text-secondary">{quote.id} · sent to {quote.insurers?.length || 0} insurers</p><p className="mt-2 text-xs font-bold text-primary">{Object.keys(quote.insurerQuotes || {}).length ? 'Insurer response received' : 'Quotes ready to compare'}</p></div>)}</div> : <Empty text="Send one request to receive comparable quotes." />}</div>
    </section>

    <section className="mt-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"><h2 className="font-bold text-primary">Claims & NCD</h2><p className="mt-2 text-sm text-secondary">{myClaims.length} claim notification(s) are connected to this account. NCD is retained for a future insurer-supported release.</p><Link to="/claims" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-primary/10 px-4 text-sm font-bold text-primary">Manage claims</Link></section>
  </main>;
}

function Empty({ text }) { return <p className="mt-4 rounded-xl bg-surface-container-low p-4 text-sm text-secondary">{text}</p>; }
