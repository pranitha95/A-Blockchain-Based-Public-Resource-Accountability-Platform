import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  Bell,
  Blocks,
  Building2,
  ChevronDown,
  FileText,
  FolderKanban,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  SearchCheck,
  Settings,
  ShieldCheck,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { initials, roleLabel } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import { useAuth } from '../../features/auth/AuthProvider';
import { useMeta } from '../../features/meta/MetaProvider';
import { useToast } from '../../features/ui/ToastProvider';
import type { ApiMeta } from '../../lib/api';

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Landmark size={21} strokeWidth={1.8} />
    </span>
  );
}

function MainNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const role = user?.role;
  const items = [
    ...(user ? [{ to: '/dashboard', label: 'Overview', icon: LayoutDashboard }] : []),
    { to: '/projects', label: 'Projects', icon: FolderKanban },
    ...(user ? [{ to: '/reports', label: 'Reports', icon: FileText }] : []),
    ...(role === 'REVIEWER' || role === 'ADMIN'
      ? [{ to: '/review-queue', label: 'Review queue', icon: SearchCheck }]
      : []),
    { to: '/blockchain', label: 'Blockchain', icon: Blocks },
    { to: '/verify', label: 'Verify', icon: BadgeCheck },
    ...(role === 'ADMIN' ? [{ to: '/admin/users', label: 'Administration', icon: ShieldCheck }] : []),
  ];

  return (
    <nav className="main-nav" aria-label="Main navigation">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) => `main-nav__link${isActive ? ' main-nav__link--active' : ''}`}
        >
          <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function NotificationBell() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: queryKeys.unreadCount,
    queryFn: async () => {
      const result = await api.getPage<unknown>('/notifications', { page: 1, pageSize: 1, unreadOnly: 'true' });
      return Number((result.meta as ApiMeta).unreadCount ?? 0);
    },
    enabled: Boolean(user),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
  const count = query.data ?? 0;
  return (
    <Link to="/notifications" className="notification-bell" aria-label={count > 0 ? `${count} unread notifications` : 'Notifications'}>
      <Bell size={18} aria-hidden="true" />
      {count > 0 ? <span className="notification-bell__count">{count > 9 ? '9+' : count}</span> : null}
    </Link>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { notify } = useToast();
  if (!user) return null;

  return (
    <details className="user-menu">
      <summary aria-label="Account menu">
        <span className="avatar">{initials(user.fullName)}</span>
        <span className="user-menu__identity">
          <strong>{user.fullName}</strong>
          <small>{roleLabel(user.role)}</small>
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="user-menu__popover">
        <div className="user-menu__header">
          <span className="avatar avatar--large">{initials(user.fullName)}</span>
          <div>
            <strong>{user.fullName}</strong>
            <span>{user.email}</span>
            <small>{roleLabel(user.role)}</small>
          </div>
        </div>
        {user.isDemo ? <p className="user-menu__demo">Signed in with a labelled demonstration account.</p> : null}
        <Link to="/settings" className="user-menu__item">
          <Settings size={16} aria-hidden="true" /> Account &amp; settings
        </Link>
        <button
          type="button"
          className="user-menu__item"
          onClick={async () => {
            try {
              await signOut();
              navigate('/login');
              notify('You have been signed out.', 'info');
            } catch {
              notify('Sign out failed. Please try again.', 'error');
            }
          }}
        >
          <LogOut size={16} aria-hidden="true" /> Sign out
        </button>
      </div>
    </details>
  );
}

export function AppShell() {
  const { meta } = useMeta();
  const { user } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const showDemoBanner =
    Boolean(user) && Boolean(meta?.platform.demoMode) && Boolean(meta?.platform.showDemoData) && !bannerDismissed;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to={user ? '/dashboard' : '/'} className="brand" aria-label="Proof of Impact home">
            <BrandMark />
            <span className="brand__text">
              <strong>Proof of Impact</strong>
              <small>Public resource accountability</small>
            </span>
          </Link>

          <div className={`site-header__nav-wrap${menuOpen ? ' site-header__nav-wrap--open' : ''}`}>
            <MainNav onNavigate={() => setMenuOpen(false)} />
            <div className="site-header__auth">
              {user ? (
                <>
                  <NotificationBell />
                  <UserMenu />
                </>
              ) : (
                <>
                  <Link to="/login" className="button button--ghost button--sm">Sign in</Link>
                  <Link to="/register" className="button button--primary button--sm">Create account</Link>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            className="mobile-menu-button"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
          </button>
        </div>
      </header>

      {menuOpen ? <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}

      {showDemoBanner ? (
        <div className="demo-banner">
          <span>
            <strong>Demonstration environment.</strong> Seeded projects and PDF evidence are clearly labelled. No blockchain anchors exist until an authorised wallet submits a real transaction.
          </span>
          <button type="button" aria-label="Dismiss demonstration notice" onClick={() => setBannerDismissed(true)}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <main id="main-content" className="page-container">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-footer__inner">
          <div className="site-footer__brand">
            <BrandMark />
            <div>
              <strong>Proof of Impact</strong>
              <p>A blockchain-based public resource accountability system.</p>
            </div>
          </div>
          <div className="site-footer__links">
            <Link to="/projects"><FolderKanban size={14} aria-hidden="true" /> Projects</Link>
            <Link to="/verify"><BadgeCheck size={14} aria-hidden="true" /> Verify a record</Link>
            <a href="/api/docs" target="_blank" rel="noreferrer"><FileText size={14} aria-hidden="true" /> API documentation</a>
            {user ? <Link to="/settings"><Settings size={14} aria-hidden="true" /> Settings</Link> : null}
          </div>
          <p className="site-footer__note">
            A confirmed blockchain anchor proves that a commitment existed at a point in time. It does not prove that a project was completed, an invoice is genuine, an expenditure was justified, or a reviewer is trustworthy. Approved claims are not proof of payment.
          </p>
          <div className="site-footer__meta">
            <span className="footer-admin-links">
              {user?.role === 'ADMIN' ? (
                <>
                  <Link to="/admin/users"><Users size={13} aria-hidden="true" /> Users</Link>
                  <Link to="/admin/organizations"><Building2 size={13} aria-hidden="true" /> Organizations</Link>
                  <Link to="/admin/categories"><Tags size={13} aria-hidden="true" /> Categories</Link>
                </>
              ) : null}
            </span>
            <span>Proof of Impact · CSE major project · {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
