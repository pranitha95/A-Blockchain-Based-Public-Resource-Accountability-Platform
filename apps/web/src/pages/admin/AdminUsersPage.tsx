import type { AccountStatus, UserRole } from '@poi/shared';
import { USER_ROLES } from '@poi/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pencil,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminTabs } from '../../components/domain/AdminTabs';
import { DemoBadge, RoleBadge, StatusBadge } from '../../components/ui/Badges';
import { Button, buttonClass } from '../../components/ui/Button';
import { Alert, EmptyState, ErrorState, FormErrorSummary, LoadingBlock } from '../../components/ui/Feedback';
import { Card, PageHeader, Pagination, SectionHeading } from '../../components/ui/Layout';
import { Modal } from '../../components/ui/Modal';
import { Field, SelectField } from '../../components/ui/Primitives';
import { useAuth } from '../../features/auth/AuthProvider';
import { useToast } from '../../features/ui/ToastProvider';
import { api } from '../../lib/api';
import { fieldError } from '../../lib/forms';
import { formatDate, labelFor, relativeTime } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import { usePageTitle } from '../../lib/usePageTitle';
import type { AdminUserView } from '../../types';

const roleOptions = USER_ROLES.map((role) => ({ value: role, label: labelFor(role) }));
const statusOptions = (['ACTIVE', 'INACTIVE', 'SUSPENDED'] as AccountStatus[]).map((status) => ({
  value: status,
  label: labelFor(status),
}));

