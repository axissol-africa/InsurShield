import { useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '@/store';

const CUSTOMER_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/account', label: 'My account' },
  { to: '/claims', label: 'Claims' },
  { to: '/support', label: 'Contact' },
];

const PORTAL_ROUTES = ['/admin', '/insurer', '/admin-login'];

const navClass = ({ isActive }) =>
  `px-3 py-2 text-[15px] transition-colors ${isActive ? 'font-bold text-primary' : 'font-medium text-gray-600 hover:text-primary'}`;

export default function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, customer, staffSession, endStaffSession, signOut } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);

  // Each journey step is a new page; start it at the top.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);

  const isPortal = PORTAL_ROUTES.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`));
  // Home is the approved marketing landing page. Keep its chrome independent
  // while application routes use the compact mobile/PWA shell below.
  const isHome = location.pathname === '/';
  // The phone capture page needs no identity — so it shows the brand alone,
  // with nothing to tap that would strand someone half way through their
  // photos.
  const isCapture = location.pathname.startsWith('/capture/');
  const currentHref = `${location.pathname}${location.search}`;
  const loginHref = location.pathname === '/create-account' ? currentHref : `/create-account?next=${encodeURIComponent(currentHref)}`;

  const handleSignOut = () => {
    setMenuOpen(false);
    signOut();
    navigate('/');
  };
  const handleStaffSignOut = () => {
    endStaffSession();
    navigate('/admin-login');
  };

  const links = [...CUSTOMER_LINKS, { to: '/admin-login', label: 'Staff portal' }];

  return (
    <div className={`flex min-h-screen flex-col text-on-background selection:bg-primary/20 ${isHome ? 'bg-background' : 'bg-canvas-2'}`}>
      <header className={`fixed top-0 z-50 flex w-full items-center border-b border-slate-200 bg-white ${isHome ? 'h-20 px-5 lg:px-[5.5vw]' : 'h-16 bg-white/95 px-4 shadow-[0_1px_0_rgba(10,10,10,0.03)] backdrop-blur-sm sm:h-20 sm:px-6 lg:px-[5.5vw]'}`}>
        <div className="flex min-w-0 items-center gap-4">
          {/* The staff portal has no customer navigation, so no hamburger. */}
          {!isPortal && !isCapture && (
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menuOpen}
              className="-ml-2 inline-flex h-10 w-10 items-center justify-center text-primary md:hidden"
            >
              <span className="material-symbols-outlined text-[28px]" aria-hidden="true">{menuOpen ? 'close' : 'menu'}</span>
            </button>
          )}
          {isCapture ? (
            <span className="font-serif text-[26px] leading-none tracking-[-0.05em] text-primary sm:text-[32px]">InsurShield</span>
          ) : (
            <Link to="/" onClick={() => setMenuOpen(false)} className="font-serif text-[26px] leading-none tracking-[-0.05em] text-primary sm:text-[32px]">InsurShield</Link>
          )}
        </div>

        {isCapture ? null : isPortal ? (
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            {staffSession && (
              <>
                {/* Who is signed in: full name and portal on wider screens, a short role badge on phones. */}
                <span data-testid="portal-role" className="inline-flex items-center gap-1.5 rounded-[1px] border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-primary max-[359px]:hidden sm:hidden">
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{staffSession.role === 'insurer' ? 'business' : 'admin_panel_settings'}</span>
                  {staffSession.role === 'insurer' ? 'Insurer' : 'Staff'}
                </span>
                <span className="hidden font-mono text-[12px] uppercase tracking-[0.1em] text-ink-faint sm:block">
                  <span className="text-ink">{staffSession.name}</span> · {staffSession.role === 'insurer' ? 'Insurer portal' : 'Staff portal'}
                </span>
                <button type="button" onClick={handleStaffSignOut} aria-label="Sign out" className="inline-flex h-9 items-center justify-center rounded-[1px] border border-dashed border-line-strong px-2.5 text-[13px] font-medium text-ink transition-colors duration-200 ease-out hover:border-primary hover:text-primary sm:px-4">
                  <span className="material-symbols-outlined text-[20px] sm:hidden" aria-hidden="true">logout</span>
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </>
            )}
            <Link to="/" aria-label="Customer site" className="inline-flex h-9 items-center justify-center text-[14px] font-medium text-secondary hover:text-primary">
              <span className="hidden sm:inline">Customer site</span>
              <span className="material-symbols-outlined text-[22px] sm:hidden" aria-hidden="true">home</span>
            </Link>
          </div>
        ) : (
          <>
            <nav aria-label="Primary" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
              {links.map((link) => <NavLink key={link.to} to={link.to} end={link.to === '/'} className={navClass}>{link.label}</NavLink>)}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  <Link to="/account" className="hidden text-[15px] font-bold text-on-surface sm:block">{customer?.fullName?.split(' ')[0]}</Link>
                  <span className="hidden h-5 w-px bg-slate-200 sm:block" aria-hidden="true" />
                  <button type="button" onClick={handleSignOut} className="hidden text-[14px] font-medium text-secondary hover:text-primary sm:block">Sign out</button>
                  <Link to="/account" aria-label="My account" onClick={() => setMenuOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-lg" aria-hidden="true">person</span>
                  </Link>
                </>
              ) : (
                <Link to={loginHref} onClick={() => setMenuOpen(false)} className="rounded-lg bg-primary px-4 py-2 text-[13px] font-bold text-white hover:bg-primary-container">Log in</Link>
              )}
            </div>
          </>
        )}
      </header>

      {menuOpen && !isPortal && !isCapture && (
        <div className={`fixed inset-x-0 bottom-0 z-40 md:hidden ${isHome ? 'top-20' : 'top-16'}`}>
          {/* Tapping outside the sheet closes it. */}
          <div className="absolute inset-0 bg-black/30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          {/* Sized to its own contents and scrollable if a phone is short, so
              the sheet never runs under the home indicator. */}
          <nav aria-label="Mobile" className="sheet-drop relative grid max-h-[calc(100dvh-4rem)] gap-1 overflow-y-auto overscroll-contain border-b border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg">
            {isAuthenticated && <p className="px-4 pb-2 pt-1 text-[12px] font-bold uppercase tracking-wider text-secondary">Signed in as {customer?.fullName}</p>}
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.to === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => `flex min-h-12 items-center rounded-lg px-4 text-[15px] font-semibold ${isActive ? 'bg-primary/10 text-primary' : 'text-secondary'}`}>
                {link.label}
              </NavLink>
            ))}
            {isAuthenticated && <button type="button" onClick={handleSignOut} className="flex min-h-12 items-center rounded-lg px-4 text-left text-[15px] font-semibold text-secondary">Sign out</button>}
          </nav>
        </div>
      )}

      <main className={`flex-1 ${isHome ? 'pt-20' : 'pwa-main pt-16 sm:pt-20'}`}>
        {isPortal ? (
          <div className="relative min-h-[calc(100vh-80px)] bg-canvas">
            <div className="blueprint pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden="true" />
            {/* Staff surfaces are data-dense tables and queues, so they use the
                full width of a desktop rather than a reading-width column. */}
            <div className="relative w-full px-4 py-8 sm:px-6 lg:px-10 2xl:px-16"><Outlet /></div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
