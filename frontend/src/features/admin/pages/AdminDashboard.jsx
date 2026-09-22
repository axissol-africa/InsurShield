import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore, useActiveInsurers } from '@/store';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import InsurerOnboardingForm from '@/features/admin/components/InsurerOnboardingForm';
import InsurerTable from '@/features/admin/components/InsurerTable';

/** Illustrative figures behind the demo dashboard; live records are added on top. */
const DEMO_BOOK = { policies: 1281, activePolicies: 1250, pendingClaims: 89, monthlyRevenue: 1250000, expiring30d: 18 };
const DEMO_RECENT_POLICIES = [
  { policyNumber: 'POL-001', customerName: 'Mwiza Banda', vehicle: '2020 Toyota Hilux', insurer: 'Prestige Assurance', premium: 8000, status: 'Active' },
  { policyNumber: 'POL-002', customerName: 'Chanda Phiri', vehicle: '2022 BMW X5', insurer: 'Global Guard Insurance', premium: 23975, status: 'Active' },
  { policyNumber: 'POL-003', customerName: 'Thandiwe Zulu', vehicle: '2019 Nissan Navara', insurer: 'ValueDirect Insurance', premium: 4800, status: 'Expiring Soon' },
];
const REVENUE_BARS = [40, 55, 45, 70, 65, 90, 80, 75, 100, 85, 95, 88];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const inputClass = 'w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary';
const labelClass = 'mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-secondary';

const SubPageHeader = ({ title, onBack, action }) => (
  <div className="mb-8 flex items-center justify-between gap-4">
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white shadow-sm transition-colors hover:bg-gray-50">
        <span className="material-symbols-outlined text-[20px] text-secondary" aria-hidden="true">arrow_back</span>
      </button>
      <h2 className="text-[22px] font-bold text-primary">{title}</h2>
    </div>
    {action}
  </div>
);

const Page = ({ children }) => <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{children}</motion.div>;

