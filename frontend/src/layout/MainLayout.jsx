import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';

const NAV_LINKS = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/renewal', label: 'Policies', icon: 'shield' },
  { to: '/claims', label: 'Claims', icon: 'report_problem' },
  { to: '/support', label: 'Contact', icon: 'contacts' },
];

// Routes that get full-width dashboard treatment
const PORTAL_ROUTES = ['/admin', '/insurer', '/admin-login'];

export default function MainLayout() {
  const location = useLocation();

  const isActive = (to) => location.pathname === to;
  const isPortal = PORTAL_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));

  return (
    <div className="min-h-screen flex flex-col bg-background text-on-background selection:bg-primary/20">
      {/* Top Nav */}
      <header className="bg-white border-b border-gray-100 shadow-sm fixed top-0 h-16 w-full z-50 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-primary cursor-pointer active:opacity-70">menu</span>
          <Link to="/" className="text-2xl font-bold tracking-tighter text-primary">InsurShield</Link>
        </div>
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={`font-sans text-sm font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors ${isActive(link.to) ? 'text-primary font-semibold bg-primary/5' : 'text-gray-600 hover:bg-gray-50 hover:text-primary'}`}
            >
              {link.label}
            </Link>
          ))}
          <Link to="/admin-login" className={`ml-2 font-sans text-sm font-medium px-3 py-2 rounded-lg transition-colors ${isPortal ? 'text-primary font-semibold bg-primary/5' : 'text-gray-600 hover:bg-gray-50 hover:text-primary'}`}>
            Staff Portal
          </Link>
        </nav>
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center border border-outline-variant overflow-hidden">
            <span className="material-symbols-outlined text-gray-500 text-sm">person</span>
          </div>
        </div>
      </header>

      <main className="pt-16 pb-24 flex-1">
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

      {/* Bottom Nav — Mobile */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center px-4 py-3 pb-safe bg-white/90 backdrop-blur-md border-t border-gray-100 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] rounded-t-2xl">
        {[
          { to: '/', label: 'Home', icon: 'home' },
          { to: '/renewal', label: 'Policies', icon: 'shield' },
          { to: '/claims', label: 'Claims', icon: 'report_problem' },
          { to: '/support', label: 'Contact', icon: 'contacts' },
        ].map(link => (
          <Link
            key={link.to}
            to={link.to}
            className={`relative flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-transform ${isActive(link.to) ? 'text-primary' : 'text-gray-500 hover:text-primary'}`}
          >
            <span className="material-symbols-outlined" style={isActive(link.to) ? { fontVariationSettings: "'FILL' 1" } : {}}>
              {link.icon}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest mt-0.5">{link.label}</span>
          </Link>
        ))}
      </nav>


    </div>
  );
}
