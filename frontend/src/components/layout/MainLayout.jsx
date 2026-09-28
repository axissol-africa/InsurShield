import { useEffect, useState } from 'react';
import { Outlet, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '@/store';
import { signOutOfKeycloak } from '@/lib/keycloak';

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
  const { isAuthenticated, customer, staffSession, endStaffSession } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);

  // Each journey step is a new page; start it at the top.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);

  const isPortal = PORTAL_ROUTES.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`));
  // The phone capture page needs no identity, and its Keycloak host is not
  // reachable from the phone — so it shows the brand alone, with nothing to
  // tap that would strand someone half way through their photos.
  const isCapture = location.pathname.startsWith('/capture/');
  const currentHref = `${location.pathname}${location.search}`;
  const loginHref = location.pathname === '/create-account' ? currentHref : `/create-account?next=${encodeURIComponent(currentHref)}`;

  // Ends the Keycloak session too, otherwise the next visit is silently
  // signed straight back in.
  const handleSignOut = () => {
    setMenuOpen(false);
    signOutOfKeycloak();
  };
  const handleStaffSignOut = () => {
    endStaffSession();
    navigate('/admin-login');
  };

  const links = [...CUSTOMER_LINKS, { to: '/admin-login', label: 'Staff portal' }];

  return (
    <div className="flex min-h-screen flex-col bg-background text-on-background selection:bg-primary/20">
      <header className="fixed top-0 z-50 flex h-20 w-full items-center border-b border-slate-200 bg-white px-5 lg:px-[5.5vw]">
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
          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
            {staffSession && (
              <>
                {/* Who is signed in: full name and portal on wider screens, a short role badge on phones. */}
                <span data-testid="portal-role" className="inline-flex items-center gap-1.5 rounded-[1px] border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-primary sm:hidden">
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
        <div className="fixed inset-0 top-20 z-40 md:hidden">
          {/* Tapping outside the sheet closes it. */}
          <div className="absolute inset-0 bg-black/30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <nav aria-label="Mobile" className="relative grid gap-1 border-b border-slate-200 bg-white p-4 shadow-lg">
            {isAuthenticated && <p className="px-4 pb-2 pt-1 text-[12px] font-bold uppercase tracking-wider text-secondary">Signed in as {customer?.fullName}</p>}
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.to === '/'} onClick={() => setMenuOpen(false)} className={({ isActive }) => `rounded-lg px-4 py-3 text-[15px] font-semibold ${isActive ? 'bg-primary/10 text-primary' : 'text-secondary'}`}>
                {link.label}
              </NavLink>
            ))}
            {isAuthenticated && <button type="button" onClick={handleSignOut} className="rounded-lg px-4 py-3 text-left text-[15px] font-semibold text-secondary">Sign out</button>}
          </nav>
        </div>
      )}

      <main className="flex-1 pt-20">
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