/** Super-admin console: insurer onboarding and lifecycle, PIA floor, customer account lookup. */
export default function AdminDashboard() {
  const { insurersList, addInsurer, updateInsurer, setInsurerStatus, deleteInsurer, claims, piaConfig, setPiaConfig, staffSession, registeredAccounts, quoteRequests, policies } = useStore();
  const activeInsurers = useActiveInsurers();
  const piaRate = piaConfig?.piaRatePercentage ?? 4;
  const agentName = staffSession?.name || 'Admin';
  const agentRole = staffSession?.role || 'admin';

  const [view, setView] = useState('dashboard');
  const [editingInsurer, setEditingInsurer] = useState(null);
  const [viewingInsurer, setViewingInsurer] = useState(null);

  const openClaims = claims.filter((claim) => claim.status === 'Notified').length;
  const recentPolicies = [...policies, ...DEMO_RECENT_POLICIES].slice(0, 5);

  const showInsurers = () => { setEditingInsurer(null); setViewingInsurer(null); setView('manage_insurers'); };
  const saveInsurer = (insurer) => {
    if (editingInsurer) updateInsurer(editingInsurer.id, insurer);
    else addInsurer(insurer);
    showInsurers();
  };
  const confirmDelete = (insurer) => {
    if (window.confirm(`Delete ${insurer.name} from new quote requests? Existing quotes, policies and claims are kept for audit history.`)) deleteInsurer(insurer.id);
  };

  if (view === 'view_insurer' && viewingInsurer) return <Page><InsurerProfile insurer={viewingInsurer} onBack={showInsurers} /></Page>;

  if (view === 'add_insurer' || view === 'edit_insurer') {
    return (
      <Page>
        <SubPageHeader title={editingInsurer ? `Edit ${editingInsurer.name}` : 'Onboard an insurance company'} onBack={showInsurers} />
        <div className="max-w-3xl rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
          <p className="mb-6 text-[13px] text-secondary">
            {editingInsurer ? 'Edit the insurer details below. Its current status and existing records will be kept.' : 'Active companies receive every eligible quote request. Deactivated companies keep their historical records but receive no new requests.'}
          </p>
          <InsurerOnboardingForm insurer={editingInsurer} piaRatePercentage={piaRate} onSubmit={saveInsurer} onCancel={showInsurers} />
        </div>
      </Page>
    );
  }

  if (view === 'manage_insurers') {
    const addButton = (
      <button type="button" onClick={() => { setEditingInsurer(null); setView('add_insurer'); }} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-primary-container">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>Add Insurer
      </button>
    );
    return (
      <Page>
        <SubPageHeader title="Manage Insurers" onBack={() => setView('dashboard')} action={addButton} />
        <InsurerTable
          insurers={insurersList}
          piaRatePercentage={piaRate}
          onView={(insurer) => { setViewingInsurer(insurer); setView('view_insurer'); }}
          onEdit={(insurer) => { setEditingInsurer(insurer); setView('edit_insurer'); }}
          onRateChange={(id, ratePercentage) => updateInsurer(id, { ratePercentage })}
          onStatusChange={setInsurerStatus}
          onDelete={confirmDelete}
        />
      </Page>
    );
  }

  if (view === 'find_account') return <Page><FindCustomerAccount accounts={registeredAccounts} quoteRequests={quoteRequests} policies={policies} onBack={() => setView('dashboard')} /></Page>;

  if (view === 'pia_config') return <Page><PiaConfiguration piaRate={piaRate} onSave={(rate) => setPiaConfig({ piaRatePercentage: rate, lastUpdated: new Date().toISOString().split('T')[0], updatedBy: agentName })} onBack={() => setView('dashboard')} /></Page>;

  const kpis = [
    { label: 'Total Policies', value: DEMO_BOOK.policies + policies.length, icon: 'policy', change: '+12% vs last month' },
    { label: 'Active Policies', value: DEMO_BOOK.activePolicies + policies.filter((policy) => policy.status === 'Active').length, icon: 'verified_user', change: '+8% vs last month', highlight: true },
    { label: 'Active Insurers', value: activeInsurers.length, icon: 'business', change: `${insurersList.length - activeInsurers.length} inactive or removed` },
    { label: 'Claims Pending', value: DEMO_BOOK.pendingClaims + openClaims, icon: 'report_problem', change: `${openClaims} awaiting insurer acknowledgement`, alert: openClaims > 0 },
  ];
  const operations = [
    { label: 'Claims awaiting acknowledgement', value: openClaims, icon: 'policy', color: 'text-amber-600' },
    { label: 'Policies Expiring (30d)', value: DEMO_BOOK.expiring30d, icon: 'event_repeat', color: 'text-orange-600' },
    { label: 'PIA minimum rate', value: `${piaRate}% of value`, icon: 'gavel', color: 'text-primary', view: 'pia_config' },
  ];
  const quickActions = [
    { label: 'Manage Insurers', sub: `${activeInsurers.length} of ${insurersList.length} receiving requests`, icon: 'manage_accounts', view: 'manage_insurers' },
    { label: 'Onboard New Insurer', sub: 'Add provider & configure rates', icon: 'domain_add', view: 'add_insurer' },
    { label: 'PIA Rate Configuration', sub: `Floor: ${piaRate}% of vehicle value`, icon: 'gavel', view: 'pia_config' },
    { label: 'Find Customer Account', sub: 'Assist customers with account access', icon: 'support_agent', view: 'find_account' },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-secondary">Admin Overview</p>
          <h1 className="text-[30px] font-bold leading-tight text-primary">InsurShield Dashboard</h1>
          <p className="mt-0.5 text-[14px] text-secondary">{new Date().toLocaleDateString('en-ZM', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-4 py-2.5 shadow-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary"><span className="material-symbols-outlined text-[16px] text-white" style={{ fontVariationSettings: "'FILL' 1" }} aria-hidden="true">person</span></div>
          <div><p className="text-[12px] font-bold leading-tight text-primary">{agentName}</p><p className="text-[10px] capitalize text-secondary">{agentRole}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={`flex flex-col justify-between gap-4 rounded-2xl p-5 shadow-sm ${kpi.highlight ? 'bg-primary text-white' : 'border border-gray-100 bg-white'}`}>
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${kpi.highlight ? 'bg-white/20' : 'bg-primary/10'}`}><span className={`material-symbols-outlined text-[22px] ${kpi.highlight ? 'text-white' : 'text-primary'}`} aria-hidden="true">{kpi.icon}</span></div>
            <div>
              <p className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${kpi.highlight ? 'text-white/70' : 'text-secondary'}`}>{kpi.label}</p>
              <p className={`text-[28px] font-extrabold leading-none ${kpi.highlight ? 'text-white' : 'text-primary'}`}>{kpi.value.toLocaleString()}</p>
              <p className={`mt-1 text-[11px] font-semibold ${kpi.alert ? 'text-error' : kpi.highlight ? 'text-white/60' : 'text-primary'}`}>{kpi.change}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <div><h3 className="text-[17px] font-bold text-primary">Premium Revenue</h3><p className="text-[12px] text-secondary">Monthly collection (ZMW)</p></div>
            <span className="rounded-xl bg-primary/10 px-3 py-1.5 text-[12px] font-bold text-primary">{formatZMW(DEMO_BOOK.monthlyRevenue + policies.reduce((sum, policy) => sum + (policy.premium || 0), 0))}</span>
          </div>
          <div className="relative flex h-32 items-end gap-1.5">
            {REVENUE_BARS.map((height, index) => (
              <div key={MONTHS[index]} className="group relative flex-1 cursor-pointer rounded-t-md" style={{ height: `${height}%`, backgroundColor: `hsl(0, 72%, ${55 - height * 0.18}%)`, opacity: index === REVENUE_BARS.length - 1 ? 1 : 0.45 + index * 0.04 }}>
                <div className="absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">ZMW {(height * 12500).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex justify-between text-[10px] font-bold uppercase text-secondary">{MONTHS.map((month) => <span key={month}>{month}</span>)}</div>
        </div>

        <div className="flex flex-col rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-[17px] font-bold text-primary">Operations</h3>
          <div className="flex-1 space-y-1">
            {operations.map((item) => (
              <button key={item.label} type="button" onClick={() => item.view && setView(item.view)} disabled={!item.view}
                className="-mx-1 flex w-full items-center justify-between rounded-lg border-b border-gray-50 px-1 py-3 text-left transition-colors last:border-0 enabled:hover:bg-gray-50 disabled:cursor-default">
                <div className="flex items-center gap-2.5"><span className={`material-symbols-outlined ${item.color} text-[20px]`} aria-hidden="true">{item.icon}</span><span className="text-[13px] text-on-surface">{item.label}</span></div>
                <div className="flex items-center gap-1"><span className="text-[14px] font-bold text-primary">{item.value}</span>{item.view && <span className="material-symbols-outlined text-[14px] text-secondary" aria-hidden="true">chevron_right</span>}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-4 text-[17px] font-bold text-primary">Quick Management</h3>
          <div className="space-y-2.5">
            {quickActions.map((action) => (
              <button key={action.view} type="button" onClick={() => setView(action.view)} className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-white p-4 text-left transition-all hover:border-gray-200 hover:bg-gray-50 active:scale-[0.98]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10"><span className="material-symbols-outlined text-[22px] text-primary" aria-hidden="true">{action.icon}</span></div>
                  <div><p className="text-[14px] font-semibold text-primary">{action.label}</p><p className="text-[12px] text-secondary">{action.sub}</p></div>
                </div>
                <span className="material-symbols-outlined text-[20px] text-secondary" aria-hidden="true">chevron_right</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4"><h3 className="text-[17px] font-bold text-primary">Recent Policies</h3></div>
          <div className="flex-1 divide-y divide-gray-50">
            {recentPolicies.map((policy) => (
              <div key={policy.policyNumber} className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10"><span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">directions_car</span></div>
                  <div><p className="text-[14px] font-semibold text-primary">{policy.customerName || 'Customer'}</p><p className="text-[12px] text-secondary">{policy.vehicle}</p><p className="text-[11px] text-secondary">{policy.insurer}</p></div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="text-[14px] font-bold text-primary">{formatZMW(policy.premium || 0)}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${policy.status === 'Active' ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-800'}`}>{policy.status}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 bg-gray-50 px-5 py-3"><p className="text-[12px] text-secondary">Showing {recentPolicies.length} of {(DEMO_BOOK.policies + policies.length).toLocaleString()} policies</p></div>
        </div>
      </div>
    </motion.div>
  );
}

function InsurerProfile({ insurer, onBack }) {
  const contact = insurer.contact || {};
  const details = [
    ['PIA licence number', insurer.licenceNumber],
    ['Licence expiry', insurer.licenceExpiry && formatDate(insurer.licenceExpiry)],
    ['Coverage plan', insurer.coverage],
    ['Premium rate', insurer.ratePercentage !== undefined && `${insurer.ratePercentage}% of vehicle value`],
    ['Quote validity', insurer.quoteValidityDays && `${insurer.quoteValidityDays} days`],
    ['Inspection requirement', insurer.inspectionRules?.replaceAll('_', ' ')],
    ['Contact person', contact.contactPerson],
    ['Claims email', contact.email],
    ['Office phone', contact.phone],
    ['Website', insurer.website],
  ];
  return (
    <>
      <SubPageHeader title="Insurer details" onBack={onBack} />
      <section className="max-w-3xl overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-gray-100 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-white">
              {insurer.logoUrl ? <img src={insurer.logoUrl} alt={`${insurer.name} logo`} className="max-h-10 max-w-10 object-contain" /> : <span className="material-symbols-outlined text-[27px] text-primary" aria-hidden="true">business</span>}
            </span>
            <div><h3 className="text-[20px] font-bold text-primary">{insurer.name}</h3><p className="mt-1 text-[13px] text-secondary">Read-only company profile</p></div>
          </div>
          <span className={`inline-flex w-fit rounded-full px-3 py-1 text-[11px] font-bold uppercase ${insurer.status === 'Active' ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-600'}`}>{insurer.status || 'Active'}</span>
        </div>
        <dl className="grid gap-x-8 gap-y-5 p-6 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label}><dt className="text-[10px] font-bold uppercase tracking-wider text-secondary">{label}</dt><dd className="mt-1 break-words text-[14px] font-semibold text-on-surface">{value || 'Not recorded'}</dd></div>
          ))}
        </dl>
      </section>
    </>
  );
}

function FindCustomerAccount({ accounts, quoteRequests, policies, onBack }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);

  const search = (event) => {
    event.preventDefault();
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const account = accounts.find((item) => item.email.toLowerCase() === needle || item.phone === needle);
    setResult(account ? {
      account,
      requests: quoteRequests.filter((item) => item.customer?.email === account.email || item.customer?.phone === account.phone).length,
      policies: policies.filter((item) => item.customerEmail === account.email || item.customerPhone === account.phone).length,
    } : { notFound: true });
  };

  return (
    <>
      <SubPageHeader title="Find Customer Account" onBack={onBack} />
      <div className="max-w-xl rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
        <form onSubmit={search} className="space-y-4">
          <label className="block"><span className={labelClass}>Customer email or mobile number</span><input required value={query} onChange={(event) => setQuery(event.target.value)} className={inputClass} placeholder="name@email.com or 0970 123 456" /></label>
          <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-bold text-white"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">search</span>Find account</button>
        </form>
        {result?.notFound && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-[13px] text-amber-900">No account matches those details. Ask the customer to register, or check the spelling of the email address.</p>}
        {result?.account && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
            <div className="rounded-xl border border-outline-variant bg-surface-container-low p-5">
              <div className="flex items-center gap-2 font-bold text-primary"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">check_circle</span>Account found</div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                <div><dt className="text-[10px] font-bold uppercase text-secondary">Name</dt><dd className="font-semibold">{result.account.fullName}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase text-secondary">Mobile</dt><dd className="font-semibold">{result.account.phone}</dd></div>
                <div className="col-span-2"><dt className="text-[10px] font-bold uppercase text-secondary">Email</dt><dd className="font-semibold">{result.account.email}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase text-secondary">Quote requests</dt><dd className="font-semibold">{result.requests}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase text-secondary">Policies</dt><dd className="font-semibold">{result.policies}</dd></div>
              </dl>
            </div>
            <p className="text-[12px] text-secondary">Passwords and OTPs are never shown to staff. To restore access, guide the customer through <strong>Forgot password</strong> on the sign-in screen; a verification code is sent to their mobile number.</p>
          </motion.div>
        )}
      </div>
    </>
  );
}

function PiaConfiguration({ piaRate, onSave, onBack }) {
  const [draft, setDraft] = useState(String(piaRate));
  const [saved, setSaved] = useState(false);
  const save = () => { onSave(Math.max(0, parseFloat(draft) || 0)); setSaved(true); };

  return (
    <>
      <SubPageHeader title="PIA Compliance Configuration" onBack={onBack} />
      <div className="max-w-xl space-y-6 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <span className="material-symbols-outlined mt-0.5 text-[22px] text-amber-600" aria-hidden="true">gavel</span>
          <div>
            <p className="text-[13px] font-semibold text-amber-900">Regulatory Setting</p>
            <p className="mt-1 text-[12px] leading-relaxed text-amber-800">The Pensions and Insurance Authority sets a minimum motor premium as a percentage of the vehicle's declared value. Any insurer rate below it is raised to this floor when quoting.</p>
          </div>
        </div>
        <label className="block">
          <span className={labelClass}>PIA minimum rate (% of vehicle value, per year)</span>
          <div className="relative">
            <input type="number" min="0" step="0.1" value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} className={`${inputClass} pr-12 font-semibold`} />
            <span className="absolute right-4 top-3.5 text-[14px] font-bold text-secondary">%</span>
          </div>
          <span className="mt-1 block text-[12px] text-secondary">Current: {piaRate}% · e.g. ZMW {((250000 * piaRate) / 100).toLocaleString()} on a ZMW 250,000 vehicle</span>
        </label>
        <button type="button" onClick={save} className="w-full rounded-xl bg-primary py-4 font-bold text-white transition-all hover:bg-primary-container">Save PIA Configuration</button>
        {saved && <p className="text-center text-[12px] font-semibold text-primary">PIA configuration updated successfully.</p>}
      </div>
    </>
  );
}
