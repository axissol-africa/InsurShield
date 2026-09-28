import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '@/store';
import { signIn, signUp } from '@/lib/keycloak';
import { apiClient } from '@/lib/apiClient';
import Meta from '@/components/ui/Meta';
import ConsentModal from '@/features/auth/components/ConsentModal';

/**
 * The entry point to an account.
 *
 * Sign-in and sign-up happen on Keycloak, so this page never handles a
 * password. It does two things: send the visitor to Keycloak with their
 * intended destination preserved, and — once they return — collect the privacy
 * and terms acceptance that the customer-entry flow requires before any
 * protected step. Authenticating is not consenting; the two are separate.
 */

/** Explains why a guest landed here and what is waiting for them after sign-in. */
const RESUME_CONTEXT = {
  '/quote-request': { icon: 'send', text: 'Your vehicle details are saved. Sign in or create an account to send your request to every insurer.' },
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
  const { isAuthenticated, consentAccepted, customer } = useStore();

  const next = searchParams.get('next') || '/account';
  const wantsSignUp = searchParams.get('mode') === 'create';
  const resumeContext =
    RESUME_CONTEXT[next.split('?')[0]] ||
    (location.state?.reason === 'account-required' ? RESUME_CONTEXT.default : null);

  const [redirecting, setRedirecting] = useState(false);
  const [consentError, setConsentError] = useState('');

  // Already signed in and consented — nothing to do here.
  useEffect(() => {
    if (isAuthenticated && consentAccepted) navigate(next, { replace: true });
  }, [isAuthenticated, consentAccepted, navigate, next]);

  const go = (action) => {
    setRedirecting(true);
    // Keycloak returns to this page so consent can be collected before the
    // customer continues to their original destination.
    action(`/create-account?next=${encodeURIComponent(next)}`);
  };

  if (isAuthenticated && !consentAccepted) {
    // The modal has already recorded the acceptance locally; this writes the
    // auditable record against the account so it survives signing out.
    const recordConsent = async (record) => {
      try {
        await apiClient.post('/auth/consent', { noticeVersion: record?.noticeVersion ?? 'unknown' });
        navigate(next, { replace: true });
      } catch (error) {
        setConsentError(error.message || 'Your acceptance could not be saved. Please try again.');
      }
    };

    return (
      <>
        {consentError && (
          <p role="alert" className="fixed inset-x-0 top-20 z-[110] mx-auto max-w-lg border border-primary bg-canvas px-4 py-3 text-[14px] text-primary">
            {consentError}
          </p>
        )}
        <ConsentModal
          onAccept={recordConsent}
          onDecline={() => navigate('/', { replace: true })}
        />
      </>
    );
  }

  return (
    <main className="relative overflow-hidden">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.45]" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-[520px] px-6 py-16 lg:py-24">
        <span className="inline-flex items-center gap-3 border border-dashed border-line-strong bg-canvas px-3 py-1.5">
          <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
          <Meta className="text-ink-muted">Your account</Meta>
        </span>

        <h1 className="mt-7 text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[42px]">
          {wantsSignUp ? 'Create your account' : 'Sign in to InsurShield'}
        </h1>

        {resumeContext && (
          <div className="mt-7 flex gap-4 border border-dashed border-line-strong p-5">
            <span className="material-symbols-outlined shrink-0 text-[20px] text-primary" aria-hidden="true">
              {resumeContext.icon}
            </span>
            <p className="text-[14px] leading-[1.55] text-ink-muted">{resumeContext.text}</p>
          </div>
        )}

        <p className="mt-7 text-[16px] leading-[1.6] text-ink-muted">
          You will be taken to our secure sign-in service to continue. Your password is never
          entered on this page.
        </p>

        <div className="mt-9 flex flex-col gap-3">
          <button
            type="button"
            disabled={redirecting}
            onClick={() => go(wantsSignUp ? signUp : signIn)}
            className="group relative inline-flex min-h-[52px] items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary px-7 text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] disabled:pointer-events-none disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
            <span className="relative">
              {redirecting ? 'Taking you there…' : wantsSignUp ? 'Create account' : 'Sign in'}
            </span>
            <span className="material-symbols-outlined relative text-[18px] transition-transform duration-200 ease-out group-hover:translate-x-1" aria-hidden="true">arrow_forward</span>
          </button>

          <button
            type="button"
            disabled={redirecting}
            onClick={() => go(wantsSignUp ? signIn : signUp)}
            className="inline-flex min-h-[52px] items-center justify-center rounded-[1px] border border-dashed border-line-strong bg-canvas px-7 text-[15px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary disabled:pointer-events-none disabled:border-line disabled:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {wantsSignUp ? 'I already have an account' : 'Create an account'}
          </button>
        </div>

        {customer && (
          <p className="mt-8 text-[13px] text-ink-faint">Signed in as {customer.email}.</p>
        )}

        <div className="mt-12 border-t border-line pt-6">
          <Meta className="text-ink-faint">Forgotten your password?</Meta>
          <p className="mt-3 text-[14px] leading-[1.55] text-ink-muted">
            Choose <span className="text-ink">Forgot Password</span> on the sign-in page to have a
            reset link sent to your email address.
          </p>
        </div>
      </div>
    </main>
  );
}