export function AdminUsersPage() {
  usePageTitle('Platform accounts');
  const { user: currentUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserView | null>(null);

  const search = searchParams.get('search') ?? '';
  const role = searchParams.get('role') ?? '';
  const status = searchParams.get('status') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const usersQuery = useQuery({
    queryKey: queryKeys.users({ search, role, status, page }),
    queryFn: () =>
      api.getPage<AdminUserView>('/users', {
        search: search || undefined,
        role: role || undefined,
        status: status || undefined,
        page,
        pageSize: 20,
      }),
  });

  const users = usersQuery.data?.data ?? [];
  const meta = usersQuery.data?.meta ?? {};
  const activeFilters = [search, role, status].filter(Boolean).length;

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    setSearchParams(next);
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administration"
        title="Platform accounts"
        description="Account roles and status are enforced by the API. Passwords are hashed with Argon2id and are never displayed, emailed or recoverable from this screen."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus size={16} aria-hidden="true" /> Create account
          </Button>
        }
      />
      <AdminTabs />

      <div className="metric-strip">
        <div className="metric-strip__lead">
          <span>Accounts in this view</span>
          <strong>{Number(meta.total ?? users.length)}</strong>
        </div>
        <div>
          <span>Filters applied</span>
          <strong>{activeFilters}</strong>
        </div>
        <div>
          <span>Password storage</span>
          <strong>Argon2id</strong>
        </div>
        <div>
          <span>Self-service reset</span>
          <strong>Not implemented</strong>
        </div>
        <div className="metric-strip__note">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>Role changes are blocked while an owner still has projects or a reviewer has active assignments.</span>
        </div>
      </div>

      <Card className="filter-bar">
        <form
          className="filter-bar__form"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ search: searchInput.trim() || null });
          }}
        >
          <label className="filter-bar__search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by name or email"
              maxLength={120}
              aria-label="Search accounts"
            />
          </label>
          <Button type="submit" variant="secondary" size="sm">Search</Button>
        </form>
        <SelectField
          id="filter-role"
          label="Role"
          value={role}
          onChange={(value) => apply({ role: value || null })}
          options={roleOptions}
          placeholder="All roles"
        />
        <SelectField
          id="filter-status"
          label="Status"
          value={status}
          onChange={(value) => apply({ status: value || null })}
          options={statusOptions}
          placeholder="All statuses"
        />
        {activeFilters > 0 ? (
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            onClick={() => {
              setSearchInput('');
              setSearchParams(new URLSearchParams());
            }}
          >
            Clear filters
          </button>
        ) : null}
      </Card>

      <Card>
        <SectionHeading
          title="Accounts"
          description="New accounts receive an administrator-chosen initial password. The user should change it from Account settings."
          action={<span className="scope-note">{activeFilters > 0 ? 'Filtered view' : 'All accounts'}</span>}
        />
        {usersQuery.isLoading ? (
          <LoadingBlock label="Loading accounts…" />
        ) : usersQuery.isError ? (
          <ErrorState
            error={usersQuery.error}
            title="Accounts could not be loaded"
            action={<Button size="sm" variant="secondary" onClick={() => void usersQuery.refetch()}>Try again</Button>}
          />
        ) : users.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No accounts match this view"
            description="Adjust the search or filters, or create a new account."
            action={<Button size="sm" variant="secondary" onClick={() => { setSearchInput(''); setSearchParams(new URLSearchParams()); }}>Clear filters</Button>}
          />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="admin-table__identity">
                        <strong>{account.fullName}{account.id === currentUser?.id ? <span className="subtle"> (you)</span> : null}</strong>
                        <span>{account.email}</span>
                        {account.isDemo ? <DemoBadge compact /> : null}
                      </div>
                    </td>
                    <td><RoleBadge role={account.role} /></td>
                    <td><StatusBadge value={account.status} dot /></td>
                    <td><span title={formatDate(account.createdAt)}>{relativeTime(account.createdAt)}</span></td>
                    <td>{account.lastLoginAt ? <span title={formatDate(account.lastLoginAt)}>{relativeTime(account.lastLoginAt)}</span> : 'Never'}</td>
                    <td className="admin-table__actions">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(account)}>
                        <Pencil size={14} aria-hidden="true" /> Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={Number(meta.page ?? page)}
          totalPages={Number(meta.totalPages ?? 1)}
          total={Number(meta.total ?? users.length)}
          onChange={(next) => apply({ page: String(next) })}
          noun="accounts"
        />
      </Card>

      <Alert tone="info" title="Administrator safety rules">
        You cannot change your own role or deactivate your own account, and the last active administrator cannot be
        removed. Those checks run on the server, including against requests made outside this interface.
      </Alert>

      <UserFormModal open={createOpen} account={null} onClose={() => setCreateOpen(false)} />
      <UserFormModal open={Boolean(editing)} account={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function UserFormModal({
  open,
  account,
  onClose,
}: {
  open: boolean;
  account: AdminUserView | null;
  onClose: () => void;
}) {
  const formId = useId();
  const { user: currentUser } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const mode = account ? 'edit' : 'create';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('OBSERVER');
  const [status, setStatus] = useState<AccountStatus>('ACTIVE');
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName(account?.fullName ?? '');
    setEmail(account?.email ?? '');
    setPassword('');
    setRole(account?.role ?? 'OBSERVER');
    setStatus(account?.status ?? 'ACTIVE');
    setError(null);
    setLocalError(null);
  }, [open, account]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (account) {
        return api.patch<AdminUserView>(`/users/${account.id}`, { fullName, role, status });
      }
      return api.post<AdminUserView>('/users', { fullName, email, password, role });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      notify(
        account ? `Account for ${saved.fullName} updated.` : `Account for ${saved.fullName} created.`,
        'success',
      );
      onClose();
    },
    onError: setError,
  });

  const editingSelf = Boolean(account && currentUser && account.id === currentUser.id);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    if (password && (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      setLocalError('Use at least 10 characters, including a letter and a number.');
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title={mode === 'create' ? 'Create platform account' : 'Edit platform account'}
      description={
        mode === 'create'
          ? 'Choose an initial password and share it with the user through a secure channel. The platform does not send email.'
          : 'Role and status changes are recorded in the append-only audit chain.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            {mode === 'create' ? 'Create account' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={submit}>
        <FormErrorSummary error={error} />
        {localError ? <div className="form-error-summary" role="alert">{localError}</div> : null}
        {editingSelf ? (
          <Alert tone="warning" compact>
            This is your own account. Your role cannot be changed here and you cannot deactivate yourself.
          </Alert>
        ) : null}
        <Field label="Full name" htmlFor="user-name" required error={fieldError(error, 'fullName')}>
          <input
            id="user-name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
          />
        </Field>
        <Field label="Email address" htmlFor="user-email" required error={fieldError(error, 'email')}>
          <input
            id="user-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required={mode === 'create'}
            readOnly={mode === 'edit'}
            disabled={mode === 'edit'}
            maxLength={254}
            autoComplete="email"
            placeholder="person@example.org"
          />
        </Field>
        {mode === 'create' ? (
          <Field
            label="Initial password"
            htmlFor="user-password"
            required
            hint="At least 10 characters with a letter and a number. No default password is provided."
            error={fieldError(error, 'password') ?? localError ?? undefined}
          >
            <input
              id="user-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
            />
          </Field>
        ) : null}
        <SelectField
          id="user-role"
          label="Role"
          value={role}
          onChange={(value) => setRole(value as UserRole)}
          options={roleOptions}
          required
          hint="Owners with projects or reviewers with active assignments cannot be moved to another role until those records are reassigned or removed."
          error={fieldError(error, 'role')}
        />
        {mode === 'edit' ? (
          <SelectField
            id="user-status"
            label="Account status"
            value={status}
            onChange={(value) => setStatus(value as AccountStatus)}
            options={statusOptions}
            required
            hint="Suspension revokes access on the next request; existing sessions are no longer accepted."
            error={fieldError(error, 'status')}
          />
        ) : null}
        {mode === 'edit' && account?.isDemo ? (
          <p className="form-note">This is a labelled demonstration account. Changing its role does not make its records real.</p>
        ) : null}
      </form>
    </Modal>
  );
}
