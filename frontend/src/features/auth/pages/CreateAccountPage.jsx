import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { DEMO_CUSTOMER_ACCOUNT, useStore } from '@/store';
import ConsentModal from '@/features/auth/components/ConsentModal';

const OTP_CODE = '1234';

/** Explains why a guest landed here and what is waiting for them after sign-in. */
const RESUME_CONTEXT = {
  '/quote-request': { icon: 'send', text: 'Your vehicle details are saved. Sign in or create an account to send your request to every insurer.' },
  '/quotes-comparison': { icon: 'compare_arrows', text: 'Sign in to see the quotes insurers have sent you.' },
  '/claims': { icon: 'report_problem', text: 'Claims are linked to your account so you can return to them any time.' },
  '/renewal': { icon: 'autorenew', text: 'Sign in to renew a policy held in your account.' },
  '/account': { icon: 'person', text: 'Sign in to manage your policies, quotes and claims.' },
  default: { icon: 'lock', text: 'An account is needed for this step. Everything you have entered so far is saved.' },
};
const OTP_LIFETIME = 120;
const RESEND_COOLDOWN = 30;
const MAX_OTP_ATTEMPTS = 5;

const formatTime = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const maskIdentifier = value => {
  if (!value) return 'your contact method';
  if (value.includes('@')) { const [name, domain] = value.split('@'); return `${name.slice(0, 2)}•••@${domain}`; }
  return `${value.slice(0, 3)}•••${value.slice(-2)}`;
};

