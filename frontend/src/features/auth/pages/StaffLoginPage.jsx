import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { fieldClass as inputClass } from '@/components/ui/field';
import Meta from '@/components/ui/Meta';

const ROLES = [
  {
    id: 'admin',
    label: 'Administrator',
    icon: 'admin_panel_settings',
    desc: 'Onboard insurers, set the PIA floor, look up customer accounts.',
  },
  {
    id: 'insurer',
    label: 'Insurer portal',
    icon: 'business',
    desc: 'Quote requests, paid policies, claim notifications and NCD.',
  },
];

/**
 * Prototype credentials. Authentication still runs against these constants
 * rather than Keycloak, so they are shown on screen deliberately — hiding them
 * would suggest this screen is doing more than it is.
 */
const CREDENTIALS = {
  admin: { email: 'admin@insurshield.zm', password: 'admin123' },
  insurer: { email: 'insurer@insurshield.zm', password: 'insurer123' },
};


export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const navigate = useNavigate();
  const startStaffSession = useStore((state) => state.startStaffSession);

  const handleRoleSelect = (next) => {
    setRole(next);
    setError('');
    setEmail(CREDENTIALS[next].email);
    setPassword(CREDENTIALS[next].password);
  };

  const handleLogin = (event) => {
    event.preventDefault();
    setError('');
    const expected = CREDENTIALS[role];
    if (email.trim() !== expected.email || password !== expected.password) {
      setError('Those details do not match. Use the prototype credentials shown below.');
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      const name = role === 'insurer' ? 'Prestige Assurance' : 'Admin';
      startStaffSession({ role, name });
      navigate(role === 'insurer' ? '/insurer' : '/admin', { replace: true });
    }, 900);
  };

  const selectedRole = ROLES.find((item) => item.id === role);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto grid w-full max-w-[1100px] border border-line lg:grid-cols-[0.9fr_1.1fr]"
    >
      {/* ── What lies behind the door ───────────────────────────── */}
      <aside className="relative overflow-hidden bg-ink p-8 sm:p-10 lg:p-12">
        <div className="hatch pointer-events-none absolute inset-0 text-white/[0.06]" aria-hidden="true" />
        {['left-4 top-4 border-l border-t', 'right-4 top-4 border-r border-t', 'left-4 bottom-4 border-b border-l', 'right-4 bottom-4 border-b border-r'].map((position) => (
          <span key={position} className={`pointer-events-none absolute h-3 w-3 border-white/25 ${position}`} aria-hidden="true" />
        ))}

        <div className="relative">
          <span className="inline-flex items-center gap-3">
            <span className="dot-pulse block h-[5px] w-[5px] rounded-full bg-primary" aria-hidden="true" />
            <Meta className="text-white/50">Restricted access</Meta>
          </span>

          <h1 className="mt-7 text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] text-white sm:text-[36px]">
            Staff and insurer portal
          </h1>
          <p className="mt-5 max-w-sm text-[15px] leading-[1.6] text-white/60">
            Separate from the customer site. Each account sees only the work that belongs to it.
          </p>

          <div className="mt-10 border-t border-white/15 pt-8">
            {ROLES.map((item, index) => (
              <div key={item.id} className={`flex gap-4 ${index === 0 ? '' : 'mt-6 border-t border-dashed border-white/10 pt-6'}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[1px] border border-dashed border-white/25 text-primary">
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{item.icon}</span>
                </span>
                <div>
                  <p className="text-[14px] font-medium text-white">{item.label}</p>
                  <p className="mt-1.5 text-[13px] leading-[1.5] text-white/45">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <span aria-hidden="true" className="mt-10 flex items-center gap-1.5">
            {Array.from({ length: 14 }, (_, index) => (
              <span
                key={index}
                className="dot-pulse block h-[3px] w-[3px] rounded-full bg-primary"
                style={{ animationDelay: `${index * 0.09}s` }}
              />
            ))}
          </span>
        </div>
      </aside>

      {/* ── Sign in ─────────────────────────────────────────────── */}
      <main className="bg-canvas p-8 sm:p-10 lg:p-12">
        <Meta className="text-ink-muted">Sign in as</Meta>

        <div role="radiogroup" aria-label="Portal" className="mt-5 grid grid-cols-2 gap-3">
          {ROLES.map((item) => {
            const active = role === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleRoleSelect(item.id)}
                className={`flex flex-col items-start gap-3 rounded-[1px] border p-4 text-left transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  active ? 'ticked border-primary bg-primary/[0.03]' : 'border-line hover:border-line-strong'
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-[1px] border transition-colors duration-200 ease-out ${
                    active ? 'border-primary bg-primary text-white' : 'border-dashed border-line-strong text-primary'
                  }`}
                >
                  <span className="material-symbols-outlined text-[19px]" aria-hidden="true">{item.icon}</span>
                </span>
                <span className={`text-[14px] font-medium tracking-[-0.01em] ${active ? 'text-primary' : 'text-ink'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        <form onSubmit={handleLogin} className="mt-8 space-y-6">
          <label className="block">
            <Meta className="mb-2 block text-ink-muted">Email address</Meta>
            <input
              type="email"
              autoComplete="username"
              placeholder={CREDENTIALS[role].email}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className={inputClass}
            />
          </label>

          <label className="block">
            <Meta className="mb-2 block text-ink-muted">Password</Meta>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className={`${inputClass} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPwd((current) => !current)}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-3 text-ink-faint transition-colors duration-200 ease-out hover:text-primary"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                  {showPwd ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </label>

          {error && (
            <p role="alert" className="flex items-start gap-2.5 rounded-[1px] border border-primary bg-primary/[0.04] p-3.5 text-[13px] leading-[1.5] text-primary">
              <span className="material-symbols-outlined mt-px shrink-0 text-[16px]" aria-hidden="true">error</span>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!email || !password || loading}
            className="group relative flex min-h-[52px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-[1px] bg-primary text-[15px] font-medium text-white transition-colors duration-200 ease-out hover:bg-[#b91c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border disabled:border-dashed disabled:border-line-strong disabled:bg-canvas disabled:text-ink-faint disabled:hover:bg-canvas"
          >
            <span className="beam pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/20" aria-hidden="true" />
            <span className="material-symbols-outlined relative text-[19px]" aria-hidden="true">
              {loading ? 'sync' : selectedRole?.icon}
            </span>
            <span className="relative">{loading ? 'Signing in…' : `Continue to ${selectedRole?.label.toLowerCase()}`}</span>
          </button>
        </form>

        {/* This screen does not authenticate against Keycloak yet, so the
            credentials are stated plainly rather than implied. */}
        <div className="mt-8 border border-dashed border-line-strong p-4">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[16px] text-primary" aria-hidden="true">info</span>
            <Meta className="text-ink-muted">Prototype credentials</Meta>
          </div>
          <p className="mt-3 font-mono text-[12px] text-ink">
            {CREDENTIALS[role].email} · {CREDENTIALS[role].password}
          </p>
          <button
            type="button"
            onClick={() => handleRoleSelect(role)}
            className="mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-primary underline-offset-4 hover:underline"
          >
            Fill them in
          </button>
          <p className="mt-4 border-t border-dashed border-line pt-3 text-[12px] leading-[1.5] text-ink-faint">
            Staff sign-in does not yet run through Keycloak. These accounts exist only in this
            browser and grant no access to real data.
          </p>
        </div>
      </main>
    </motion.div>
  );
}
