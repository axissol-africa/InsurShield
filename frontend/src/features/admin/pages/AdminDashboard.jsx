import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore, useActiveInsurers } from '@/store';
import { api } from '@/api';
import { hydrateAdmin } from '@/api/sync';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import Meta from '@/components/ui/Meta';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import InsurerOnboardingForm from '@/features/admin/components/InsurerOnboardingForm';
import { fieldClass as inputClass, labelClass } from '@/components/ui/field';
import UserManagement from '@/features/admin/components/UserManagement';
import InsurerTable from '@/features/admin/components/InsurerTable';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AWAITING_CERTIFICATE = 'Awaiting insurer certificate';


/**
 * Premium confirmed per month over the last twelve, from the records the
 * console actually holds. Months with no payments stay at zero rather than
 * being smoothed away — an empty platform should look empty.
 */
function premiumByMonth(policies) {
  const now = new Date();
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    return { key: `${date.getFullYear()}-${date.getMonth()}`, label: MONTHS[date.getMonth()], total: 0 };
  });
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const policy of policies) {
    const paidAt = policy.paymentProof?.confirmedAt || policy.receivedAt || policy.issuedAt;
    if (!paidAt) continue;
    const date = new Date(paidAt);
    const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (bucket) bucket.total += policy.premium || 0;
  }
  return buckets;
}

const SubPageHeader = ({ title, onBack, action }) => (
  <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="group flex h-9 w-9 shrink-0 items-center justify-center rounded-[1px] border border-line-strong bg-canvas transition-colors duration-200 ease-out hover:border-primary"
      >
        <span className="material-symbols-outlined text-[18px] text-ink-muted transition-transform duration-200 ease-out group-hover:-translate-x-0.5 group-hover:text-primary" aria-hidden="true">arrow_back</span>
      </button>
      <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-ink sm:whitespace-nowrap sm:text-[26px]">{title}</h2>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

const Page = ({ children }) => <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{children}</motion.div>;

const SIDEBAR_KEY = 'insurshield-admin-sidebar-collapsed';

/**
 * Remembers whether the console navigation is collapsed.
 *
 * A per-device convenience, so it belongs in localStorage rather than the
 * application store. Reads and writes are guarded: storage throws in a private
 * window and returns nothing once site data is cleared, in which case the
 * sidebar simply starts expanded.
 */
function useCollapsedSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggle = () =>
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        // A preference that cannot be saved is not worth failing over.
      }
      return next;
    });

  return [collapsed, toggle];
}

/**
 * Console navigation. Every administrative action is reachable from here
 * whatever view is open, rather than only from a panel on the overview.
 *
 * On desktop it is a sticky column that stays in place while a long table
 * scrolls, and collapses to icons when the content needs the width. On narrow
 * screens it becomes a horizontally scrolling rail, because a fixed column
 * would take the width the tables need. Icons come from the subsetted symbol
 * font in public/fonts.
 */
