import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api, ApiError } from '@/api';
import { useStore } from '@/store';
import { fieldClass, labelClass } from '@/components/ui/field';
import ConsentModal from '@/features/auth/components/ConsentModal';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/primitives/card';

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
  '/quote-request': { icon: 'send', text: 'Your vehicle details are saved. Sign in or create an account to compare cover guides and choose insurers for final quotes.' },
  '/quotes-comparison': { icon: 'compare_arrows', text: 'Sign in to see the quotes insurers have sent you.' },
  '/claims': { icon: 'report_problem', text: 'Claims are linked to your account so you can return to them any time.' },
  '/renewal': { icon: 'autorenew', text: 'Sign in to renew a policy held in your account.' },
  '/account': { icon: 'person', text: 'Sign in to manage your policies, quotes and claims.' },
  default: { icon: 'lock', text: 'An account is needed for this step. Everything you have entered so far is saved.' },
};

export default function CreateAccountPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { setAuthToken, applyCustomerSession, setConsent, isAuthenticated, consentAccepted } = useStore();

  const next = searchParams.get('next') || '/account';
  const resumeContext =
    RESUME_CONTEXT[next.split('?')[0]] ||
    (location.state?.reason === 'account-required' ? RESUME_CONTEXT.default : null);

  const [mode, setMode] = useState(() => (searchParams.get('mode') === 'create' ? 'create' : 'login'));
  const [stage, setStage] = useState('form'); // form | consent | done | locked-out
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Already signed in and consented: there is nothing to do on this page.
  // A just-created account is the exception — it has both, and sending it
  // straight on would skip the confirmation it has only this moment earned.
  useEffect(() => {
    if (isAuthenticated && consentAccepted && stage !== 'done') navigate(next, { replace: true });
  }, [isAuthenticated, consentAccepted, navigate, next, stage]);

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
    <main className="min-h-full bg-muted/60">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.85fr_1fr] lg:px-8 lg:py-14">
        <section className="hidden flex-col justify-between rounded-2xl border border-border bg-card p-8 lg:flex">
          <div>
            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">Customer access</Badge>
            <h1 className="mt-6 text-3xl font-semibold tracking-tight">Insurance, kept simple.</h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">Sign in to compare insurer quotations, manage cover and return to important documents whenever you need them.</p>
          </div>
          <div className="space-y-4 border-t border-border pt-6 text-sm">
            {[
              ['verified_user', 'Your policies and certificates'],
              ['compare_arrows', 'Quotes from insurers you choose'],
              ['support_agent', 'Claims linked to your account'],
            ].map(([icon, text]) => (
              <div key={icon} className="flex items-center gap-3 text-muted-foreground"><span className="material-symbols-outlined rounded-lg bg-primary/10 p-2 text-[18px] text-primary" aria-hidden="true">{icon}</span>{text}</div>
            ))}
          </div>
        </section>

        <Card className="gap-0 border-border shadow-none">
          <CardHeader className="border-b">
            <Badge variant="outline" className="w-fit border-primary/20 bg-primary/10 text-primary">Your account</Badge>
            <CardTitle className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</CardTitle>
            <CardDescription className="mt-2 max-w-lg leading-relaxed">Access your policies, quote requests and claims securely.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
        {resumeContext && stage === 'form' && (
          <div className="mb-6 flex gap-3 rounded-xl border border-primary/20 bg-primary/[0.05] p-4 text-sm leading-relaxed text-muted-foreground">
            <span className="material-symbols-outlined shrink-0 text-[20px] text-primary" aria-hidden="true">{resumeContext.icon}</span>
            {resumeContext.text}
          </div>
        )}

        <div>
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
          </CardContent>
          {stage !== 'done' && (
          <CardFooter className="border-t pt-5 text-xs leading-relaxed text-muted-foreground">
            Accounts are held in this browser while InsurShield is a prototype. Nothing you enter
            here leaves the device.
          </CardFooter>
          )}
        </Card>
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

function Submit({ children, busy = false, disabled = false }) {
  return (
    <Button
      type="submit"
      disabled={busy || disabled}
      size="lg"
      className="min-h-12 w-full"
    >
      {busy ? 'Just a moment…' : children}
    </Button>
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
      className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-[14px] leading-[1.5] ${tone === 'error' ? 'border-primary/30 bg-primary/[0.06] text-primary' : 'border-dashed border-line-strong bg-canvas-2 text-ink'}`}
    >
      <span className="material-symbols-outlined shrink-0 text-[20px]" aria-hidden="true">{tone === 'error' ? 'error' : 'info'}</span>
      {text}
    </p>
  );
}

function Outcome({ icon, title, body, action, onAction }) {
  return (
    <section className="rounded-xl border border-border bg-muted/40 p-8 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-lg bg-primary/10">
        <span className="material-symbols-outlined text-[26px] text-primary" aria-hidden="true">{icon}</span>
      </span>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      <Button type="button" onClick={onAction} size="lg" className="mt-6">{action}</Button>
    </section>
  );
}
