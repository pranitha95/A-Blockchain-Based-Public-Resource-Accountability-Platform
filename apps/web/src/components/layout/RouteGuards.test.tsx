import type { SessionUser } from '@poi/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../features/auth/AuthProvider';
import { RequireRole } from './RouteGuards';

vi.mock('../../features/auth/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

const baseUser: SessionUser = {
  id: 'user-1',
  email: 'reviewer@example.test',
  fullName: 'Riya Menon',
  role: 'REVIEWER',
  status: 'ACTIVE',
  isDemo: true,
  capabilities: {
    manageUsers: false,
    manageOrganizations: false,
    manageCategories: false,
    manageSettings: false,
    createProjects: false,
    approveProjects: false,
    assignReviewers: false,
    editOwnProjects: false,
    submitClaims: false,
    reviewClaims: true,
    anchorRecords: false,
    viewAudit: true,
  },
};

function setSession(user: SessionUser | null, loading = false) {
  mockedUseAuth.mockReturnValue({
    user,
    loading,
    error: null,
    refetch: vi.fn(),
    signOut: vi.fn(),
    setUser: vi.fn(),
  });
}

function renderAdminArea() {
  return render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <Routes>
        <Route
          path="/admin/users"
          element={
            <RequireRole roles={['ADMIN']}>
              <div>Administration panel</div>
            </RequireRole>
          }
        />
        <Route path="/login" element={<div>Sign in page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireRole', () => {
  beforeEach(() => {
    mockedUseAuth.mockReset();
  });

  it('renders children when the session holds an allowed role', () => {
    setSession({ ...baseUser, role: 'ADMIN' });
    renderAdminArea();
    expect(screen.getByText('Administration panel')).toBeInTheDocument();
  });

  it('shows a restriction notice for an authenticated user with the wrong role', () => {
    setSession(baseUser);
    renderAdminArea();
    expect(screen.getByRole('heading', { name: 'This area is limited to a different role' })).toBeInTheDocument();
    expect(screen.getByText(/You are signed in as/)).toHaveTextContent('Riya Menon');
    expect(screen.queryByText('Administration panel')).not.toBeInTheDocument();
  });

  it('redirects an anonymous visitor to the login page', () => {
    setSession(null);
    renderAdminArea();
    expect(screen.getByText('Sign in page')).toBeInTheDocument();
    expect(screen.queryByText('Administration panel')).not.toBeInTheDocument();
  });

  it('does not render protected content while the session is loading', () => {
    setSession(null, true);
    renderAdminArea();
    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
    expect(screen.queryByText('Administration panel')).not.toBeInTheDocument();
  });
});
