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
  const { isAuthenticated, customer, signOut, staffSession, endStaffSession } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);

  // Each journey step is a new page; start it at the top.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);

  const isPortal = PORTAL_ROUTES.some((route) => location.pathname === route || location.pathname.startsWith(`${route}/`));
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
    <div className="flex min-h-screen flex-col bg-background text-on-background selection:bg-primary/20">
      <header className="fixed top-0 z-50 flex h-20 w-full items-center border-b border-slate-200 bg-white px-5 lg:px-[5.5vw]">
        <div className="flex min-w-0 items-center gap-4">
          {/* The staff portal has no customer navigation, so no hamburger. */}
          {!isPortal && (
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
          <Link to="/" className="font-serif text-[30px] leading-none tracking-[-0.05em] text-primary sm:text-[32px]">InsurShield</Link>
        </div>

        {isPortal ? (
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {staffSession && (
              <>
                <span className="hidden text-[14px] text-secondary sm:block">
                  <strong className="text-on-surface">{staffSession.name}</strong> · {staffSession.role === 'insurer' ? 'Insurer portal' : 'Staff portal'}
                </span>
                <button type="button" onClick={handleStaffSignOut} className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] font-bold text-primary hover:bg-primary/5">Sign out</button>
              </>
            )}
            <Link to="/" className="text-[14px] font-medium text-secondary hover:text-primary" aria-label="Customer site"><span className="hidden sm:inline">Customer site</span><span className="material-symbols-outlined sm:hidden" aria-hidden="true">home</span></Link>
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
                  <Link to="/account" aria-label="My account" className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-lg" aria-hidden="true">person</span>
                  </Link>
                </>
              ) : (
                <Link to={loginHref} className="rounded-lg bg-primary px-4 py-2 text-[13px] font-bold text-white hover:bg-primary-container">Log in</Link>
              )}
            </div>
          </>
        )}
      </header>

      {menuOpen && !isPortal && (
        <div className="fixed inset-x-0 top-20 z-40 border-b border-slate-200 bg-white p-4 shadow-lg md:hidden">
          <nav aria-label="Mobile" className="grid gap-1">
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
          <div className="min-h-[calc(100vh-80px)] bg-gray-50/80">
            <div className="mx-auto max-w-screen-xl px-4 py-8 sm:px-6 lg:px-10"><Outlet /></div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
