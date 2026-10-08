import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, ApiError } from '@/api';
import { useStore } from '@/store';
import { fieldClass, labelClass } from '@/components/ui/field';
import Meta from '@/components/ui/Meta';
import ConsentModal from '@/features/auth/components/ConsentModal';

/**
 * The entry point to a customer account.
 *
 * Accounts live in the API: the password is sent once, hashed there, and what
 * comes back is a short-lived token. Nothing but that token is kept here.
 *
 * Signing in and consenting are separate steps: a returning customer who has
 * already accepted the notice is not asked again, and a new one cannot reach a
 * protected page without accepting it.
 *
 * PARKED: one-time codes and self-service password reset both need an email or
 * SMS provider. Until one is wired up, someone locked out is helped by support,
 * which is said plainly rather than hidden behind a form that cannot work.
 */

const MIN_PASSWORD_LENGTH = 8;

/** Explains why a guest landed here and what is waiting for them after sign-in. */
const RESUME_CONTEXT = {
  '/quote-request': { icon: 'send', text: 'Your vehicle details are saved. Sign in or create an account to send your request to every insurer.' },
  '/quotes-comparison': { icon: 'compare_arrows', text: 'Sign in to see the quotes insurers have sent you.' },
  '/claims': { icon: 'report_problem', text: 'Claims are linked to your account so you can return to them any time.' },
  '/renewal': { icon: 'autorenew', text: 'Sign in to renew a policy held in your account.' },
  '/account': { icon: 'person', text: 'Sign in to manage your policies, quotes and claims.' },
  default: { icon: 'lock', text: 'An account is needed for this step. Everything you have entered so far is saved.' },
};

const EMPTY_FORM = { fullName: '', email: '', phone: '', password: '', confirmPassword: '' };

export default function CreateAccountPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { setAuthToken, applyCustomerSession, setConsent } = useStore();

  const next = params.get('next') || '/account';
  const resumeContext = location.state?.from || params.get('next') ? RESUME_CONTEXT[next] || RESUME_CONTEXT.default : null;

  const [mode, setMode] = useState(params.get('mode') === 'signup' ? 'create' : 'login');
  const [stage, setStage] = useState('form');
  const [form, setForm] = useState(EMPTY_FORM);
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const show = (nextMode) => {
    setMode(nextMode);
    setStage('form');
    setError('');
  };

  /** Whatever the API refused, the customer reads it in the API's own words. */
  const fail = (caught, fallback) =>
    setError(caught instanceof ApiError ? caught.message : caught?.message || fallback);

  const adopt = ({ customer, consent, token }) => {
    setAuthToken(token ?? null);
    applyCustomerSession(customer, consent);
  };

  const submitLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await api.auth.login(identifier.trim(), form.password);
      adopt(session);
      // Someone who has never accepted the notice still has to, even on sign-in.
      if (session.consent?.accepted) navigate(next, { replace: true });
      else setStage('consent');
    } catch (caught) {
      fail(caught, 'Those details did not match an account.');
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      return setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (form.password !== form.confirmPassword) return setError('The two passwords do not match.');

    setBusy(true);
    setError('');
    try {
      const session = await api.auth.register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
      });
      adopt(session);
      setStage('consent');
    } catch (caught) {
      fail(caught, 'Your account could not be created. Please try again.');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  /**
   * Consent belongs to the account, not to this browser: it is recorded on the
   * server so signing out and back in does not ask again. If that write fails
   * the customer is told, because carrying on would quietly lose it.
   */
  const acceptConsent = async (record) => {
    try {
      const stored = await api.auth.acceptConsent(record.noticeVersion);
      setConsent(true, { ...record, ...stored });
      setStage('done');
    } catch (caught) {
      setStage('form');
      fail(caught, 'Your consent could not be saved. Please try again.');
    }
  };

  const heading = mode === 'create' ? 'Create your account' : 'Sign in to InsurShield';

  return (
    <main className="relative overflow-x-clip">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative mx-auto w-full max-w-[520px] px-6 py-14 lg:py-20">
        <span className="inline-flex items-center gap-3 border border-dashed border-line-strong bg-canvas px-3 py-1.5">
          <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
          <Meta className="text-ink-muted">Your account</Meta>
        </span>

        <h1 className="mt-7 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[44px]">{heading}</h1>

        {resumeContext && stage === 'form' && (
          <p className="mt-7 flex gap-4 border border-dashed border-line-strong p-5 text-[14px] leading-[1.55] text-ink-muted">
            <span className="material-symbols-outlined shrink-0 text-[20px] text-primary" aria-hidden="true">{resumeContext.icon}</span>
            {resumeContext.text}
          </p>
        )}

        <div className="mt-8">
          {stage === 'form' && mode === 'login' && (
            <form onSubmit={submitLogin} className="space-y-5">
              <Field label="Email address or mobile number">
                <input required value={identifier} onChange={(event) => setIdentifier(event.target.value)} className={fieldClass} placeholder="name@email.com or 0970 123 456" autoComplete="username" />
              </Field>
              <Field label="Password">
                <input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={fieldClass} placeholder="Your password" autoComplete="current-password" />
              </Field>
              <Alert text={error} />

              <Submit busy={busy}>Sign in</Submit>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <TextLink onClick={() => show('create')}>Create an account</TextLink>
                <TextLink onClick={() => setStage('locked-out')}>Forgotten your password?</TextLink>
              </div>
            </form>
          )}

          {stage === 'form' && mode === 'create' && (
            <form onSubmit={submitCreate} className="space-y-5">
              <Field label="Full name">
                <input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} className={fieldClass} placeholder="e.g. Mwiza Banda" autoComplete="name" />
              </Field>
              <Field label="Email address">
                <input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={fieldClass} placeholder="e.g. mwiza@email.com" autoComplete="email" />
              </Field>
              <Field label="Mobile number">
                <input required type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={fieldClass} placeholder="e.g. 0970 123 456" autoComplete="tel" />
              </Field>
              <Field label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
                <input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={fieldClass} autoComplete="new-password" />
              </Field>
              <Field label="Confirm password">
                <input required type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} className={fieldClass} autoComplete="new-password" />
              </Field>
              <Alert text={error} />
              <Submit busy={busy}>Create account</Submit>
              <TextLink onClick={() => show('login')} block>I already have an account</TextLink>
            </form>
          )}

          {stage === 'locked-out' && (
            <Outcome
              icon="support_agent"
              title="We will reset it for you"
              body="Resetting a password by email or SMS is not available yet. Call or email support and, once they have checked who you are, they will give you a temporary password to sign in with and change."
              action="Back to sign in"
              onAction={() => show('login')}
            />
          )}

          {stage === 'done' && (
            <Outcome
              icon="task_alt"
              title="Your account is ready"
              body="Your details and consent are saved. You can request quotes, follow claims and renew a policy."
              action={resumeContext && next !== '/account' ? 'Continue where you left off' : 'Go to my account'}
              onAction={() => navigate(next, { replace: true })}
            />
          )}
        </div>

        {stage === 'form' && (
          <p className="mt-12 border-t border-line pt-6 text-[13px] leading-[1.6] text-ink-faint">
            Your password is sent once, stored only as a hash, and never kept on this device.
          </p>
        )}
      </motion.div>

      {stage === 'consent' && <ConsentModal onAccept={acceptConsent} onDecline={() => navigate('/', { replace: true })} />}
    </main>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="mt-2 block text-[12px] text-ink-faint">{hint}</span>}
    </label>
  );
}