export default function CreateAccountPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const next = searchParams.get('next') || '/account';
  const resumeContext = RESUME_CONTEXT[next.split('?')[0]] || (location.state?.reason === 'account-required' ? RESUME_CONTEXT.default : null);
  const { registeredAccounts, registerCustomerAccount, authenticateCustomer, resetCustomerPassword, seedDemoAccount } = useStore();
  const [mode, setMode] = useState(() => (searchParams.get('mode') === 'create' ? 'create' : 'login'));
  const [stage, setStage] = useState('form');
  const [details, setDetails] = useState({ fullName: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(OTP_LIFETIME);
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN);
  const [otpExpired, setOtpExpired] = useState(false);
  const [deliveryState, setDeliveryState] = useState('sent');
  const otpInputs = useRef([]);

  useEffect(() => { seedDemoAccount(); }, [seedDemoAccount]);
  useEffect(() => {
    if (stage !== 'otp') return undefined;
    const timer = window.setInterval(() => {
      setSecondsLeft(value => {
        if (value <= 1) { setOtpExpired(true); return 0; }
        return value - 1;
      });
      setResendIn(value => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  const allAccounts = [DEMO_CUSTOMER_ACCOUNT, ...registeredAccounts.filter(account => account.email !== DEMO_CUSTOMER_ACCOUNT.email)];
  const matchingAccount = (value = identifier) => allAccounts.find(account => account.email.toLowerCase() === value.toLowerCase() || account.phone === value);
  const resetView = nextMode => { setMode(nextMode); setStage('form'); setError(''); setNotice(''); setOtp(''); setAttempts(0); setOtpExpired(false); };
  const beginOtp = destination => {
    setStage('otp'); setOtp(''); setError(''); setAttempts(0); setOtpExpired(false); setSecondsLeft(OTP_LIFETIME); setResendIn(RESEND_COOLDOWN); setDeliveryState('sent');
    setNotice(`If these details can be used for this request, a verification code has been sent to ${maskIdentifier(destination)}. For this prototype, use ${OTP_CODE}.`);
  };

  const submitCreate = event => {
    event.preventDefault();
    if (details.password.length < 8) return setError('Choose a password with at least 8 characters.');
    if (details.password !== details.confirmPassword) return setError('The passwords do not match.');
    beginOtp(details.phone || details.email);
  };
  const submitLogin = event => {
    event.preventDefault();
    if (!authenticateCustomer(identifier.trim(), details.password)) return setError('We could not sign you in with those details. Check them, try again, or reset your password.');
    navigate(next, { replace: true });
  };
  const useDemoCredentials = () => {
    setIdentifier(DEMO_CUSTOMER_ACCOUNT.email);
    setDetails(current => ({ ...current, password: DEMO_CUSTOMER_ACCOUNT.password }));
    setError('');
    setNotice('Demo credentials added. Select Log in to continue.');
  };
  const submitRecovery = event => { event.preventDefault(); beginOtp(identifier); };
  const resend = () => {
    if (resendIn > 0) return;
    beginOtp(mode === 'create' ? details.phone || details.email : identifier);
  };
  const verifyOtp = event => {
    event.preventDefault();
    if (otpExpired) return setError('This code has expired. Send a new code to continue.');
    if (attempts >= MAX_OTP_ATTEMPTS) return setError('Too many attempts. For your security, request a new code before trying again.');
    if (otp !== OTP_CODE) {
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      return setError(nextAttempts >= MAX_OTP_ATTEMPTS ? 'Too many attempts. For your security, request a new code before trying again.' : `That code is not correct. Please try again (${MAX_OTP_ATTEMPTS - nextAttempts} attempt${MAX_OTP_ATTEMPTS - nextAttempts === 1 ? '' : 's'} left).`);
    }
    setError('');
    if (mode === 'create') return matchingAccount(details.email) || matchingAccount(details.phone) ? setStage('account-guidance') : setStage('consent');
    return matchingAccount() ? setStage('password') : setStage('recovery-complete');
  };
  const acceptConsent = () => { registerCustomerAccount({ fullName: details.fullName, email: details.email, phone: details.phone, password: details.password, consentTimestamp: new Date().toISOString() }); setStage('success'); };
  const savePassword = event => {
    event.preventDefault();
    if (newPassword.length < 8) return setError('Choose a password with at least 8 characters.');
    if (newPassword !== confirmPassword) return setError('The passwords do not match.');
    resetCustomerPassword(identifier, newPassword); resetView('login'); setNotice('Your password has been updated. You can now sign in.');
  };
  const title = mode === 'create' ? 'Create your account' : mode === 'login' ? 'Log in to your account' : 'Reset your password';

  return <main className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4 py-10"><motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl">
    <header className="bg-primary px-7 py-6 text-white"><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">Your InsurShield account</p><h1 className="mt-1 text-[27px] font-bold">{stage === 'otp' ? 'Verify your identity' : title}</h1><p className="mt-2 text-[13px] text-white/80">Explore freely as a guest. An account keeps your quotes, policies and claims in one place.</p></header>
    <div className="p-6 md:p-7">
      {resumeContext && stage === 'form' && <p className="mb-5 flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 p-3 text-[13px] leading-5 text-on-surface"><span className="material-symbols-outlined text-[20px] text-primary" aria-hidden="true">{resumeContext.icon}</span>{resumeContext.text}</p>}
      {stage === 'form' && mode === 'create' && <form onSubmit={submitCreate} className="space-y-4"><Field label="Full name"><input required value={details.fullName} onChange={e => setDetails({ ...details, fullName: e.target.value })} placeholder="e.g. Mwiza Banda" /></Field><Field label="Email address"><input required type="email" value={details.email} onChange={e => setDetails({ ...details, email: e.target.value })} placeholder="e.g. mwiza@email.com" /></Field><Field label="Mobile number"><input required type="tel" value={details.phone} onChange={e => setDetails({ ...details, phone: e.target.value })} placeholder="e.g. 0970 123 456" /></Field><Field label="Password"><input required type="password" value={details.password} onChange={e => setDetails({ ...details, password: e.target.value })} placeholder="At least 8 characters" /></Field><Field label="Confirm password"><input required type="password" value={details.confirmPassword} onChange={e => setDetails({ ...details, confirmPassword: e.target.value })} placeholder="Enter password again" /></Field><Error text={error} /><Primary>Continue securely</Primary><ModeLink onClick={() => resetView('login')}>Already have an account? Sign in</ModeLink></form>}
      {stage === 'form' && mode === 'login' && <form onSubmit={submitLogin} className="space-y-4"><Field label="Email address or mobile number"><input required value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="name@email.com or 0970 123 456" /></Field><Field label="Password"><input required type="password" value={details.password} onChange={e => setDetails({ ...details, password: e.target.value })} placeholder="Enter your password" /></Field><Error text={error} /><Notice text={notice} /><div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-[12px] text-on-surface-variant"><p className="font-bold text-primary">Prototype customer access</p><p className="mt-1 break-all"><strong>Email:</strong> {DEMO_CUSTOMER_ACCOUNT.email}</p><p><strong>Password:</strong> {DEMO_CUSTOMER_ACCOUNT.password}</p><button type="button" onClick={useDemoCredentials} className="mt-3 rounded-lg border border-primary/30 bg-white px-3 py-2 font-bold text-primary transition-colors hover:bg-primary/5">Use demo credentials</button></div><Primary>Log in</Primary><div className="flex items-center justify-between pt-1"><button type="button" onClick={() => resetView('create')} className="text-[12px] font-semibold text-primary hover:underline">Don't have an account? Create here</button><button type="button" onClick={() => resetView('recover')} className="text-[12px] font-semibold text-primary hover:underline">Forgot password?</button></div></form>}
      {stage === 'form' && mode === 'recover' && <form onSubmit={submitRecovery} className="space-y-4"><p className="text-[13px] leading-6 text-secondary">Enter your email address or mobile number. If it can be used for recovery, we will send a verification code.</p><div className="rounded-xl border border-primary/15 bg-primary/5 p-3 text-[12px] leading-5 text-on-surface-variant"><strong className="text-primary">Prototype test:</strong> enter any email address or mobile number. After you verify code <strong>1234</strong>, the outcome always uses neutral wording and never reveals whether an account exists.</div><Field label="Email address or mobile number"><input required value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="name@email.com or 0970 123 456" /></Field><Error text={error} /><Primary>Send verification code</Primary><ModeLink onClick={() => resetView('login')}>Back to sign in</ModeLink></form>}
      {stage === 'otp' && <OtpVerification otp={otp} setOtp={setOtp} inputs={otpInputs} onSubmit={verifyOtp} notice={notice} error={error} secondsLeft={secondsLeft} resendIn={resendIn} expired={otpExpired} attempts={attempts} onResend={resend} deliveryState={deliveryState} onDeliveryIssue={() => { setDeliveryState('service-error'); setError('We cannot send a code right now. Please try again shortly.'); }} onRetryDelivery={() => beginOtp(mode === 'create' ? details.phone || details.email : identifier)} onChangeDetails={() => { setStage('form'); setError(''); }} />}
      {stage === 'account-guidance' && <Outcome icon="info" title="Continue with your account" body="If these contact details are already connected to an account, sign in or use password recovery. This protects your account and keeps your details secure." action="Back to sign in" onAction={() => resetView('login')} />}
      {stage === 'recovery-complete' && <Outcome icon="mark_email_read" title="Check your messages" body="If an account can be recovered with these details, further instructions will be sent. You can safely return to sign in." action="Back to sign in" onAction={() => resetView('login')} />}
      {stage === 'password' && <form onSubmit={savePassword} className="space-y-4"><h2 className="text-[19px] font-bold text-primary">Choose a new password</h2><p className="text-[13px] text-secondary">Choose a password with at least eight characters.</p><Field label="New password"><input required type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 8 characters" /></Field><Field label="Confirm new password"><input required type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Enter password again" /></Field><Error text={error} /><Primary>Save new password</Primary></form>}
      {stage === 'success' && <Outcome icon="check_circle" success title="Your account is ready" body="Your account and required consent are set up. You can now request quotes, manage claims and renew a policy." action={resumeContext && next !== '/account' ? 'Continue where you left off' : 'Continue'} onAction={() => navigate(next, { replace: true })} />}
    </div>
    {stage === 'consent' && <ConsentModal onAccept={acceptConsent} onDecline={() => navigate('/', { replace: true })} />}
  </motion.section></main>;
}

function OtpVerification({ otp, setOtp, inputs, onSubmit, notice, error, secondsLeft, resendIn, expired, attempts, onResend, deliveryState, onDeliveryIssue, onRetryDelivery, onChangeDetails }) {
  const locked = attempts >= MAX_OTP_ATTEMPTS;
  const updateDigit = (index, value) => {
    const digits = value.replace(/\D/g, '');
    const next = Array.from({ length: 4 }, (_, digitIndex) => otp[digitIndex] || '');
    if (digits.length > 1) {
      // A pasted or auto-filled code fills the remaining boxes from this one.
      digits.slice(0, 4 - index).split('').forEach((digit, offset) => { next[index + offset] = digit; });
    } else {
      next[index] = digits.slice(-1);
    }
    setOtp(next.join(''));
    const focusIndex = Math.min(3, index + Math.max(1, digits.length));
    if (digits && focusIndex > index) inputs.current[focusIndex]?.focus();
  };
  return <form onSubmit={onSubmit} className="space-y-5"><div><h2 className="text-[19px] font-bold text-primary">Enter your 4-digit code</h2><p className="mt-1 text-[13px] leading-6 text-secondary">{notice}</p></div><div className="rounded-xl bg-surface-container-low p-3 text-center text-[12px] text-secondary"><strong className={expired ? 'text-red-700' : 'text-primary'}>{expired ? 'Code expired' : `Code expires in ${formatTime(secondsLeft)}`}</strong>{!expired && <span> · Keep this page open while you verify.</span>}</div><div><span className="mb-2 block text-[12px] font-bold uppercase tracking-wide text-secondary">Verification code</span><div className="flex justify-between gap-3">{[0, 1, 2, 3].map(index => <input key={index} ref={element => { inputs.current[index] = element; }} aria-label={`Digit ${index + 1}`} inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={4} disabled={expired || locked} value={otp[index] || ''} onChange={event => updateDigit(index, event.target.value)} onKeyDown={event => { if (event.key === 'Backspace' && !otp[index] && index > 0) inputs.current[index - 1]?.focus(); }} className="h-14 w-full rounded-xl border border-outline-variant bg-surface-container-low text-center text-xl font-bold text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50" />)}</div></div><Error text={error} />{deliveryState === 'service-error' && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-800"><p className="font-bold">Delivery is temporarily unavailable</p><p className="mt-1">Your account information remains protected. Please try sending a new code.</p><button type="button" onClick={onRetryDelivery} className="mt-3 rounded-lg bg-white px-3 py-2 text-[12px] font-bold text-primary shadow-sm">Try sending again</button></div>}<Primary disabled={otp.length !== 4 || expired || locked}>Verify & continue</Primary><div className="space-y-2 text-center"><p className="text-[12px] text-secondary">{locked ? 'For your security, request a new code before trying again.' : expired ? 'This code has expired.' : `Didn't receive a code? ${resendIn > 0 ? `Resend available in ${formatTime(resendIn)}.` : ''}`}</p><button type="button" onClick={onResend} disabled={resendIn > 0} className="text-[13px] font-bold text-primary underline underline-offset-4 disabled:cursor-not-allowed disabled:text-secondary">Send a new code</button><button type="button" onClick={onChangeDetails} className="ml-5 text-[13px] font-bold text-primary underline underline-offset-4">Change details</button>{deliveryState !== 'service-error' && <button type="button" onClick={onDeliveryIssue} className="block w-full text-[12px] font-semibold text-secondary hover:text-primary">Having delivery trouble?</button>}</div></form>;
}

function Outcome({ icon, title, body, action, onAction, success = false }) { return <div className="py-7 text-center"><span className={`material-symbols-outlined text-[64px] ${success ? 'text-primary' : 'text-primary'}`}>{icon}</span><h2 className="mt-3 text-2xl font-bold text-primary">{title}</h2><p className="mx-auto mt-2 max-w-sm text-[14px] leading-6 text-secondary">{body}</p><button onClick={onAction} className="mt-6 w-full rounded-xl bg-primary py-3.5 font-bold text-white">{action}</button></div>; }
function Field({ label, children }) { return <label className="block"><span className="mb-1.5 block text-[12px] font-bold uppercase tracking-wide text-secondary">{label}</span>{React.cloneElement(children, { className: `w-full rounded-xl border border-outline-variant bg-surface-container-low p-3 text-[15px] outline-none focus:ring-2 focus:ring-primary ${children.props.className || ''}` })}</label>; }
function Primary({ children, disabled = false }) { return <button type="submit" disabled={disabled} className="mt-2 w-full rounded-xl bg-primary py-3.5 font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-50">{children}</button>; }
function ModeLink({ children, onClick }) { return <button type="button" onClick={onClick} className="block w-full text-center text-[13px] font-bold text-primary hover:underline">{children}</button>; }
function Error({ text }) { return text ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-[12px] font-medium text-red-700">{text}</p> : null; }
function Notice({ text }) { return text ? <p className="rounded-xl bg-primary/5 px-4 py-3 text-[12px] font-medium text-primary">{text}</p> : null; }
