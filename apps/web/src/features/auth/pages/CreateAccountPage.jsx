import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { DEMO_CUSTOMER_ACCOUNT, useStore } from '@/store';
import { fieldClass, labelClass } from '@/components/ui/field';
import Meta from '@/components/ui/Meta';
import ConsentModal from '@/features/auth/components/ConsentModal';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/primitives/card';

/**
 * The entry point to a customer account.
 *
 * Prototype only: accounts live in browser storage and the verification code
 * is a constant, both of which are stated on screen rather than hidden —
 * pretending otherwise would be the only dishonest thing this page could do.
 * Real deployments move this behind an identity service, and the only part
 * that needs to change is where `authenticateCustomer` and
 * `registerCustomerAccount` read from.
 *
 * Signing in and consenting are separate steps: a returning customer who has
 * already accepted the notice is not asked again, and a new one cannot reach a
 * protected page without accepting it.
 */

/** The code any verification step accepts while this runs on browser storage. */
const DEMO_CODE = '1234';
const CODE_LIFETIME_SECONDS = 120;
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_ATTEMPTS = 5;
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

const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/** Never echo a full address back at someone who may have mistyped it. */
const masked = (value) => {
  if (!value) return 'your contact details';
  if (value.includes('@')) {
    const [name, domain] = value.split('@');
    return `${name.slice(0, 2)}•••@${domain}`;
  }
  return `${value.slice(0, 3)}•••${value.slice(-2)}`;
};