function AdminSidebar({ items, view, onSelect }) {
  const [collapsed, toggle] = useCollapsedSidebar();

  return (
    <nav
      aria-label="Admin sections"
      className={`no-scrollbar -mx-4 flex shrink-0 gap-2 overflow-x-auto border-b border-line px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:border-b-0 lg:border-r lg:px-0 lg:pb-0 ${
        collapsed ? 'lg:w-[68px] lg:pr-4' : 'lg:w-[236px] lg:pr-6'
      } lg:sticky lg:top-[104px] lg:max-h-[calc(100vh-128px)] lg:self-start lg:overflow-y-auto`}
    >
      {/* Desktop only: the mobile rail is already compact. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="admin-sections"
        className={`mb-3 hidden h-9 shrink-0 items-center gap-2 rounded-[1px] border border-dashed border-line-strong text-ink-muted transition-colors duration-200 ease-out hover:border-primary hover:text-primary lg:flex ${
          collapsed ? 'w-9 justify-center' : 'px-3'
        }`}
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
          {collapsed ? 'chevron_right' : 'menu'}
        </span>
        {!collapsed && <Meta>Collapse</Meta>}
        <span className="sr-only">{collapsed ? 'Expand navigation' : 'Collapse navigation'}</span>
      </button>

      <div id="admin-sections" className="flex gap-2 lg:flex-col lg:gap-0">
        {items.map((item) => {
          const active = item.matches.includes(view);
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              // Keeps the accessible name when only the icon is shown.
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
              onClick={() => onSelect(item.id)}
              className={`group flex shrink-0 items-center gap-3 rounded-[1px] border px-4 py-3 text-left transition-colors duration-200 ease-out lg:w-full lg:border-x-0 lg:border-t-0 lg:border-b lg:border-dashed lg:border-line lg:px-0 lg:py-4 ${
                collapsed ? 'lg:justify-center' : ''
              } ${
                active
                  ? 'border-primary bg-primary/[0.04] text-primary lg:border-b-line lg:bg-transparent'
                  : 'border-line-strong text-ink-muted hover:text-ink lg:border-line-strong/0'
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[1px] border transition-colors duration-200 ease-out ${
                  active ? 'border-primary bg-primary text-white' : 'border-dashed border-line-strong text-primary group-hover:border-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[19px]" aria-hidden="true">{item.icon}</span>
              </span>

              <span className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
                <span className={`block whitespace-nowrap text-[14px] font-medium tracking-[-0.01em] lg:whitespace-normal ${active ? 'text-primary' : 'text-ink'}`}>
                  {item.label}
                </span>
                {item.hint && <span className="mt-1 hidden truncate text-[12px] text-ink-faint lg:block">{item.hint}</span>}
              </span>

              {item.badge !== undefined && (
                <Meta className={`hidden shrink-0 rounded-[1px] border px-2 py-1 ${collapsed ? '' : 'lg:inline-flex'} ${active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-line-strong text-ink-faint'}`}>
                  {item.badge}
                </Meta>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Super-admin console: insurer onboarding and lifecycle, PIA floor, customer account lookup. */
export default function AdminDashboard() {
  const { insurersList, claims, piaConfig, staffSession, registeredAccounts, quoteRequests, policies } = useStore();

  useEffect(() => { void hydrateAdmin(); }, []);
  const activeInsurers = useActiveInsurers();
  const piaRate = piaConfig?.piaRatePercentage ?? 4;
  const agentName = staffSession?.name || 'Admin';
  const agentRole = staffSession?.role || 'admin';

  const [view, setView] = useState('dashboard');
  const [editingInsurer, setEditingInsurer] = useState(null);
  const [viewingInsurer, setViewingInsurer] = useState(null);
  // The insurer awaiting a delete confirmation, if any.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [view]);

  // Every figure below is counted from the records this console holds. An
  // empty platform reports zeros rather than plausible-looking estimates.
  const openClaims = claims.filter((claim) => claim.status === 'Notified').length;
  const activePolicies = policies.filter((policy) => policy.status === 'Active').length;
  const awaitingCertificate = policies.filter((policy) => policy.status === AWAITING_CERTIFICATE).length;
  const premiumTotal = policies.reduce((sum, policy) => sum + (policy.premium || 0), 0);
  const revenue = premiumByMonth(policies);
  const peakMonth = Math.max(...revenue.map((month) => month.total), 0);
  const recentPolicies = policies.slice(0, 6);

  const showInsurers = () => { setEditingInsurer(null); setViewingInsurer(null); setView('manage_insurers'); };
  const saveInsurer = async (insurer) => {
    if (editingInsurer) await api.insurers.update(editingInsurer.id, insurer);
    else await api.insurers.create(insurer);
    await hydrateAdmin();
    showInsurers();
  };
  // Removal is soft: the insurer stops receiving requests but its history
  // stays readable, per INSURER_API_INTEGRATION.md. The dialog says so, since
  // "delete" otherwise reads as destroying records.
  const confirmDelete = (insurer) => setPendingDelete(insurer);
  const runDelete = async () => {
    await api.insurers.remove(pendingDelete.id);
    await hydrateAdmin();
    setPendingDelete(null);
    setShowDeleted(true);
  };
  const restoreInsurer = async (insurer) => {
    await api.insurers.setStatus(insurer.id, 'Active');
    await hydrateAdmin();
  };

  const sidebarItems = [
    { id: 'dashboard', label: 'Overview', icon: 'dashboard', hint: 'Platform totals', matches: ['dashboard'] },
    { id: 'manage_insurers', label: 'Insurers', icon: 'manage_accounts', hint: 'View and edit', badge: insurersList.length, matches: ['manage_insurers', 'view_insurer', 'edit_insurer'] },
    { id: 'add_insurer', label: 'Onboard insurer', icon: 'domain_add', hint: 'Add a provider', matches: ['add_insurer'] },
    { id: 'pia_config', label: 'PIA rate', icon: 'gavel', hint: `Floor ${piaRate}%`, matches: ['pia_config'] },
    { id: 'find_account', label: 'Find customer', icon: 'support_agent', hint: 'Account lookup', matches: ['find_account'] },
    { id: 'users', label: 'Users', icon: 'person', hint: 'Staff and customers', matches: ['users'] },
  ];

  const selectSection = (id) => {
    // Onboarding always starts a new insurer rather than resuming an edit.
    if (id === 'add_insurer') setEditingInsurer(null);
    if (id !== 'view_insurer') setViewingInsurer(null);
    setView(id);
  };

  let content;

  if (view === 'view_insurer' && viewingInsurer) {
    content = <InsurerProfile insurer={viewingInsurer} onBack={showInsurers} />;
  } else if (view === 'add_insurer' || view === 'edit_insurer') {
    content = (
      <>
        <SubPageHeader title={editingInsurer ? `Edit ${editingInsurer.name}` : 'Onboard an insurance company'} onBack={showInsurers} />
        <div className="max-w-5xl border border-line p-8">
          <p className="mb-7 text-[13px] leading-[1.6] text-ink-muted">
            {editingInsurer ? 'Edit the insurer details below. Its current status and existing records will be kept.' : 'Active companies receive every eligible quote request. Deactivated companies keep their historical records but receive no new requests.'}
          </p>
          <InsurerOnboardingForm insurer={editingInsurer} piaRatePercentage={piaRate} onSubmit={saveInsurer} onCancel={showInsurers} />
        </div>
      </>
    );
  } else if (view === 'manage_insurers') {
    const removed = insurersList.filter((insurer) => insurer.status === 'Deleted');
    const visibleInsurers = showDeleted ? insurersList : insurersList.filter((insurer) => insurer.status !== 'Deleted');
    const addButton = (
      <button type="button" onClick={() => { setEditingInsurer(null); setView('add_insurer'); }} className="group relative inline-flex min-h-[44px] items-center gap-2 overflow-hidden whitespace-nowrap rounded-[1px] bg-primary px-5 text-[14px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">
        <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
        <span className="material-symbols-outlined relative text-[18px]" aria-hidden="true">add</span><span className="relative">Add insurer</span>
      </button>
    );
    content = (
      <>
        <SubPageHeader title="Manage insurers" onBack={() => setView('dashboard')} action={addButton} />
        {removed.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-dashed border-line-strong px-5 py-4">
            <p className="text-[13px] text-ink-muted">
              {removed.length} removed {removed.length === 1 ? 'insurer is' : 'insurers are'} hidden.
              Their quotes, policies and claims are kept.
            </p>
            <button
              type="button"
              onClick={() => setShowDeleted((current) => !current)}
              className="font-mono text-[11px] uppercase tracking-[0.1em] text-primary underline-offset-4 hover:underline"
            >
              {showDeleted ? 'Hide removed' : 'Show removed'}
            </button>
          </div>
        )}
        <InsurerTable
          insurers={visibleInsurers}
          onRestore={restoreInsurer}
          piaRatePercentage={piaRate}
          onView={(insurer) => { setViewingInsurer(insurer); setView('view_insurer'); }}
          onEdit={(insurer) => { setEditingInsurer(insurer); setView('edit_insurer'); }}
          onRateChange={async (id, ratePercentage) => { await api.insurers.update(id, { ratePercentage }); await hydrateAdmin(); }}
          onStatusChange={async (id, status) => { await api.insurers.setStatus(id, status); await hydrateAdmin(); }}
          onDelete={confirmDelete}
        />
      </>
    );
  } else if (view === 'find_account') {
    content = <FindCustomerAccount accounts={registeredAccounts} quoteRequests={quoteRequests} policies={policies} onBack={() => setView('dashboard')} />;
  } else if (view === 'users') {
    content = (
      <Page>
        <SubPageHeader title="Users" onBack={() => setView('dashboard')} />
        <UserManagement insurers={insurersList} />
      </Page>
    );
  } else if (view === 'pia_config') {
    content = <PiaConfiguration piaRate={piaRate} onSave={async (rate) => { await api.config.setPia({ piaRatePercentage: rate }); await hydrateAdmin(); }} onBack={() => setView('dashboard')} />;
  } else {
    content = renderOverview();
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
      <AdminSidebar items={sidebarItems} view={view} onSelect={selectSection} />
      <div className="min-w-0 flex-1">
        <Page key={view}>{content}</Page>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        destructive
        title={`Remove ${pendingDelete?.name ?? ''}?`}
        description="This insurer stops receiving quote requests immediately. Nothing already in the system is destroyed."
        consequences={[
          { text: 'No new quote requests are sent to this insurer.' },
          { text: 'Its portal login stops resolving to an active insurer.' },
          { text: 'Existing quotes, policies and claims stay readable.', kept: true },
          { text: 'You can restore the insurer from this list afterwards.', kept: true },
        ]}
        confirmLabel="Remove insurer"
        cancelLabel="Keep it"
        onConfirm={runDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );

  function renderOverview() {

  const kpis = [
    { label: 'Policies', value: policies.length, icon: 'policy', note: `${activePolicies} active` },
    { label: 'Awaiting certificate', value: awaitingCertificate, icon: 'verified_user', note: awaitingCertificate ? 'Insurer action due' : 'None outstanding', alert: awaitingCertificate > 0 },
    { label: 'Insurers receiving requests', value: activeInsurers.length, icon: 'business', note: `${insurersList.length - activeInsurers.length} inactive or removed` },
    { label: 'Claims open', value: openClaims, icon: 'report_problem', note: `${claims.length} notified in total`, alert: openClaims > 0 },
  ];
  const operations = [
    { label: 'Claims awaiting acknowledgement', value: openClaims, icon: 'policy' },
    { label: 'Quote requests in flight', value: quoteRequests.length, icon: 'send' },
    { label: 'Registered customers', value: registeredAccounts.length, icon: 'person' },
    { label: 'PIA minimum rate', value: `${piaRate}%`, icon: 'gavel', view: 'pia_config' },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* ── Who is signed in, and when ──────────────────────────── */}
      <section className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-7">
        <div>
          <span className="inline-flex items-center gap-3">
            <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
            <Meta className="text-ink-muted">Admin console</Meta>
          </span>
          <h1 className="mt-5 text-[32px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[40px]">
            InsurShield platform
          </h1>
          <Meta className="mt-4 block text-ink-faint">
            {new Date().toLocaleDateString('en-ZM', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </Meta>
        </div>
        <div className="flex items-center gap-3 rounded-[1px] border border-dashed border-line-strong px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-[1px] bg-primary">
            <span className="material-symbols-outlined text-[16px] text-white" aria-hidden="true">person</span>
          </span>
          <div>
            <p className="whitespace-nowrap text-[14px] font-medium text-ink">{agentName}</p>
            <Meta className="mt-1 block text-ink-faint">{agentRole}</Meta>
          </div>
        </div>
      </section>

      {/* ── Counts ──────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 border-b border-line lg:grid-cols-4">
        {kpis.map((kpi, index) => (
          <div
            key={kpi.label}
            className={`border-line py-7 pr-5 ${index % 2 === 1 ? 'border-l pl-5' : ''} ${index < 2 ? 'border-b lg:border-b-0' : ''} lg:border-l lg:pl-6 ${index === 0 ? 'lg:border-l-0 lg:pl-0' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="material-symbols-outlined text-[19px] text-primary" aria-hidden="true">{kpi.icon}</span>
              {kpi.alert && (
                <Meta className="rounded-[1px] border border-primary/30 bg-primary/10 px-2 py-1 text-primary">Action</Meta>
              )}
            </div>
            <p className="mt-5 text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink">
              {kpi.value.toLocaleString()}
            </p>
            <p className="mt-3 text-[13px] leading-[1.4] text-ink">{kpi.label}</p>
            <Meta className="mt-2 block text-ink-faint">{kpi.note}</Meta>
          </div>
        ))}
      </section>

      {/* ── Premium and operations ──────────────────────────────── */}
      <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="border border-line p-6 lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-dashed border-line pb-4">
            <div>
              <Meta className="text-primary">Premium confirmed</Meta>
              <p className="mt-3 text-[13px] text-ink-muted">Last 12 months, from confirmed payments only</p>
            </div>
            <p className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{formatZMW(premiumTotal)}</p>
          </div>

          {peakMonth === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 border border-dashed border-line-strong">
              <span className="material-symbols-outlined text-[28px] text-line-strong" aria-hidden="true">receipt_long</span>
              <p className="text-[13px] text-ink-muted">No confirmed payments yet.</p>
            </div>
          ) : (
            <>
              <div className="mt-8 flex h-40 items-end gap-2">
                {revenue.map((month) => (
                  <div key={month.key} className="group relative flex h-full flex-1 flex-col justify-end">
                    <span className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[1px] bg-ink px-2 py-1 font-mono text-[10px] text-white opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100">
                      {formatZMW(month.total)}
                    </span>
                    <span
                      className={`block w-full transition-colors duration-200 ease-out ${month.total > 0 ? 'bg-primary' : 'bg-line'}`}
                      style={{ height: `${Math.max((month.total / peakMonth) * 100, month.total > 0 ? 4 : 1)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 hidden gap-2 sm:flex">
                {revenue.map((month) => (
                  <Meta key={month.key} className="min-w-0 flex-1 truncate text-center text-ink-faint">{month.label}</Meta>
                ))}
              </div>
              {/* Twelve labels will not fit a phone, so the span is named instead. */}
              <div className="mt-3 flex justify-between sm:hidden">
                <Meta className="text-ink-faint">{revenue[0].label}</Meta>
                <Meta className="text-ink-faint">{revenue[revenue.length - 1].label}</Meta>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col border border-line p-6">
          <Meta className="text-primary">Operations</Meta>
          <div className="mt-5 flex-1">
            {operations.map((item, index) => (
              <button
                key={item.label}
                type="button"
                onClick={() => item.view && setView(item.view)}
                disabled={!item.view}
                className={`flex w-full items-center justify-between gap-3 py-4 text-left transition-colors duration-200 ease-out enabled:hover:text-primary disabled:cursor-default ${index === 0 ? '' : 'border-t border-dashed border-line'}`}
              >
                <span className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[19px] text-primary" aria-hidden="true">{item.icon}</span>
                  <span className="text-[13px] leading-[1.35] text-ink">{item.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[16px] font-medium text-ink">{item.value}</span>
                  {item.view && <span className="material-symbols-outlined text-[15px] text-ink-faint" aria-hidden="true">chevron_right</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Recent activity. Management actions live in the sidebar. ── */}
      <section className="mt-10">
        <div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Meta className="text-primary">Recent policies</Meta>
              <span className="h-px w-12 bg-line" aria-hidden="true" />
            </div>
            <Meta className="text-ink-faint">{policies.length} total</Meta>
          </div>
          <div className="mt-5 border border-line">
            {recentPolicies.length === 0 ? (
              <p className="p-10 text-center text-[13px] text-ink-muted">No policies issued yet.</p>
            ) : (
              recentPolicies.map((policy, index) => (
                <div
                  key={policy.policyNumber}
                  className={`flex flex-col gap-4 p-5 transition-colors duration-200 ease-out hover:bg-canvas-2 sm:flex-row sm:items-center sm:justify-between ${index === 0 ? '' : 'border-t border-dashed border-line'}`}
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1px] border border-dashed border-line-strong text-primary">
                      <span className="material-symbols-outlined text-[19px]" aria-hidden="true">directions_car</span>
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">{policy.customerName || 'Customer'}</p>
                      <Meta className="mt-1.5 block truncate text-primary">{policy.policyNumber}</Meta>
                      <p className="mt-1 truncate text-[12px] text-ink-muted">{policy.vehicle} · {policy.insurer}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:block sm:text-right">
                    <p className="text-[15px] font-medium text-ink">{formatZMW(policy.premium || 0)}</p>
                    <Meta className={`inline-block rounded-[1px] border px-2 py-1 sm:mt-2 ${policy.status === 'Active' ? 'border-line-strong text-ink-muted' : 'border-primary/30 bg-primary/10 text-primary'}`}>
                      {policy.status}
                    </Meta>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </motion.div>
  );
}
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
      <section className="max-w-5xl border border-line">
        <div className="flex flex-col gap-4 border-b border-dashed border-line p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[1px] border border-dashed border-line-strong bg-canvas">
              {insurer.logoUrl ? <img src={insurer.logoUrl} alt={`${insurer.name} logo`} className="max-h-10 max-w-10 object-contain" /> : <span className="material-symbols-outlined text-[27px] text-primary" aria-hidden="true">business</span>}
            </span>
            <div><h3 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">{insurer.name}</h3><p className="mt-1.5 text-[13px] text-ink-muted">Read-only company profile</p></div>
          </div>
          <Badge variant={(insurer.status || 'Active') === 'Active' ? 'default' : 'muted'} className="w-fit">{insurer.status || 'Active'}</Badge>
        </div>
        <dl className="grid gap-x-8 gap-y-6 p-6 sm:grid-cols-2 xl:grid-cols-3">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">{label}</dt>
              <dd className="mt-2 break-words text-[14px] leading-[1.4] text-ink">{value || <span className="text-ink-faint">Not recorded</span>}</dd>
            </div>
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
      <SubPageHeader title="Find a customer account" onBack={onBack} />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start">
        <div className="border border-line p-8">
        <form onSubmit={search} className="space-y-4">
          <label className="block"><span className={labelClass}>Customer email or mobile number</span><input required value={query} onChange={(event) => setQuery(event.target.value)} className={inputClass} placeholder="name@email.com or 0970 123 456" /></label>
          <button type="submit" className="group relative flex min-h-[48px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]"><span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" /><span className="material-symbols-outlined relative text-[18px]" aria-hidden="true">search</span><span className="relative">Find account</span></button>
        </form>
        <p className="mt-5 text-[12px] leading-[1.55] text-ink-muted">
          Passwords and one-time codes are never shown to staff. To restore access, guide the
          customer through <span className="text-ink">Forgot password</span> on the sign-in screen.
        </p>
        </div>

        <div className="border border-dashed border-line-strong p-8">
        {!result && (
          <p className="text-[13px] leading-[1.55] text-ink-muted">
            Search by the exact email address or mobile number the customer registered with.
            Results appear here.
          </p>
        )}
        {result?.notFound && <p className="text-[13px] leading-[1.55] text-ink-muted">No account matches those details. Ask the customer to register, or check the spelling of the email address.</p>}
        {result?.account && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="flex items-center gap-2.5 text-primary">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">check_circle</span>
              <Meta>Account found</Meta>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5 xl:grid-cols-3">
              <div><dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">Name</dt><dd className="mt-2 text-[14px] text-ink">{result.account.fullName}</dd></div>
              <div><dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">Mobile</dt><dd className="mt-2 text-[14px] text-ink">{result.account.phone}</dd></div>
              <div className="col-span-2 xl:col-span-1"><dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">Email</dt><dd className="mt-2 break-words text-[14px] text-ink">{result.account.email}</dd></div>
              <div><dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">Quote requests</dt><dd className="mt-2 text-[14px] text-ink">{result.requests}</dd></div>
              <div><dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">Policies</dt><dd className="mt-2 text-[14px] text-ink">{result.policies}</dd></div>
            </dl>
          </motion.div>
        )}
        </div>
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
      <SubPageHeader title="PIA compliance configuration" onBack={onBack} />
      {/* The setting on the left, what it means on the right. */}
      <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,420px)_1fr] lg:items-start">
        <div className="space-y-6 border border-line p-8">
        <label className="block">
          <span className={labelClass}>PIA minimum rate (% of vehicle value, per year)</span>
          <div className="relative">
            <input type="number" min="0" step="0.1" value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} className={`${inputClass} pr-12 font-semibold`} />
            <span className="absolute right-4 top-3.5 text-[14px] font-bold text-ink-muted">%</span>
          </div>
          <span className="mt-1 block text-[12px] text-ink-muted">Current: {piaRate}% · e.g. ZMW {((250000 * piaRate) / 100).toLocaleString()} on a ZMW 250,000 vehicle</span>
        </label>
        <button type="button" onClick={save} className="group relative flex min-h-[50px] w-full items-center justify-center overflow-hidden rounded-[1px] bg-primary text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]"><span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" /><span className="relative">Save PIA configuration</span></button>
        {saved && <p className="text-center text-[13px] text-primary">PIA configuration updated.</p>}
        </div>

        <aside className="space-y-6 border border-dashed border-line-strong p-8">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-[22px] text-primary" aria-hidden="true">gavel</span>
            <div>
              <Meta className="text-ink-muted">Regulatory setting</Meta>
              <p className="mt-3 text-[13px] leading-[1.6] text-ink-muted">
                The Pensions and Insurance Authority sets a minimum motor premium as a percentage
                of the vehicle's declared value. Any insurer rate below it is raised to this floor
                when quoting.
              </p>
            </div>
          </div>

          <div className="border-t border-dashed border-line pt-6">
            <Meta className="text-ink-faint">What the floor costs at this rate</Meta>
            <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5">
              {[150000, 250000, 400000, 650000].map((value) => (
                <div key={value}>
                  <dt className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-ink-faint">
                    ZMW {value.toLocaleString()}
                  </dt>
                  <dd className="mt-2 text-[14px] text-ink">
                    ZMW {((value * (parseFloat(draft) || 0)) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-[12px] leading-[1.5] text-ink-faint">
              Annual premium floor for a vehicle at each declared value.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
