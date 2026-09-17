import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useStore } from '../store/useStore';

const ROLES = [
  {
    id: 'admin',
    label: 'Super Admin',
    icon: 'admin_panel_settings',
    desc: 'Manage insurers, PIA configuration and system settings',
    color: 'border-primary bg-primary/5',
    activeColor: 'border-primary bg-primary text-white',
  },
  {
    id: 'insurer',
    label: 'Insurer Portal',
    icon: 'business',
    desc: 'Process claims, quotes, and NCD applications',
    color: 'border-primary/30 bg-primary/5',
    activeColor: 'border-primary bg-primary text-white',
  },
];

// Demo credentials per role
const CREDENTIALS = {
  admin:   { email: 'admin@insurshield.zm',   password: 'admin123' },
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

  const handleRoleSelect = (r) => {
    setRole(r);
    setError('');
    // Pre-fill demo credentials
    setEmail(CREDENTIALS[r].email);
    setPassword(CREDENTIALS[r].password);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    setError('');
    const expected = CREDENTIALS[role];
    if (email.trim() !== expected.email || password !== expected.password) {
      setError('Invalid credentials. Use the demo credentials shown above each role.');
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

  const selectedRole = ROLES.find(r => r.id === role);

  return (
    <div className="flex min-h-[calc(100vh-80px)] justify-center items-center bg-slate-50 px-5 py-14">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/30">
            <span className="material-symbols-outlined text-white text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>
              {selectedRole?.icon || 'admin_panel_settings'}
            </span>
          </div>
          <h1 className="text-[38px] font-extrabold tracking-[-.04em] text-primary">InsurShield Portal</h1>
          <p className="text-[17px] text-secondary mt-2">Sign in with your role to continue</p>
        </div>

        {/* Role Selector */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-secondary mb-3">Select Your Role</p>
          <div className="grid grid-cols-2 gap-3">
            {ROLES.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => handleRoleSelect(r.id)}
                className={`min-h-28 p-3 rounded-xl border-2 text-center transition-all ${
                  role === r.id ? r.activeColor : `${r.color} hover:shadow-sm`
                }`}
              >
                <span className={`material-symbols-outlined text-2xl mb-1 block ${role === r.id ? 'text-white' : ''}`}
                  style={{ fontVariationSettings: "'FILL' 1" }}>
                  {r.icon}
                </span>
                <p className={`text-[11px] font-bold leading-tight ${role === r.id ? 'text-white' : 'text-primary'}`}>{r.label}</p>
              </button>
            ))}
          </div>
          <p className="text-[12px] text-secondary mt-3 text-center">{selectedRole?.desc}</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          {/* Demo hint */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-5 flex items-start gap-2">
            <span className="material-symbols-outlined text-blue-600 text-[16px] mt-0.5">info</span>
            <div>
              <p className="text-[12px] text-blue-800 font-semibold">Demo Credentials</p>
              <p className="text-[11px] text-blue-700 mt-0.5 font-mono">
                {CREDENTIALS[role].email} / {CREDENTIALS[role].password}
              </p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="text-[12px] font-bold tracking-wider text-on-surface-variant uppercase block mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                placeholder={`e.g. ${CREDENTIALS[role].email}`}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-[15px] focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div>
              <label className="text-[12px] font-bold tracking-wider text-on-surface-variant uppercase block mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 pr-12 text-[15px] focus:ring-2 focus:ring-primary outline-none"
                />
                <button type="button" onClick={() => setShowPwd(v => !v)}
                  className="absolute right-3 top-3 text-secondary hover:text-primary">
                  <span className="material-symbols-outlined text-[20px]">{showPwd ? 'visibility_off' : 'visibility'}</span>
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 p-3 rounded-xl">
                <span className="material-symbols-outlined text-red-600 text-[16px]">error</span>
                <p className="text-[13px] text-red-800">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!email || !password || loading}
              className="w-full bg-primary text-white font-bold text-[16px] py-4 rounded-xl shadow-lg shadow-primary/25 hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <><span className="material-symbols-outlined animate-spin text-[20px]">sync</span> Signing in...</>
              ) : (
                <><span className="material-symbols-outlined text-[20px]">{selectedRole?.icon}</span> Sign in as {selectedRole?.label}</>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[12px] text-secondary mt-4">
          InsurShield Admin Portal · Restricted Access
        </p>
      </motion.div>
    </div>
  );
}
