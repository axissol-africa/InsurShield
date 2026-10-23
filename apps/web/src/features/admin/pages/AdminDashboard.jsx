import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, ChevronLeft, ChevronsLeft, ChevronsRight, CircleDollarSign, FileCheck2, Gavel, Plus, ShieldAlert, ShieldCheck, UsersRound } from 'lucide-react';
import { useStore, useActiveInsurers } from '@/store';
import { api } from '@/api';
import { hydrateAdmin } from '@/api/sync';
import { formatZMW, formatDate } from '@/domain/premiumEngine';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import InsurerOnboardingForm from '@/features/admin/components/InsurerOnboardingForm';
import { fieldClass as inputClass, labelClass } from '@/components/ui/field';
import UserManagement from '@/features/admin/components/UserManagement';
import InsurerTable from '@/features/admin/components/InsurerTable';
import { Badge as UiBadge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/primitives/pagination';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AWAITING_CERTIFICATE = 'Awaiting insurer certificate';
const POLICIES_PER_PAGE = 8;


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

const policyDate = (policy) => {
  const timestamp = new Date(policy.paymentProof?.confirmedAt || policy.receivedAt || policy.issuedAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const visiblePages = (pageCount, currentPage) => {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const pages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount])]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((first, second) => first - second);

  return pages.flatMap((page, index) => {
    const previousPage = pages[index - 1];
    return index > 0 && page - previousPage > 1
      ? [`ellipsis-${previousPage}-${page}`, page]
      : [page];
  });
};

