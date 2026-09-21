import { useState } from 'react';
import { useStore } from '../store/useStore';
import { motion } from 'framer-motion';
import { formatZMW, formatDate } from '../utils/premiumEngine';
import InsurerOnboardingForm from '../components/InsurerOnboardingForm';

const MOCK_POLICIES = [
  { id: 'POL-001', client: 'Mwiza Banda', vehicle: '2020 Toyota Hilux', insurer: 'Prestige Assurance', premium: 8000, status: 'Active' },
  { id: 'POL-002', client: 'Chanda Phiri', vehicle: '2022 BMW X5', insurer: 'Global Guard', premium: 23975, status: 'Active' },
  { id: 'POL-003', client: 'Thandiwe Zulu', vehicle: '2019 Nissan Navara', insurer: 'ValueDirect', premium: 4800, status: 'Expiring Soon' },
];

const SubPageHeader = ({ title, onBack }) => (
  <div className="flex items-center gap-3 mb-8">
    <button type="button" onClick={onBack} aria-label="Back"
      className="w-9 h-9 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center hover:bg-gray-50 transition-colors">
      <span className="material-symbols-outlined text-[20px] text-secondary" aria-hidden="true">arrow_back</span>
    </button>
    <h2 className="text-[22px] font-bold text-primary">{title}</h2>
  </div>
);

