import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/api';
import { useStore } from '@/store';
import Meta from '@/components/ui/Meta';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { fieldClass, labelClass } from '@/components/ui/field';

/**
 * Accounts, as an administrator sees them.
 *
 * Staff logins are created here because nobody self-registers into a portal.
 * Customers are not: they open their own accounts, so this shows them and can
 * suspend one, but never creates or edits them.
 */

const ROLE_LABEL = {
  SUPER_ADMIN: 'Administrator',
  ADMIN: 'Administrator',
  INSURER_USER: 'Insurer portal',
};

const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Administrator — the whole console' },
  { value: 'SUPER_ADMIN', label: 'Administrator (super) — the whole console' },
  { value: 'INSURER_USER', label: 'Insurer portal — one insurer’s work only' },
];

const EMPTY_STAFF = { email: '', fullName: '', role: 'ADMIN', insurerId: '' };

export default function UserManagement({ insurers }) {
  const staffSession = useStore((state) => state.staffSession);
  const [staff, setStaff] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [form, setForm] = useState(null);
  const [issued, setIssued] = useState(null);
  const [confirming, setConfirming] = useState(null);

  const activeInsurers = useMemo(() => insurers.filter((insurer) => insurer.status !== 'Deleted'), [insurers]);

  const loadStaff = async () => {
    try {
      setStaff(await api.admin.listStaff());
    } catch (caught) {
      setError(caught.message || 'The staff list could not be loaded.');
    }
  };

  const loadCustomers = async (search = '') => {
    try {
      setCustomers(await api.admin.listCustomers(search));
    } catch (caught) {
      setError(caught.message || 'The customer list could not be loaded.');
    }
  };

  useEffect(() => {
    void (async () => {
      await Promise.all([loadStaff(), loadCustomers()]);
      setLoading(false);
    })();
  }, []);

  // Searching is a fresh read rather than a filter, so it finds people who are
  // not already on screen.
  useEffect(() => {
    const timer = setTimeout(() => { void loadCustomers(query.trim()); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const act = async (id, run, message) => {
    setBusyId(id);
    setError('');
    try {
      await run();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : message);
    } finally {
      setBusyId(null);
    }
  };

  const submitStaff = async (event) => {
    event.preventDefault();
    setError('');
    const payload = {
      email: form.email.trim(),
      fullName: form.fullName.trim(),
      role: form.role,
      ...(form.role === 'INSURER_USER' ? { insurerId: form.insurerId } : {}),
    };
    try {
      if (form.id) {
        await api.admin.updateStaff(form.id, payload);
        setForm(null);
      } else {
        const { temporaryPassword } = await api.admin.createStaff(payload);
        setForm(null);
        // Shown once: it is not recoverable afterwards.
        setIssued({ email: payload.email, password: temporaryPassword });
      }
      await loadStaff();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That account could not be saved.');
    }
  };

  if (loading) return <Meta className="block py-16 text-center text-ink-muted">Loading accounts…</Meta>;

  return (
    <div className="space-y-10">
      {error && (
        <p role="alert" className="border border-primary/30 bg-primary/[0.06] px-4 py-3 text-[13px] text-primary">{error}</p>
      )}

      {issued && (
        <section className="ticked border border-primary bg-canvas p-5">
          <Meta className="text-primary">Temporary password for {issued.email}</Meta>
          <p className="mt-4 font-mono text-[22px] tracking-[0.04em] text-ink">{issued.password}</p>
          <p className="mt-3 text-[13px] leading-[1.55] text-ink-muted">
            Pass this on now — it is not shown again. They will be asked to choose their own
            password the first time they sign in.
          </p>
          <button type="button" onClick={() => setIssued(null)} className="mt-5 inline-flex min-h-10 items-center rounded-[1px] border border-dashed border-line-strong px-4 text-[13px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary">
            Done
          </button>
        </section>
      )}

      {/* ── Staff ──────────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-dashed border-line pb-3">
          <Meta className="text-primary">Staff accounts</Meta>
          <div className="flex items-center gap-4">
            <Meta className="text-ink-faint">{staff.filter((user) => user.isActive).length} active</Meta>
            <button type="button" onClick={() => { setForm({ ...EMPTY_STAFF }); setIssued(null); }} className="group relative inline-flex min-h-10 items-center gap-2 overflow-hidden rounded-[1px] bg-primary px-4 text-[13px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add</span>Add staff
            </button>
          </div>
        </div>

        {form && (
          <form onSubmit={submitStaff} className="mt-5 border border-primary bg-canvas p-5">
            <Meta className="text-primary">{form.id ? 'Edit account' : 'New staff account'}</Meta>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Full name</span>
                <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={fieldClass} placeholder="e.g. Joy Phiri" />
              </label>
              <label className="block">
                <span className={labelClass}>Email address</span>
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={fieldClass} placeholder="name@insurshield.zm" disabled={Boolean(form.id)} />
              </label>
              <label className="block">
                <span className={labelClass}>Role</span>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={fieldClass}>
                  {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              {form.role === 'INSURER_USER' && (
                <label className="block">
                  <span className={labelClass}>Insurer</span>
                  <select required value={form.insurerId} onChange={(e) => setForm({ ...form, insurerId: e.target.value })} className={fieldClass}>
                    <option value="">Choose an insurer…</option>
                    {activeInsurers.map((insurer) => <option key={insurer.id} value={insurer.id}>{insurer.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {!form.id && (
              <p className="mt-5 text-[12px] leading-[1.55] text-ink-muted">
                A temporary password is generated and shown once when the account is created.
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="submit" className="inline-flex min-h-11 items-center rounded-[1px] bg-primary px-5 text-[14px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">
                {form.id ? 'Save changes' : 'Create account'}
              </button>
              <button type="button" onClick={() => setForm(null)} className="inline-flex min-h-11 items-center rounded-[1px] border border-dashed border-line-strong px-5 text-[14px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary">
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="mt-5 border border-line">
          {staff.map((user, index) => (
            <div key={user.id} className={`flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between ${index ? 'border-t border-dashed border-line' : ''} ${user.isActive ? '' : 'bg-canvas-2'}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">{user.fullName}</span>
                  <Meta className={`rounded-[1px] border px-2 py-1 ${user.isActive ? 'border-line-strong text-ink-muted' : 'border-dashed border-line-strong text-ink-faint'}`}>
                    {user.isActive ? ROLE_LABEL[user.role] : 'Deactivated'}
                  </Meta>
                  {user.id === staffSession?.id && <Meta className="text-primary">You</Meta>}
                  {user.mustChangePassword && user.isActive && <Meta className="text-primary">Password not yet changed</Meta>}
                </div>
                <p className="mt-2 break-all font-mono text-[12px] text-ink-muted">{user.email}</p>
                {user.insurerName && <Meta className="mt-2 block text-ink-faint">{user.insurerName}</Meta>}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <RowButton onClick={() => setForm({ id: user.id, email: user.email, fullName: user.fullName, role: user.role, insurerId: user.insurerId || '' })} disabled={busyId === user.id}>Edit</RowButton>
                <RowButton
                  onClick={() => act(user.id, async () => {
                    const { temporaryPassword } = await api.admin.resetStaffPassword(user.id);
                    setIssued({ email: user.email, password: temporaryPassword });
                    await loadStaff();
                  }, 'The password could not be reset.')}
                  disabled={busyId === user.id}
                >
                  Reset password
                </RowButton>
                {user.isActive ? (
                  <RowButton onClick={() => setConfirming(user)} disabled={busyId === user.id} tone="danger">Deactivate</RowButton>
                ) : (
                  <RowButton
                    onClick={() => act(user.id, async () => { await api.admin.updateStaff(user.id, { isActive: true }); await loadStaff(); }, 'The account could not be restored.')}
                    disabled={busyId === user.id}
                  >
                    Restore
                  </RowButton>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Customers ──────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-dashed border-line pb-3">
          <Meta className="text-primary">Customer accounts</Meta>
          <Meta className="text-ink-faint">{customers.length} shown</Meta>
        </div>

        <label className="mt-5 block">
          <span className="sr-only">Search customers</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className={fieldClass} placeholder="Search by name, email or mobile number" />
        </label>

        <p className="mt-3 text-[12px] leading-[1.55] text-ink-muted">
          Customers open their own accounts, so these can be read and suspended but not edited here.
          Suspending bars sign-in; it changes nothing about their policies or claims.
        </p>

        <div className="mt-5 border border-line">
          {customers.length === 0 && (
            <p className="p-8 text-center text-[13px] text-ink-muted">
              {query ? `No customer matches “${query}”.` : 'No customer accounts yet.'}
            </p>
          )}
          {customers.map((customer, index) => (
            <div key={customer.id} className={`flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between ${index ? 'border-t border-dashed border-line' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[15px] font-medium tracking-[-0.01em] text-ink">{customer.fullName}</span>
                  <Meta className={`rounded-[1px] border px-2 py-1 ${customer.status === 'Active' ? 'border-line-strong text-ink-muted' : 'border-primary text-primary'}`}>{customer.status}</Meta>
                </div>
                <p className="mt-2 break-all font-mono text-[12px] text-ink-muted">{customer.email}{customer.phone ? ` · ${customer.phone}` : ''}</p>
                <Meta className="mt-2 block text-ink-faint">
                  {customer.policies} policies · {customer.quoteRequests} quotes · {customer.claims} claims
                </Meta>
              </div>

              {customer.status !== 'Closed' && (
                <div className="shrink-0">
                  <RowButton
                    tone={customer.status === 'Active' ? 'danger' : undefined}
                    disabled={busyId === customer.id}
                    onClick={() => act(customer.id, async () => {
                      await api.admin.setCustomerSuspended(customer.id, customer.status === 'Active');
                      await loadCustomers(query.trim());
                    }, 'That account could not be changed.')}
                  >
                    {customer.status === 'Active' ? 'Suspend' : 'Restore'}
                  </RowButton>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {confirming && (
        <ConfirmDialog
          open
          destructive
          title={`Deactivate ${confirming.fullName}?`}
          description="They keep their account, but cannot sign in until it is restored."
          confirmLabel="Deactivate"
          consequences={[
            { text: 'They will not be able to sign in to any portal.', kept: false },
            { text: 'Their account is kept, so the work it touched still shows who did it.', kept: true },
            { text: 'You can restore it at any time.', kept: true },
          ]}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            const user = confirming;
            setConfirming(null);
            await act(user.id, async () => { await api.admin.deactivateStaff(user.id); await loadStaff(); }, 'That account could not be deactivated.');
          }}
        />
      )}
    </div>
  );
}

function RowButton({ children, onClick, disabled = false, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center rounded-[1px] border border-dashed px-3 text-[13px] font-medium transition-colors duration-200 ease-out disabled:pointer-events-none disabled:border-line disabled:text-ink-faint ${
        tone === 'danger'
          ? 'border-primary/40 text-primary hover:border-primary'
          : 'border-line-strong text-ink hover:border-primary hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}