const SubPageHeader = ({ title, description, onBack, action }) => (
  <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div className="flex min-w-0 items-start gap-3">
      <Button type="button" variant="outline" size="icon" onClick={onBack} aria-label="Back to admin overview" className="mt-0.5 shrink-0 rounded-xl">
        <ChevronLeft aria-hidden="true" />
      </Button>
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
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
      className={`no-scrollbar -mx-4 flex shrink-0 gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:p-3 lg:shadow-sm ${
        collapsed ? 'lg:w-[72px]' : 'lg:w-[250px]'
      } lg:sticky lg:top-[104px] lg:min-h-[calc(100dvh-128px)] lg:max-h-[calc(100dvh-128px)] lg:self-start lg:overflow-y-auto`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="admin-sections"
        className={`mb-3 hidden h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex ${
          collapsed ? 'w-10 justify-center px-0' : ''
        }`}
      >
        {collapsed ? <ChevronsRight className="size-4" aria-hidden="true" /> : <ChevronsLeft className="size-4" aria-hidden="true" />}
        {!collapsed && <span className="text-xs font-medium uppercase tracking-wider">Collapse</span>}
        <span className="sr-only">{collapsed ? 'Expand navigation' : 'Collapse navigation'}</span>
      </button>

      <div id="admin-sections" className="flex gap-2 lg:flex-col lg:gap-1">
        {!collapsed && <p className="hidden px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground lg:block">Workspace</p>}
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
              className={`group flex min-h-11 shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors lg:w-full lg:border-transparent ${
                collapsed ? 'lg:justify-center lg:px-0' : ''
              } ${
                active
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground lg:bg-transparent'
              }`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{item.icon}</span>
              </span>

              <span className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
                <span className="block whitespace-nowrap lg:whitespace-normal">
                  {item.label}
                </span>
                {item.hint && <span className="mt-0.5 hidden truncate text-xs font-normal text-muted-foreground lg:block">{item.hint}</span>}
              </span>

              {item.badge !== undefined && (
                <span className={`hidden shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium ${collapsed ? '' : 'lg:inline-flex'} ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {item.badge}
                </span>
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
  const recentPolicies = [...policies].sort((first, second) => policyDate(second) - policyDate(first)).slice(0, 6);

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
    { id: 'recent_policies', label: 'Recent policies', icon: 'policy', hint: 'Issued cover', badge: policies.length, matches: ['recent_policies'] },
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
        <SubPageHeader
          title={editingInsurer ? `Edit ${editingInsurer.name}` : 'Onboard an insurance company'}
          description={editingInsurer ? 'Update the insurer profile without changing its status or historical records.' : 'Add a company so it can receive eligible requests and manage its own quotes.'}
          onBack={showInsurers}
        />
        <Card className="max-w-5xl border-border shadow-none">
          <CardContent>
          <p className="mb-7 text-sm leading-relaxed text-muted-foreground">
            {editingInsurer ? 'Edit the insurer details below. Its current status and existing records will be kept.' : 'Active companies receive every eligible quote request. Deactivated companies keep their historical records but receive no new requests.'}
          </p>
          <InsurerOnboardingForm insurer={editingInsurer} piaRatePercentage={piaRate} onSubmit={saveInsurer} onCancel={showInsurers} />
          </CardContent>
        </Card>
      </>
    );
  } else if (view === 'manage_insurers') {
    const removed = insurersList.filter((insurer) => insurer.status === 'Deleted');
    const visibleInsurers = showDeleted ? insurersList : insurersList.filter((insurer) => insurer.status !== 'Deleted');
    const addButton = <Button type="button" size="lg" onClick={() => { setEditingInsurer(null); setView('add_insurer'); }}><Plus aria-hidden="true" />Add insurer</Button>;
    content = (
      <>
        <SubPageHeader title="Manage insurers" description="View, update, deactivate or restore companies in the marketplace." onBack={() => setView('dashboard')} action={addButton} />
        {removed.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/40 px-5 py-4">
            <p className="text-sm text-muted-foreground">
              {removed.length} removed {removed.length === 1 ? 'insurer is' : 'insurers are'} hidden.
              Their quotes, policies and claims are kept.
            </p>
            <Button
              type="button" variant="ghost" size="sm"
              onClick={() => setShowDeleted((current) => !current)}
              className="text-primary hover:bg-primary/10 hover:text-primary"
            >
              {showDeleted ? 'Hide removed' : 'Show removed'}
            </Button>
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
  } else if (view === 'recent_policies') {
    content = <RecentPolicies policies={policies} onBack={() => setView('dashboard')} />;
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
    { label: 'Policies', value: policies.length, icon: ShieldCheck, note: `${activePolicies} active` },
    { label: 'Awaiting certificate', value: awaitingCertificate, icon: FileCheck2, note: awaitingCertificate ? 'Insurer action due' : 'None outstanding', alert: awaitingCertificate > 0 },
    { label: 'Active insurers', value: activeInsurers.length, icon: Building2, note: `${insurersList.length - activeInsurers.length} inactive or removed` },
    { label: 'Claims open', value: openClaims, icon: ShieldAlert, note: `${claims.length} notified in total`, alert: openClaims > 0 },
  ];
  const operations = [
    { label: 'Claims awaiting acknowledgement', value: openClaims, icon: ShieldAlert },
    { label: 'Quote requests in flight', value: quoteRequests.length, icon: 'send' },
    { label: 'Registered customers', value: registeredAccounts.length, icon: UsersRound },
    { label: 'PIA minimum rate', value: `${piaRate}%`, icon: Gavel, view: 'pia_config' },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <section className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <UiBadge variant="outline" className="border-primary/20 bg-primary/10 text-primary">Admin workspace</UiBadge>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">InsurShield platform</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {new Date().toLocaleDateString('en-ZM', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">admin_panel_settings</span></span>
          <div>
            <p className="whitespace-nowrap text-sm font-medium">{agentName}</p>
            <p className="mt-0.5 text-xs capitalize text-muted-foreground">{agentRole} portal</p>
          </div>
        </div>
      </section>

      <section aria-label="Platform summary" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {kpis.map(({ label, value, icon: MetricIcon, note, alert }) => (
          <Card key={label} size="sm" className="gap-3 border-border shadow-none">
            <CardHeader className="grid-cols-[1fr_auto] items-center gap-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><MetricIcon className="size-4" aria-hidden="true" /></span>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{value.toLocaleString()}</p>
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {alert && <UiBadge variant="outline" className="border-primary/20 bg-primary/10 text-primary">Action</UiBadge>}
                {note}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="gap-0 border-border shadow-none xl:col-span-2">
          <CardHeader className="grid-cols-[1fr_auto] items-start gap-4 border-b">
            <div>
              <CardTitle>Premium revenue</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Confirmed collections over the last 12 months.</p>
            </div>
            <UiBadge variant="outline" className="border-primary/20 bg-primary/10 px-3 py-1 text-sm text-primary">{formatZMW(premiumTotal)}</UiBadge>
          </CardHeader>
          <CardContent className="pt-6">

          {peakMonth === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20">
              <CircleDollarSign className="size-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No confirmed payments yet.</p>
            </div>
          ) : (
            <>
              <div className="mt-8 flex h-40 items-end gap-2">
                {revenue.map((month) => (
                  <div key={month.key} className="group relative flex h-full flex-1 flex-col justify-end">
                    <span className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] text-background opacity-0 transition-opacity group-hover:opacity-100">
                      {formatZMW(month.total)}
                    </span>
                    <span
                      className={`block w-full rounded-t-sm transition-colors ${month.total > 0 ? 'bg-primary' : 'bg-muted'}`}
                      style={{ height: `${Math.max((month.total / peakMonth) * 100, month.total > 0 ? 4 : 1)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 hidden gap-2 sm:flex">
                {revenue.map((month) => (
                  <span key={month.key} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground">{month.label}</span>
                ))}
              </div>
              <div className="mt-3 flex justify-between sm:hidden">
                <span className="text-[11px] text-muted-foreground">{revenue[0].label}</span>
                <span className="text-[11px] text-muted-foreground">{revenue[revenue.length - 1].label}</span>
              </div>
            </>
          )}
          </CardContent>
        </Card>

        <Card className="gap-0 border-border shadow-none">
          <CardHeader className="border-b"><CardTitle className="text-primary">Operations</CardTitle></CardHeader>
          <CardContent className="pt-2">
            {operations.map(({ label, value, icon: OperationIcon, view: operationView }, index) => (
              <button
                key={label}
                type="button"
                onClick={() => operationView && setView(operationView)}
                disabled={!operationView}
                className={`flex w-full items-center justify-between gap-3 px-1 py-4 text-left transition-colors enabled:hover:text-primary disabled:cursor-default ${index === 0 ? '' : 'border-t border-border'}`}
              >
                <span className="flex items-center gap-3">
                  {typeof OperationIcon === 'string' ? <span className="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">{OperationIcon}</span> : <OperationIcon className="size-4 text-primary" aria-hidden="true" />}
                  <span className="text-sm leading-[1.35]">{label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-base font-semibold tabular-nums">{value}</span>
                  {operationView && <span className="material-symbols-outlined text-[16px] text-muted-foreground" aria-hidden="true">chevron_right</span>}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <Card className="gap-0 border-border shadow-none">
          <CardHeader className="grid-cols-[1fr_auto] items-center border-b">
            <div><CardTitle>Recent policies</CardTitle><p className="mt-1 text-sm text-muted-foreground">The latest policy records created on the platform.</p></div>
            <div className="flex items-center gap-2">
              <UiBadge variant="outline" className="hidden text-muted-foreground sm:inline-flex">{policies.length} total</UiBadge>
              <Button type="button" variant="ghost" size="sm" onClick={() => setView('recent_policies')} className="text-primary hover:bg-primary/10 hover:text-primary">View all</Button>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
          <div className="overflow-hidden rounded-xl border border-border">
            {recentPolicies.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">No policies issued yet.</p>
            ) : (
              recentPolicies.map((policy, index) => (
                <div
                  key={policy.policyNumber}
                  className={`flex flex-col gap-4 p-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between ${index === 0 ? '' : 'border-t border-border'}`}
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <span className="material-symbols-outlined text-[19px]" aria-hidden="true">directions_car</span>
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{policy.customerName || 'Customer'}</p>
                      <p className="mt-1 truncate text-xs font-medium text-primary">{policy.policyNumber}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{policy.vehicle} · {policy.insurer}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:block sm:text-right">
                    <p className="text-sm font-semibold">{formatZMW(policy.premium || 0)}</p>
                    <UiBadge variant="outline" className={`sm:mt-2 ${policy.status === 'Active' ? 'border-primary/20 bg-primary/10 text-primary' : 'text-muted-foreground'}`}>{policy.status}</UiBadge>
                  </div>
                </div>
              ))
            )}
          </div>
          </CardContent>
        </Card>
      </section>
    </motion.div>
  );
}
}

function RecentPolicies({ policies, onBack }) {
  const sortedPolicies = [...policies].sort((first, second) => policyDate(second) - policyDate(first));
  const pageCount = Math.max(1, Math.ceil(sortedPolicies.length / POLICIES_PER_PAGE));
  const [selectedPage, setSelectedPage] = useState(1);
  const currentPage = Math.min(selectedPage, pageCount);
  const firstPolicyIndex = (currentPage - 1) * POLICIES_PER_PAGE;
  const pagePolicies = sortedPolicies.slice(firstPolicyIndex, firstPolicyIndex + POLICIES_PER_PAGE);
  const pages = visiblePages(pageCount, currentPage);

  const goToPage = (event, page) => {
    event.preventDefault();
    if (page < 1 || page > pageCount || page === currentPage) return;
    setSelectedPage(page);
  };

  return (
    <>
      <SubPageHeader title="Recent policies" description="Review issued policies without extending the overview into a long list." onBack={onBack} />
      <Card className="gap-0 border-border shadow-none">
        <CardHeader className="grid-cols-[1fr_auto] items-center border-b">
          <div>
            <CardTitle>Issued policy records</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Newest records appear first.</p>
          </div>
          <UiBadge variant="outline" className="text-muted-foreground">{sortedPolicies.length} total</UiBadge>
        </CardHeader>
        {pagePolicies.length ? (
          <CardContent className="pt-5">
            <ul className="overflow-hidden rounded-xl border border-border">
              {pagePolicies.map((policy, index) => {
                const recordedAt = policyDate(policy);
                const customerName = policy.customerName || policy.customer?.fullName || 'Customer';
                return (
                  <li key={policy.policyNumber} className={`grid gap-4 p-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(10rem,.9fr)_auto] sm:items-center ${index === 0 ? '' : 'border-t border-border'}`}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><span className="material-symbols-outlined text-[19px]" aria-hidden="true">directions_car</span></span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{customerName}</p>
                        <p className="mt-1 truncate text-xs font-medium text-primary">{policy.policyNumber}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{policy.vehicle || 'Vehicle details not recorded'} · {policy.insurer || 'Insurer not recorded'}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs sm:block sm:text-sm">
                      <div><p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Premium</p><p className="mt-1 font-semibold">{formatZMW(policy.premium || 0)}</p></div>
                      <div className="mt-0 sm:mt-3"><p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Issued</p><p className="mt-1 text-muted-foreground">{recordedAt ? formatDate(recordedAt) : 'Not recorded'}</p></div>
                    </div>
                    <div className="sm:text-right">
                      <UiBadge variant="outline" className={(policy.status === 'Active' ? 'border-primary/20 bg-primary/10 text-primary' : 'text-muted-foreground')}>{policy.status || 'Pending'}</UiBadge>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        ) : (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">No policies have been issued yet.</CardContent>
        )}
        {pageCount > 1 && (
          <CardFooter className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">Showing {firstPolicyIndex + 1}–{Math.min(firstPolicyIndex + POLICIES_PER_PAGE, sortedPolicies.length)} of {sortedPolicies.length} policies</p>
            <Pagination className="mx-0 w-auto sm:ml-auto">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href="#recent-policies" className={currentPage === 1 ? 'pointer-events-none opacity-45' : undefined} aria-disabled={currentPage === 1} onClick={(event) => goToPage(event, currentPage - 1)} />
                </PaginationItem>
                {pages.map((page) => typeof page === 'number' ? (
                  <PaginationItem key={page}>
                    <PaginationLink href="#recent-policies" isActive={page === currentPage} onClick={(event) => goToPage(event, page)}>{page}</PaginationLink>
                  </PaginationItem>
                ) : (
                  <PaginationItem key={page}><PaginationEllipsis /></PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext href="#recent-policies" className={currentPage === pageCount ? 'pointer-events-none opacity-45' : undefined} aria-disabled={currentPage === pageCount} onClick={(event) => goToPage(event, currentPage + 1)} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </CardFooter>
        )}
      </Card>
    </>
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
      <SubPageHeader title="Insurer details" description="Read the company profile, configuration and claims contact details." onBack={onBack} />
      <Card className="max-w-5xl gap-0 border-border shadow-none">
        <CardHeader className="flex flex-col gap-4 border-b sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
              {insurer.logoUrl ? <img src={insurer.logoUrl} alt={`${insurer.name} logo`} className="max-h-10 max-w-10 object-contain" /> : <Building2 className="size-6" aria-hidden="true" />}
            </span>
            <div><h3 className="text-xl font-semibold tracking-tight">{insurer.name}</h3><p className="mt-1 text-sm text-muted-foreground">Read-only company profile</p></div>
          </div>
          <UiBadge variant="outline" className={`w-fit ${(insurer.status || 'Active') === 'Active' ? 'border-primary/20 bg-primary/10 text-primary' : 'text-muted-foreground'}`}>{insurer.status || 'Active'}</UiBadge>
        </CardHeader>
        <CardContent className="pt-6">
        <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
              <dd className="mt-2 break-words text-sm leading-relaxed">{value || <span className="text-muted-foreground">Not recorded</span>}</dd>
            </div>
          ))}
        </dl>
        </CardContent>
      </Card>
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
      <SubPageHeader title="Find a customer account" description="Look up a customer by their exact registered email address or mobile number." onBack={onBack} />
      <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start">
        <Card className="gap-0 border-border shadow-none">
        <CardContent>
        <form onSubmit={search} className="space-y-4">
          <label className="block"><span className={labelClass}>Customer email or mobile number</span><input required value={query} onChange={(event) => setQuery(event.target.value)} className={inputClass} placeholder="name@email.com or 0970 123 456" /></label>
          <Button type="submit" size="lg" className="w-full"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">search</span>Find account</Button>
        </form>
        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          Passwords and one-time codes are never shown to staff. To restore access, guide the
          customer through <span className="font-medium text-foreground">Forgot password</span> on the sign-in screen.
        </p>
        </CardContent>
        </Card>

        <Card className="gap-0 border-border shadow-none">
        <CardHeader className="border-b"><CardTitle>Customer record</CardTitle></CardHeader>
        <CardContent className="pt-6">
        {!result && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Search by the exact email address or mobile number the customer registered with.
            Results appear here.
          </p>
        )}
        {result?.notFound && <p className="text-sm leading-relaxed text-muted-foreground">No account matches those details. Ask the customer to register, or check the spelling of the email address.</p>}
        {result?.account && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="flex items-center gap-2.5 text-primary">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">check_circle</span>
              <span className="text-sm font-medium">Account found</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5 xl:grid-cols-3">
              <div><dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Name</dt><dd className="mt-2 text-sm">{result.account.fullName}</dd></div>
              <div><dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Mobile</dt><dd className="mt-2 text-sm">{result.account.phone}</dd></div>
              <div className="col-span-2 xl:col-span-1"><dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Email</dt><dd className="mt-2 break-words text-sm">{result.account.email}</dd></div>
              <div><dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Quote requests</dt><dd className="mt-2 text-sm">{result.requests}</dd></div>
              <div><dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Policies</dt><dd className="mt-2 text-sm">{result.policies}</dd></div>
            </dl>
          </motion.div>
        )}
        </CardContent>
        </Card>
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
      <SubPageHeader title="PIA compliance configuration" description="Set the minimum annual motor premium rate used when insurers prepare quotes." onBack={onBack} />
      <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,420px)_1fr] lg:items-start">
        <Card className="gap-0 border-border shadow-none">
        <CardContent className="space-y-6">
        <label className="block">
          <span className={labelClass}>PIA minimum rate (% of vehicle value, per year)</span>
          <div className="relative">
            <input type="number" min="0" step="0.1" value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} className={`${inputClass} pr-12 font-semibold`} />
            <span className="absolute right-4 top-3.5 text-sm font-semibold text-muted-foreground">%</span>
          </div>
          <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">Current: {piaRate}% · e.g. ZMW {((250000 * piaRate) / 100).toLocaleString()} on a ZMW 250,000 vehicle</span>
        </label>
        <Button type="button" size="lg" onClick={save} className="w-full">Save PIA configuration</Button>
        {saved && <p className="text-center text-sm text-primary">PIA configuration updated.</p>}
        </CardContent>
        </Card>

        <Card className="gap-0 border-border shadow-none">
        <CardHeader className="border-b"><CardTitle>Regulatory setting</CardTitle></CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Gavel className="size-4" aria-hidden="true" /></span>
            <div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                The Pensions and Insurance Authority sets a minimum motor premium as a percentage
                of the vehicle's declared value. Any insurer rate below it is raised to this floor
                when quoting.
              </p>
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <p className="text-sm font-medium">What the floor costs at this rate</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-5">
              {[150000, 250000, 400000, 650000].map((value) => (
                <div key={value}>
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    ZMW {value.toLocaleString()}
                  </dt>
                  <dd className="mt-2 text-sm font-medium">
                    ZMW {((value * (parseFloat(draft) || 0)) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
              Annual premium floor for a vehicle at each declared value.
            </p>
          </div>
        </CardContent>
        </Card>
      </div>
    </>
  );
}
