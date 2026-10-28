import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { UserRole } from '@poi/shared';
import { useAuth } from '../../features/auth/AuthProvider';
import { LoadingBlock } from '../ui/Feedback';
import { PageHeader } from '../ui/Layout';
import { buttonClass } from '../ui/Button';
import { Link } from 'react-router-dom';

function FullPageLoading() {
  return (
    <div className="route-loading">
      <LoadingBlock label="Checking your session…" />
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoading />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}

export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoading />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  if (!roles.includes(user.role)) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Access restricted"
          title="This area is limited to a different role"
          description="Proof of Impact enforces permissions on the server. Your account does not hold the role required for this page."
        />
        <div className="card card--padded">
          <p>
            You are signed in as <strong>{user.fullName}</strong>. Return to your overview to continue working with the
            records available to you.
          </p>
          <div className="button-row">
            <Link to="/dashboard" className={buttonClass('primary')}>Go to overview</Link>
            <Link to="/projects" className={buttonClass('secondary')}>Browse projects</Link>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoading />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function RouteLoading() {
  return (
    <div className="route-loading">
      <LoadingBlock label="Loading…" />
    </div>
  );
}
