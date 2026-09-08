import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';

const NAV_LINKS = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/account', label: 'My account', icon: 'shield' },
  { to: '/claims', label: 'Claims', icon: 'report_problem' },
  { to: '/support', label: 'Contact', icon: 'contacts' },
];

// Routes that get full-width dashboard treatment
const PORTAL_ROUTES = ['/admin', '/insurer', '/admin-login'];

export default function MainLayout() {
  const location = useLocation();
  const { isAuthenticated, customer, signOut } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (to) => location.pathname === to;
  const isPortal = PORTAL_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));

  return (
    <div className="min-h-screen flex flex-col bg-background text-on-background selection:bg-primary/20">
      {/* Top Nav */}
      <header className="fixed top-0 z-50 flex h-20 w-full items-center border-b border-slate-200 bg-white px-5 lg:px-[5.5vw]">
        <div className="flex min-w-0 items-center gap-4">
          <button onClick={() => setMenuOpen(value => !value)} aria-label="Open navigation" className="-ml-2 inline-flex h-10 w-10 items-center justify-center text-primary md:hidden">
            <span className="material-symbols-outlined text-[28px]">menu</span>
          </button>
          <Link to="/" className="font-serif text-[30px] leading-none tracking-[-0.05em] text-primary sm:text-[32px]">InsurShield</Link>
        </div>
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          {NAV_LINKS.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={`font-sans text-[15px] font-medium px-3 py-2 transition-colors ${isActive(link.to) ? 'text-primary font-bold' : 'text-gray-600 hover:text-primary'}`}
            >
              {link.label}
            </Link>
          ))}
          <Link to="/admin-login" className={`ml-2 font-sans text-[15px] font-medium px-3 py-2 transition-colors ${isPortal ? 'text-primary font-bold' : 'text-gray-600 hover:text-primary'}`}>
            Staff Portal
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {isAuthenticated ? <><Link to="/account" className="hidden text-[15px] font-bold text-on-surface sm:block">{customer?.fullName?.split(' ')[0]}</Link><span className="hidden h-5 w-px bg-slate-200 sm:block" /><button onClick={signOut} className="hidden text-[14px] font-medium text-secondary hover:text-primary sm:block">Sign out</button><Link to="/account" className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"><span className="material-symbols-outlined text-lg">person</span></Link></> : <Link to="/create-account?next=%2Fselect-insurers" className="rounded-lg bg-primary px-4 py-2 text-[13px] font-bold text-white hover:bg-primary-container">Log in</Link>}
        </div>
      </header>

      {menuOpen && <div className="fixed inset-x-0 top-20 z-40 border-b border-slate-200 bg-white p-4 shadow-lg md:hidden"><nav className="grid gap-1">{[...NAV_LINKS, { to: '/admin-login', label: 'Staff Portal' }].map(link => <Link key={link.to} onClick={() => setMenuOpen(false)} to={link.to} className={`rounded-lg px-4 py-3 text-[15px] font-semibold ${isActive(link.to) ? 'bg-primary/10 text-primary' : 'text-secondary'}`}>{link.label}</Link>)}</nav></div>}

      <main className="flex-1 pt-20">
        {isPortal ? (
          /* Portal pages: full-width background, centred content container */
          <div className="min-h-[calc(100vh-64px)] bg-gray-50/80">
            <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-10 py-8">
              <Outlet />
            </div>
          </div>
        ) : (
          /* Public pages: keep existing slim layout */
          <Outlet />
        )}
      </main>

    </div>
  );
}
