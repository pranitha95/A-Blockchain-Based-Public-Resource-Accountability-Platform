import { useEffect } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import {
  RedirectIfAuthenticated,
  RequireAuth,
  RequireRole,
} from './components/layout/RouteGuards';
import { AnchorDetailPage } from './pages/AnchorDetailPage';
import { BlockchainPage } from './pages/BlockchainPage';
import { ClaimDetailPage } from './pages/ClaimDetailPage';
import { DashboardPage } from './pages/DashboardPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectFormPage } from './pages/ProjectFormPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReportDetailPage } from './pages/ReportDetailPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReviewDetailPage } from './pages/ReviewDetailPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { SettingsPage } from './pages/SettingsPage';
import { VerifyPage } from './pages/VerifyPage';
import { AdminCategoriesPage } from './pages/admin/AdminCategoriesPage';
import { AdminOrganizationsPage } from './pages/admin/AdminOrganizationsPage';
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function ReviewIndexRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/review-queue${search}`} replace />;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<LandingPage />} />

          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route
            path="projects/new"
            element={<RequireRole roles={['ADMIN']}><ProjectFormPage /></RequireRole>}
          />
          <Route
            path="projects/:projectId/edit"
            element={<RequireRole roles={['ADMIN']}><ProjectFormPage /></RequireRole>}
          />

          <Route path="blockchain" element={<BlockchainPage />} />
          <Route path="blockchain/:anchorId" element={<AnchorDetailPage />} />
          <Route path="verify" element={<VerifyPage />} />

          <Route
            path="login"
            element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>}
          />
          <Route
            path="register"
            element={<RedirectIfAuthenticated><RegisterPage /></RedirectIfAuthenticated>}
          />

          <Route path="dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
          <Route path="claims/:claimId" element={<ClaimDetailPage />} />

          <Route
            path="review-queue"
            element={<RequireRole roles={['REVIEWER', 'ADMIN']}><ReviewQueuePage /></RequireRole>}
          />
          <Route path="reviews" element={<ReviewIndexRedirect />} />
          <Route
            path="review/:targetType/:targetId"
            element={<RequireRole roles={['REVIEWER', 'ADMIN']}><ReviewDetailPage /></RequireRole>}
          />

          <Route
            path="reports"
            element={<RequireRole roles={['PROJECT_OWNER', 'REVIEWER', 'ADMIN']}><ReportsPage /></RequireRole>}
          />
          <Route
            path="reports/:reportId"
            element={<RequireRole roles={['PROJECT_OWNER', 'REVIEWER', 'ADMIN']}><ReportDetailPage /></RequireRole>}
          />

          <Route path="notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
          <Route path="settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />

          <Route
            path="admin"
            element={<Navigate to="/admin/users" replace />}
          />
          <Route
            path="admin/users"
            element={<RequireRole roles={['ADMIN']}><AdminUsersPage /></RequireRole>}
          />
          <Route
            path="admin/organizations"
            element={<RequireRole roles={['ADMIN']}><AdminOrganizationsPage /></RequireRole>}
          />
          <Route
            path="admin/categories"
            element={<RequireRole roles={['ADMIN']}><AdminCategoriesPage /></RequireRole>}
          />
          <Route
            path="admin/settings"
            element={<RequireRole roles={['ADMIN']}><AdminSettingsPage /></RequireRole>}
          />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
