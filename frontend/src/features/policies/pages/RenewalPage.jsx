import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '@/store';

export default function RenewalPage() {
  const navigate = useNavigate();
  const { customer, policies, setVehicleDetails, setVehicleValue, setInsuranceType } = useStore();
  const myPolicies = policies.filter(policy => policy.customerEmail === customer?.email || policy.customerPhone === customer?.phone);

  const renew = (policy) => {
    setVehicleDetails(policy.vehicleDetails || { make: 'Your', model: 'vehicle', year: '', plateNumber: '' });
    setVehicleValue(policy.vehicleValue || policy.insuredValue || 0);
    setInsuranceType(/third/i.test(policy.coverage || '') ? 'ThirdParty' : 'Comprehensive');
    navigate('/insurance-type');
  };

  return <main className="mx-auto w-full max-w-3xl px-4 py-7 pb-28 sm:py-10">
    <Link to="/account" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary"><span className="material-symbols-outlined text-[18px]">arrow_back</span>My account</Link>
    <header className="mt-5 rounded-3xl bg-primary p-6 text-white sm:p-8"><span className="material-symbols-outlined text-3xl">autorenew</span><h1 className="mt-4 text-3xl font-bold">Renew a policy</h1><p className="mt-2 max-w-xl text-sm leading-6 text-white/85">Choose an existing policy to start a new quote. We will carry forward your saved vehicle details, then you can review cover and compare insurers.</p></header>
    <section className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold text-primary">Your policies</h2><p className="mt-1 text-sm text-secondary">Renewal starts a fresh quote, so you can compare current offers.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{myPolicies.length} active</span></div>
      {myPolicies.length ? <div className="mt-5 space-y-3">{myPolicies.map(policy => <article key={policy.policyNumber} className="rounded-2xl border border-outline-variant bg-surface-container-low p-4"><div className="flex items-start gap-3"><span className="material-symbols-outlined rounded-xl bg-white p-2 text-primary shadow-sm">directions_car</span><div className="min-w-0 flex-1"><p className="font-bold text-primary">{policy.vehicle}</p><p className="mt-1 text-xs text-secondary">{policy.insurer} · {policy.policyNumber}</p>{policy.policyDates && <p className="mt-2 text-xs font-medium text-on-surface-variant">Cover ends {policy.policyDates.formattedEnd}</p>}</div></div><button onClick={() => renew(policy)} className="mt-4 min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-bold text-white hover:bg-primary-container sm:w-auto">Renew this policy</button></article>)}</div> : <div className="mt-5 rounded-2xl bg-surface-container-low p-5 text-center"><span className="material-symbols-outlined text-4xl text-primary/50">description</span><h3 className="mt-2 font-bold text-primary">No policies to renew yet</h3><p className="mt-1 text-sm text-secondary">Once you purchase a policy, it will appear here when renewal is due.</p><Link to="/insurance-type" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-bold text-white">Get a new quote</Link></div>}
    </section>
  </main>;
}