export default function CreateAccountPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const {
    registeredAccounts, registerCustomerAccount, authenticateCustomer,
    resetCustomerPassword, seedDemoAccount, setConsent,
    isAuthenticated, consentAccepted,
  } = useStore();

  const next = searchParams.get('next') || '/account';
  const resumeContext =
    RESUME_CONTEXT[next.split('?')[0]] ||
    (location.state?.reason === 'account-required' ? RESUME_CONTEXT.default : null);

  const [mode, setMode] = useState(() => (searchParams.get('mode') === 'create' ? 'create' : 'login'));
  const [stage, setStage] = useState('form'); // form | code | consent | password | done | guidance
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState({ value: '', confirm: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(CODE_LIFETIME_SECONDS);
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_SECONDS);
  const codeInputs = useRef([]);

  useEffect(() => { seedDemoAccount(); }, [seedDemoAccount]);

  // Already signed in and consented: there is nothing to do on this page.
  // A just-created account is the exception — it has both, and sending it
  // straight on would skip the confirmation it has only this moment earned.
  useEffect(() => {
    if (isAuthenticated && consentAccepted && stage !== 'done') navigate(next, { replace: true });
  }, [isAuthenticated, consentAccepted, navigate, next, stage]);

  useEffect(() => {
    if (stage !== 'code') return undefined;
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => Math.max(0, value - 1));
      setResendIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  const expired = stage === 'code' && secondsLeft === 0;
  const locked = attempts >= MAX_ATTEMPTS;

  const accounts = [DEMO_CUSTOMER_ACCOUNT, ...registeredAccounts.filter((account) => account.email !== DEMO_CUSTOMER_ACCOUNT.email)];
  const findAccount = (value) => accounts.find((account) => account.email.toLowerCase() === String(value).toLowerCase() || account.phone === value);

  const show = (nextMode) => {
    setMode(nextMode);
    setStage('form');
    setError('');
    setNotice('');
    setCode('');
    setAttempts(0);
  };

  const sendCode = (destination) => {
    setStage('code');
    setCode('');
    setError('');
    setAttempts(0);
    setSecondsLeft(CODE_LIFETIME_SECONDS);
    setResendIn(RESEND_COOLDOWN_SECONDS);
    setNotice(`If these details can be used, a code has been sent to ${masked(destination)}. While this runs on browser storage the code is ${DEMO_CODE}.`);
  };

  const submitCreate = (event) => {
    event.preventDefault();
    if (form.password.length < MIN_PASSWORD_LENGTH) return setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (form.password !== form.confirmPassword) return setError('The two passwords do not match.');
    return sendCode(form.phone || form.email);
  };

  const submitLogin = (event) => {
    event.preventDefault();
    if (!authenticateCustomer(identifier.trim(), form.password)) {
      return setError('Those details did not match an account. Check them, or reset your password.');
    }
    return navigate(next, { replace: true });
  };

  const submitRecovery = (event) => {
    event.preventDefault();
    sendCode(identifier);
  };

  const verifyCode = (event) => {
    event.preventDefault();
    if (expired) return setError('That code has expired. Send a new one to continue.');
    if (locked) return setError('Too many attempts. Send a new code before trying again.');
    if (code !== DEMO_CODE) {
      const used = attempts + 1;
      setAttempts(used);
      const left = MAX_ATTEMPTS - used;
      return setError(left > 0 ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many attempts. Send a new code before trying again.');
    }
    setError('');
    if (mode === 'create') {
      // Neutral wording either way: this page never confirms whether an
      // address already has an account against it.
      return setStage(findAccount(form.email) || findAccount(form.phone) ? 'guidance' : 'consent');
    }
    return setStage(findAccount(identifier) ? 'password' : 'guidance');
  };

  const acceptConsent = (record) => {
    registerCustomerAccount({
      fullName: form.fullName,
      email: form.email,
      phone: form.phone,
      password: form.password,
      consentTimestamp: record?.acceptedAt || new Date().toISOString(),
    });
    setConsent(true, record);
    setStage('done');
  };

  const savePassword = (event) => {
    event.preventDefault();
    if (newPassword.value.length < MIN_PASSWORD_LENGTH) return setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (newPassword.value !== newPassword.confirm) return setError('The two passwords do not match.');
    resetCustomerPassword(identifier, newPassword.value);
    show('login');
    return setNotice('Your password has been changed. Sign in with it below.');
  };

  const heading = stage === 'code' ? 'Confirm it is you'
    : stage === 'password' ? 'Choose a new password'
    : mode === 'create' ? 'Create your account'
    : mode === 'recover' ? 'Reset your password'
    : 'Sign in to InsurShield';

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
              <Alert text={notice} tone="notice" />

              <div className="rounded-xl border border-dashed border-line-strong bg-canvas-2 p-4">
                <Meta className="text-ink-muted">Prototype account</Meta>
                <dl className="mt-3 space-y-1 text-[13px] text-ink">
                  <div className="flex gap-2"><dt className="text-ink-muted">Email</dt><dd className="break-all font-mono">{DEMO_CUSTOMER_ACCOUNT.email}</dd></div>
                  <div className="flex gap-2"><dt className="text-ink-muted">Password</dt><dd className="font-mono">{DEMO_CUSTOMER_ACCOUNT.password}</dd></div>
                </dl>
                <button
                  type="button"
                  onClick={() => {
                    setIdentifier(DEMO_CUSTOMER_ACCOUNT.email);
                    setForm((current) => ({ ...current, password: DEMO_CUSTOMER_ACCOUNT.password }));
                    setError('');
                    setNotice('Prototype details filled in. Select Sign in to continue.');
                  }}
                  className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-dashed border-line-strong bg-canvas px-3 text-[13px] font-medium text-primary transition-colors duration-200 ease-out hover:border-primary"
                >
                  Fill them in
                </button>
              </div>

              <Submit>Sign in</Submit>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <TextLink onClick={() => show('create')}>Create an account</TextLink>
                <TextLink onClick={() => show('recover')}>Forgotten your password?</TextLink>
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
              <Submit>Continue</Submit>
              <TextLink onClick={() => show('login')} block>I already have an account</TextLink>
            </form>
          )}

          {stage === 'form' && mode === 'recover' && (
            <form onSubmit={submitRecovery} className="space-y-5">
              <p className="text-[15px] leading-[1.6] text-ink-muted">
                Enter the email address or mobile number on the account. If it can be used for recovery, a code is sent to it.
              </p>
              <Field label="Email address or mobile number">
                <input required value={identifier} onChange={(event) => setIdentifier(event.target.value)} className={fieldClass} placeholder="name@email.com or 0970 123 456" />
              </Field>
              <Alert text={error} />
              <Submit>Send a code</Submit>
              <TextLink onClick={() => show('login')} block>Back to sign in</TextLink>
            </form>
          )}

          {stage === 'code' && (
            <form onSubmit={verifyCode} className="space-y-5">
              <p className="text-[15px] leading-[1.6] text-ink-muted">{notice}</p>

              <p className={`rounded-xl border border-dashed p-3.5 text-center font-mono text-[12px] uppercase tracking-[0.1em] ${expired ? 'border-primary text-primary' : 'border-line-strong text-ink-muted'}`}>
                {expired ? 'Code expired' : `Expires in ${clock(secondsLeft)}`}
              </p>

              <div>
                <span className={labelClass}>Verification code</span>
                <div className="flex gap-3">
                  {[0, 1, 2, 3].map((index) => (
                    <input
                      key={index}
                      ref={(element) => { codeInputs.current[index] = element; }}
                      aria-label={`Digit ${index + 1}`}
                      inputMode="numeric"
                      autoComplete={index === 0 ? 'one-time-code' : 'off'}
                      maxLength={4}
                      disabled={expired || locked}
                      value={code[index] || ''}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/\D/g, '');
                        const boxes = Array.from({ length: 4 }, (_, box) => code[box] || '');
                        // A pasted or auto-filled code fills the boxes from here on.
                        if (digits.length > 1) digits.slice(0, 4 - index).split('').forEach((digit, offset) => { boxes[index + offset] = digit; });
                        else boxes[index] = digits.slice(-1);
                        setCode(boxes.join(''));
                        const focus = Math.min(3, index + Math.max(1, digits.length));
                        if (digits && focus > index) codeInputs.current[focus]?.focus();
                      }}
                      onKeyDown={(event) => { if (event.key === 'Backspace' && !code[index] && index > 0) codeInputs.current[index - 1]?.focus(); }}
                      className={`${fieldClass} h-14 text-center font-mono text-[20px] disabled:opacity-50`}
                    />
                  ))}
                </div>
              </div>

              <Alert text={error} />
              <Submit disabled={code.length !== 4 || expired || locked}>Confirm</Submit>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <TextLink onClick={() => { if (resendIn === 0) sendCode(mode === 'create' ? form.phone || form.email : identifier); }} disabled={resendIn > 0}>
                  {resendIn > 0 ? `Send a new code in ${clock(resendIn)}` : 'Send a new code'}
                </TextLink>
                <TextLink onClick={() => { setStage('form'); setError(''); }}>Change details</TextLink>
              </div>
            </form>
          )}

          {stage === 'password' && (
            <form onSubmit={savePassword} className="space-y-5">
              <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
                <input required type="password" value={newPassword.value} onChange={(event) => setNewPassword({ ...newPassword, value: event.target.value })} className={fieldClass} autoComplete="new-password" />
              </Field>
              <Field label="Confirm new password">
                <input required type="password" value={newPassword.confirm} onChange={(event) => setNewPassword({ ...newPassword, confirm: event.target.value })} className={fieldClass} autoComplete="new-password" />
              </Field>
              <Alert text={error} />
              <Submit>Save the new password</Submit>
            </form>
          )}

          {stage === 'guidance' && (
            <Outcome
              icon="info"
              title="Carry on from the sign-in page"
              body="If these details are already connected to an account, sign in with them or reset the password. We do not confirm either way, which is what keeps an account private."
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

function Submit({ children, disabled = false }) {
  return (
    <Button
      type="submit"
      disabled={disabled}
      size="lg"
      className="min-h-12 w-full"
    >
      {children}
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