export default function AdminDashboard() {
  const { insurersList, addInsurer, updateInsurerRate, claims, piaConfig, setPiaConfig, staffSession, registeredAccounts, quoteRequests, policies } = useStore();
  const loginRole = staffSession?.role || 'admin';
  const agentName = staffSession?.name || 'Admin';
  const [activeView, setActiveView] = useState('dashboard');

  const [accountQuery, setAccountQuery] = useState('');
  const [accountResult, setAccountResult] = useState(null);
  const [editingRate, setEditingRate] = useState(null);
  const [editRateValue, setEditRateValue] = useState('');
  const [piaRateEdit, setPiaRateEdit] = useState(String(piaConfig?.piaRatePercentage ?? 4));
  const [piaSaved, setPiaSaved] = useState(false);

  const totalRevenue = MOCK_POLICIES.reduce((sum, p) => sum + p.premium, 0);
  const openClaims = claims.filter(c => !['Settled', 'Rejected'].includes(c.status)).length;

  const handleFindAccount = (e) => {
    e.preventDefault();
    const query = accountQuery.trim().toLowerCase();
    if (!query) return;
    const account = registeredAccounts.find(item => item.email.toLowerCase() === query || item.phone === query);
    const requests = account ? quoteRequests.filter(item => item.customer?.email === account.email || item.customer?.phone === account.phone) : [];
    const heldPolicies = account ? policies.filter(item => item.customerEmail === account.email || item.customerPhone === account.phone) : [];
    setAccountResult(account ? { account, requests, policies: heldPolicies } : { notFound: true });
  };

  const handleAddInsurer = (insurer) => {
    addInsurer(insurer);
    setActiveView('manage_insurers');
  };

  const handleSaveRate = (insurerId) => {
    if (editRateValue) {
      updateInsurerRate(insurerId, { ratePercentage: parseFloat(editRateValue) });
      setEditingRate(null);
      setEditRateValue('');
    }
  };

  const handleSavePIA = () => {
    setPiaConfig({ piaRatePercentage: Math.max(0, parseFloat(piaRateEdit) || 0), lastUpdated: new Date().toISOString().split('T')[0], updatedBy: agentName });
    setPiaSaved(true);
  };

  // ─── Add Insurer ───────────────────────────────────────────
  if (activeView === 'add_insurer') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <SubPageHeader title="Onboard an insurance company" onBack={() => setActiveView('manage_insurers')} />
        <div className="max-w-3xl rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
          <p className="mb-6 text-[13px] text-secondary">Once onboarded, the company receives every eligible quote request, appears in the insurer directory, and can respond from the insurer portal. Licence details are shown to InsurShield staff only.</p>
          <InsurerOnboardingForm piaRatePercentage={piaConfig?.piaRatePercentage ?? 4} onSubmit={handleAddInsurer} onCancel={() => setActiveView('manage_insurers')} />
        </div>
      </motion.div>
    );
  }

  // ─── Find customer account ─────────────────────────────────
  if (activeView === 'recover_link') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <SubPageHeader title="Find Customer Account" onBack={() => setActiveView('dashboard')} />
        <div className="max-w-xl bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
          <form onSubmit={handleFindAccount} className="space-y-4">
            <div>
              <label className="text-[12px] font-bold uppercase tracking-wider text-secondary mb-1.5 block">Customer email or mobile number</label>
              <input required value={accountQuery} onChange={e => setAccountQuery(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-[16px] outline-none focus:ring-2 focus:ring-primary"
                placeholder="name@email.com or 0970 123 456" />
            </div>
            <button type="submit" className="w-full bg-primary text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-[18px]">search</span> Find account
            </button>
          </form>
          {accountResult?.notFound && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-[13px] text-amber-900">No account matches those details. Ask the customer to register, or check the spelling of the email address.</p>}
          {accountResult?.account && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-4">
              <div className="rounded-xl border border-outline-variant bg-surface-container-low p-5">
                <div className="flex items-center gap-2 text-primary font-bold"><span className="material-symbols-outlined text-[18px]">check_circle</span> Account found</div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                  <div><dt className="text-[10px] uppercase font-bold text-secondary">Name</dt><dd className="font-semibold">{accountResult.account.fullName}</dd></div>
                  <div><dt className="text-[10px] uppercase font-bold text-secondary">Mobile</dt><dd className="font-semibold">{accountResult.account.phone}</dd></div>
                  <div className="col-span-2"><dt className="text-[10px] uppercase font-bold text-secondary">Email</dt><dd className="font-semibold">{accountResult.account.email}</dd></div>
                  <div><dt className="text-[10px] uppercase font-bold text-secondary">Quote requests</dt><dd className="font-semibold">{accountResult.requests.length}</dd></div>
                  <div><dt className="text-[10px] uppercase font-bold text-secondary">Policies</dt><dd className="font-semibold">{accountResult.policies.length}</dd></div>
                </dl>
              </div>
              <p className="text-[12px] text-secondary">Passwords and OTPs are never shown to staff. To restore access, guide the customer through <strong>Forgot password</strong> on the sign-in screen; a verification code is sent to their mobile number.</p>
            </motion.div>
          )}
        </div>
      </motion.div>
    );
  }

  if (activeView === 'manage_insurers') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setActiveView('dashboard')}
              className="w-9 h-9 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center hover:bg-gray-50 transition-colors">
              <span className="material-symbols-outlined text-[20px] text-secondary">arrow_back</span>
            </button>
            <h2 className="text-[22px] font-bold text-primary">Manage Insurers</h2>
          </div>
          <button onClick={() => setActiveView('add_insurer')}
            className="bg-primary text-white font-semibold px-4 py-2.5 rounded-xl flex items-center gap-2 hover:bg-primary-container transition-colors text-[14px]">
            <span className="material-symbols-outlined text-[18px]">add</span> Add Insurer
          </button>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="hidden md:grid grid-cols-5 px-5 py-3 bg-gray-50 border-b border-gray-100 font-bold text-[11px] text-secondary uppercase tracking-wider">
            <div>Company</div><div>Licence</div><div>Rate %</div><div>Effective rate</div><div className="text-right">Status</div>
          </div>
          <div className="divide-y divide-gray-50">
            {insurersList.map(insurer => (
              <div key={insurer.id} className="px-5 py-4 grid grid-cols-1 md:grid-cols-5 gap-2 md:gap-0 items-center hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-100 bg-white">{insurer.logoUrl ? <img src={insurer.logoUrl} alt="" className="max-h-7 max-w-7 object-contain" /> : <span className="material-symbols-outlined text-[18px] text-primary">{insurer.icon || 'business'}</span>}</span>
                  <div><div className="font-semibold text-primary text-[14px]">{insurer.name}</div><div className="text-[11px] text-secondary">{insurer.coverage || '—'} · quotes valid {insurer.quoteValidityDays || 5} days</div></div>
                </div>
                <div className="text-[13px] text-secondary">{insurer.licenceNumber ? <>{insurer.licenceNumber}<span className="block text-[11px]">expires {formatDate(insurer.licenceExpiry)}</span></> : <span className="text-amber-700">Licence not recorded</span>}</div>
                <div>
                  {editingRate === insurer.id ? (
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.1" value={editRateValue} onChange={e => setEditRateValue(e.target.value)}
                        className="w-20 border border-outline-variant rounded-lg p-1.5 text-[13px] outline-none focus:ring-1 focus:ring-primary" />
                      <button onClick={() => handleSaveRate(insurer.id)} className="text-primary"><span className="material-symbols-outlined text-[18px]">check</span></button>
                      <button onClick={() => setEditingRate(null)} className="text-red-500"><span className="material-symbols-outlined text-[18px]">close</span></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-primary text-[14px]">{insurer.ratePercentage}%</span>
                      <button onClick={() => { setEditingRate(insurer.id); setEditRateValue(String(insurer.ratePercentage)); }}
                        className="text-secondary hover:text-primary transition-colors">
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-[13px] text-on-surface">{Math.max(insurer.ratePercentage, piaConfig?.piaRatePercentage ?? 4)}%{insurer.ratePercentage < (piaConfig?.piaRatePercentage ?? 4) && <span className="ml-1 text-[11px] font-bold text-amber-700">PIA floor</span>}</div>
                <div className="md:text-right">
                  <span className={`inline-flex px-3 py-1 rounded-full text-[11px] font-bold uppercase ${insurer.status === 'Active' ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-600'}`}>
                    {insurer.status || 'Active'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    );
  }

  // ─── PIA Config ────────────────────────────────────────────
  if (activeView === 'pia_config') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <SubPageHeader title="PIA Compliance Configuration" onBack={() => setActiveView('dashboard')} />
        <div className="max-w-xl bg-white rounded-2xl border border-gray-100 shadow-sm p-8 space-y-6">
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-600 text-[22px] mt-0.5">gavel</span>
            <div>
              <p className="text-[13px] text-amber-900 font-semibold">Regulatory Setting</p>
              <p className="text-[12px] text-amber-800 mt-1 leading-relaxed">
                The Pensions and Insurance Authority sets a minimum motor premium as a percentage of the vehicle's declared value. Any insurer rate below it is raised to this floor when quoting.
              </p>
            </div>
          </div>
          <div>
            <label className="text-[12px] font-bold uppercase tracking-wider text-secondary mb-1.5 block">PIA minimum rate (% of vehicle value, per year)</label>
            <div className="relative">
              <input type="number" min="0" step="0.1" value={piaRateEdit} onChange={e => setPiaRateEdit(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded-xl pl-4 pr-12 py-3 text-[16px] font-semibold focus:ring-2 focus:ring-primary outline-none" />
              <span className="absolute right-4 top-3.5 text-secondary font-bold text-[14px]">%</span>
            </div>
            <p className="text-[12px] text-secondary mt-1">Current: {piaConfig?.piaRatePercentage ?? 4}% · e.g. ZMW {((250000 * (piaConfig?.piaRatePercentage ?? 4)) / 100).toLocaleString()} on a ZMW 250,000 vehicle</p>
          </div>
          <button onClick={handleSavePIA} className="w-full bg-primary text-white font-bold py-4 rounded-xl hover:bg-primary-container transition-all">
            Save PIA Configuration
          </button>
          {piaSaved && <p className="text-center text-[12px] font-semibold text-primary">PIA configuration updated successfully.</p>}
        </div>
      </motion.div>
    );
  }

  // ─── Main Dashboard ────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">

      {/* Page Title */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-bold tracking-widest text-secondary uppercase mb-1">Admin Overview</p>
          <h1 className="text-[30px] font-bold text-primary leading-tight">InsurShield Dashboard</h1>
          <p className="text-secondary text-[14px] mt-0.5">
            {new Date().toLocaleDateString('en-ZM', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-4 py-2.5 shadow-sm">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>person</span>
          </div>
          <div>
            <p className="text-[12px] font-bold text-primary leading-tight">{agentName}</p>
            <p className="text-[10px] text-secondary capitalize">{loginRole}</p>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Policies', value: MOCK_POLICIES.length + 1281, icon: 'policy', change: '+12% vs last month', highlight: false },
          { label: 'Active Policies', value: MOCK_POLICIES.filter(p => p.status === 'Active').length + 1250, icon: 'verified_user', change: '+8% vs last month', highlight: true },
          { label: 'Active Insurers', value: insurersList.length, icon: 'business', change: 'Manage anytime', highlight: false },
          { label: 'Claims Pending', value: openClaims + 89, icon: 'report_problem', change: '+5 new today', alert: true, highlight: false },
        ].map((kpi, i) => (
          <div key={i} className={`rounded-2xl p-5 shadow-sm flex flex-col justify-between gap-4 ${kpi.highlight ? 'bg-primary text-white' : 'bg-white border border-gray-100'}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${kpi.highlight ? 'bg-white/20' : 'bg-primary/10'}`}>
              <span className={`material-symbols-outlined text-[22px] ${kpi.highlight ? 'text-white' : 'text-primary'}`}>{kpi.icon}</span>
            </div>
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${kpi.highlight ? 'text-white/70' : 'text-secondary'}`}>{kpi.label}</p>
              <p className={`text-[28px] font-extrabold leading-none ${kpi.highlight ? 'text-white' : 'text-primary'}`}>{kpi.value.toLocaleString()}</p>
              <p className={`text-[11px] font-semibold mt-1 ${kpi.alert ? 'text-error' : kpi.highlight ? 'text-white/60' : 'text-primary'}`}>{kpi.change}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Revenue Chart + Operations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Bar Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-[17px] font-bold text-primary">Premium Revenue</h3>
              <p className="text-[12px] text-secondary">Monthly collection (ZMW)</p>
            </div>
            <span className="bg-primary/10 text-primary text-[12px] font-bold px-3 py-1.5 rounded-xl">{formatZMW(totalRevenue + 1250000)}</span>
          </div>
          <div className="relative h-32 flex items-end gap-1.5">
            {[40, 55, 45, 70, 65, 90, 80, 75, 100, 85, 95, 88].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-md group relative cursor-pointer"
                style={{ height: `${h}%`, backgroundColor: `hsl(0, 72%, ${55 - h * 0.18}%)`, opacity: i === 11 ? 1 : 0.45 + i * 0.04 }}>
                <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[9px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                  ZMW {(h * 12500).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2.5 text-[10px] font-bold text-secondary uppercase">
            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m => <span key={m}>{m}</span>)}
          </div>
        </div>

        {/* Operations Summary */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
          <h3 className="text-[17px] font-bold text-primary mb-4">Operations</h3>
          <div className="space-y-1 flex-1">
            {[
              { label: 'Claims Under Review', value: openClaims + 12, icon: 'policy', color: 'text-amber-600', view: null },
              { label: 'Policies Expiring (30d)', value: 18, icon: 'event_repeat', color: 'text-orange-600', view: null },
              { label: 'PIA minimum rate', value: `${piaConfig?.piaRatePercentage ?? 4}% of value`, icon: 'gavel', color: 'text-primary', view: 'pia_config' },
            ].map((item, i) => (
              <button key={i} onClick={() => item.view && setActiveView(item.view)}
                className={`w-full flex items-center justify-between py-3 border-b border-gray-50 last:border-0 text-left transition-colors rounded-lg px-1 -mx-1 ${item.view ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}>
                <div className="flex items-center gap-2.5">
                  <span className={`material-symbols-outlined ${item.color} text-[20px]`}>{item.icon}</span>
                  <span className="text-[13px] text-on-surface">{item.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="font-bold text-[14px] text-primary">{item.value}</span>
                  {item.view && <span className="material-symbols-outlined text-[14px] text-secondary">chevron_right</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions + Recent Policies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Management */}
        <div>
          <h3 className="text-[17px] font-bold text-primary mb-4">Quick Management</h3>
          <div className="space-y-2.5">
            {[
              { label: 'Manage Insurers', sub: `${insurersList.length} active partners`, icon: 'manage_accounts', view: 'manage_insurers', accent: false },
              { label: 'Onboard New Insurer', sub: 'Add provider & configure rates', icon: 'domain_add', view: 'add_insurer', accent: false },
              { label: 'PIA Rate Configuration', sub: `Floor: ${piaConfig?.piaRatePercentage ?? 4}% of vehicle value`, icon: 'gavel', view: 'pia_config', accent: false },
              { label: 'Find Customer Account', sub: 'Assist customers with account access', icon: 'support_agent', view: 'recover_link', accent: false },
            ].map(action => (
              <button key={action.view} onClick={() => setActiveView(action.view)}
                className={`w-full flex items-center justify-between p-4 rounded-xl border active:scale-[0.98] transition-all text-left ${
                  action.accent ? 'bg-primary border-primary text-white shadow-md shadow-primary/20' : 'bg-white border-gray-100 hover:bg-gray-50 hover:border-gray-200'
                }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${action.accent ? 'bg-white/20' : 'bg-primary/10'}`}>
                    <span className={`material-symbols-outlined ${action.accent ? 'text-white' : 'text-primary'} text-[22px]`}>{action.icon}</span>
                  </div>
                  <div>
                    <p className={`font-semibold text-[14px] ${action.accent ? 'text-white' : 'text-primary'}`}>{action.label}</p>
                    <p className={`text-[12px] ${action.accent ? 'text-white/75' : 'text-secondary'}`}>{action.sub}</p>
                  </div>
                </div>
                <span className={`material-symbols-outlined text-[20px] ${action.accent ? 'text-white/70' : 'text-secondary'}`}>chevron_right</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Policies */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm flex flex-col">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-[17px] font-bold text-primary">Recent Policies</h3>
            <button className="text-[12px] font-bold text-primary uppercase tracking-wider hover:opacity-70 transition-opacity">View All</button>
          </div>
          <div className="divide-y divide-gray-50 flex-1">
            {MOCK_POLICIES.map(policy => (
              <div key={policy.id} className="px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-primary text-[18px]">directions_car</span>
                  </div>
                  <div>
                    <p className="font-semibold text-[14px] text-primary">{policy.client}</p>
                    <p className="text-[12px] text-secondary">{policy.vehicle}</p>
                    <p className="text-[11px] text-secondary">{policy.insurer}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-[14px] text-primary">{formatZMW(policy.premium)}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${policy.status === 'Active' ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-800'}`}>
                    {policy.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-[12px] text-secondary">Showing {MOCK_POLICIES.length} of 1,284 policies</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