function Submit({ children, busy = false }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="group relative flex min-h-[52px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:pointer-events-none disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint"
    >
      <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
      {busy && <span className="material-symbols-outlined relative animate-spin text-[18px]" aria-hidden="true">sync</span>}
      <span className="relative">{busy ? 'Just a moment…' : children}</span>
    </button>
  );
}

function TextLink({ children, onClick, disabled = false, block = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-10 text-[13px] font-medium text-primary underline-offset-4 transition-colors duration-200 ease-out hover:underline disabled:text-ink-faint disabled:no-underline ${block ? 'block w-full text-center' : ''}`}
    >
      {children}
    </button>
  );
}

function Alert({ text, tone = 'error' }) {
  if (!text) return null;
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={`flex items-start gap-2.5 border p-3.5 text-[14px] leading-[1.5] ${tone === 'error' ? 'border-primary/30 bg-primary/[0.06] text-primary' : 'border-dashed border-line-strong bg-canvas-2 text-ink'}`}
    >
      <span className="material-symbols-outlined shrink-0 text-[20px]" aria-hidden="true">{tone === 'error' ? 'error' : 'info'}</span>
      {text}
    </p>
  );
}

function Outcome({ icon, title, body, action, onAction }) {
  return (
    <section className="border border-dashed border-line-strong bg-canvas-2 p-10 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center border border-line-strong bg-canvas">
        <span className="material-symbols-outlined text-[26px] text-primary" aria-hidden="true">{icon}</span>
      </span>
      <h2 className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      <p className="mx-auto mt-3 max-w-sm text-[14px] leading-[1.6] text-ink-muted">{body}</p>
      <button type="button" onClick={onAction} className="mt-6 inline-flex min-h-12 items-center rounded-[1px] bg-primary px-6 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c]">
        {action}
      </button>
    </section>
  );
}
