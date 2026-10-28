import type { AdminUserView, OrganizationView } from '../../types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminTabs } from '../../components/domain/AdminTabs';
import { DemoBadge } from '../../components/ui/Badges';
import { Button, buttonClass } from '../../components/ui/Button';
import { Alert, EmptyState, ErrorState, FormErrorSummary, LoadingBlock } from '../../components/ui/Feedback';
import { Card, PageHeader, SectionHeading } from '../../components/ui/Layout';
import { Modal } from '../../components/ui/Modal';
import { Field, SelectField } from '../../components/ui/Primitives';
import { useToast } from '../../features/ui/ToastProvider';
import { api } from '../../lib/api';
import { fieldError } from '../../lib/forms';
import { formatDate } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import { usePageTitle } from '../../lib/usePageTitle';

interface OrganizationMemberView {
  userId: string;
  fullName: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  addedAt: string;
}

export function AdminOrganizationsPage() {
  usePageTitle('Organizations');
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OrganizationView | null>(null);
  const [managing, setManaging] = useState<OrganizationView | null>(null);
  const search = searchParams.get('search') ?? '';

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const organizationsQuery = useQuery({
    queryKey: queryKeys.organizations({ search }),
    queryFn: () => api.get<OrganizationView[]>(`/organizations${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  });

  const organizations = organizationsQuery.data ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administration"
        title="Organizations"
        description="Register the bodies that own projects. Memberships are administrative links; they do not grant platform roles or project permissions by themselves."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} aria-hidden="true" /> Register organization
          </Button>
        }
      />
      <AdminTabs />

      <div className="metric-strip">
        <div className="metric-strip__lead">
          <span>Organizations</span>
          <strong>{organizations.length}</strong>
        </div>
        <div>
          <span>Memberships recorded</span>
          <strong>{organizations.reduce((sum, org) => sum + org.memberCount, 0)}</strong>
        </div>
        <div>
          <span>Deletion</span>
          <strong>Not offered</strong>
        </div>
        <div className="metric-strip__note">
          <Building2 size={15} aria-hidden="true" />
          <span>Organizations are referenced by historical project records, so this build does not delete them.</span>
        </div>
      </div>

      <Card className="filter-bar">
        <form
          className="filter-bar__form"
          onSubmit={(event) => {
            event.preventDefault();
            const next = new URLSearchParams(searchParams);
            if (searchInput.trim()) next.set('search', searchInput.trim());
            else next.delete('search');
            setSearchParams(next);
          }}
        >
          <label className="filter-bar__search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search organizations by name"
              maxLength={120}
              aria-label="Search organizations"
            />
          </label>
          <Button type="submit" variant="secondary" size="sm">Search</Button>
        </form>
        {search ? (
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            onClick={() => {
              setSearchInput('');
              setSearchParams(new URLSearchParams());
            }}
          >
            Clear search
          </button>
        ) : null}
      </Card>

      <Card>
        <SectionHeading
          title="Registered organizations"
          description="Membership counts include both organization administrators and members."
        />
        {organizationsQuery.isLoading ? (
          <LoadingBlock label="Loading organizations…" />
        ) : organizationsQuery.isError ? (
          <ErrorState
            error={organizationsQuery.error}
            title="Organizations could not be loaded"
            action={<Button size="sm" variant="secondary" onClick={() => void organizationsQuery.refetch()}>Try again</Button>}
          />
        ) : organizations.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={search ? 'No organizations match this search' : 'No organizations registered'}
            description={search ? 'Try a different name or clear the search.' : 'Register an organization before creating a project that belongs to it.'}
            action={
              search ? (
                <Button size="sm" variant="secondary" onClick={() => setSearchParams(new URLSearchParams())}>Clear search</Button>
              ) : (
                <Button size="sm" onClick={() => setCreateOpen(true)}>Register organization</Button>
              )
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Organization</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Members</th>
                  <th scope="col">Registered</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((organization) => (
                  <tr key={organization.id}>
                    <td>
                      <div className="admin-table__identity">
                        <strong>{organization.name}</strong>
                        {organization.registrationNumber ? <span>Reg. {organization.registrationNumber}</span> : <span>No registration number recorded</span>}
                        {organization.isDemo ? <DemoBadge compact /> : null}
                      </div>
                    </td>
                    <td>
                      <div className="admin-table__stack">
                        <span>{organization.contactEmail ?? 'No contact email'}</span>
                        {organization.website ? (
                          <a href={organization.website} target="_blank" rel="noreferrer" className="text-link">
                            {organization.website}
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td>{organization.memberCount}</td>
                    <td>{formatDate(organization.createdAt)}</td>
                    <td className="admin-table__actions">
                      <div className="button-row button-row--compact">
                        <Button size="sm" variant="secondary" onClick={() => setManaging(organization)}>
                          <Users size={14} aria-hidden="true" /> Members
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(organization)}>
                          <Pencil size={14} aria-hidden="true" /> Edit
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Alert tone="info" title="Membership versus authorisation">
        Being an organization member does not let a person edit records or approve claims. Project ownership and reviewer
        assignments are separate, server-enforced relationships.
      </Alert>

      <OrganizationFormModal open={createOpen} organization={null} onClose={() => setCreateOpen(false)} />
      <OrganizationFormModal open={Boolean(editing)} organization={editing} onClose={() => setEditing(null)} />
      {managing ? <OrganizationMembersModal organization={managing} onClose={() => setManaging(null)} /> : null}
    </div>
  );
}

function OrganizationFormModal({
  open,
  organization,
  onClose,
}: {
  open: boolean;
  organization: OrganizationView | null;
  onClose: () => void;
}) {
  const formId = useId();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setName(organization?.name ?? '');
    setRegistrationNumber(organization?.registrationNumber ?? '');
    setContactEmail(organization?.contactEmail ?? '');
    setWebsite(organization?.website ?? '');
    setDescription(organization?.description ?? '');
    setError(null);
  }, [open, organization]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        registrationNumber: registrationNumber.trim() || null,
        contactEmail: contactEmail.trim() || null,
        website: website.trim() || null,
        description: description.trim() || null,
      };
      return organization
        ? api.patch<OrganizationView>(`/organizations/${organization.id}`, payload)
        : api.post<OrganizationView>('/organizations', payload);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      notify(organization ? `${saved.name} updated.` : `${saved.name} registered.`, 'success');
      onClose();
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title={organization ? 'Edit organization' : 'Register organization'}
      description="Organization details appear on public project pages. Provide only information that is accurate and safe to publish."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button type="submit" form={formId} loading={mutation.isPending}>
            {organization ? 'Save changes' : 'Register organization'}
          </Button>
        </>
      }
    >
      <form id={formId} className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); setError(null); mutation.mutate(); }}>
        <FormErrorSummary error={error} />
        <Field label="Organization name" htmlFor="org-name" required error={fieldError(error, 'name')}>
          <input id="org-name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={160} />
        </Field>
        <Field
          label="Registration number"
          htmlFor="org-registration"
          hint="Optional. Use the official identifier, not an invented one."
          error={fieldError(error, 'registrationNumber')}
        >
          <input id="org-registration" value={registrationNumber} onChange={(event) => setRegistrationNumber(event.target.value)} maxLength={80} />
        </Field>
        <Field label="Contact email" htmlFor="org-contact" error={fieldError(error, 'contactEmail')}>
          <input
            id="org-contact"
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            maxLength={254}
            placeholder="contact@organization.org"
          />
        </Field>
        <Field label="Website" htmlFor="org-website" error={fieldError(error, 'website')}>
          <input
            id="org-website"
            type="url"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            maxLength={200}
            placeholder="https://organization.org"
          />
        </Field>
        <Field
          label="Description"
          htmlFor="org-description"
          hint="Optional public description, up to 2,000 characters."
          error={fieldError(error, 'description')}
        >
          <textarea id="org-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
        </Field>
      </form>
    </Modal>
  );
}

function OrganizationMembersModal({
  organization,
  onClose,
}: {
  organization: OrganizationView;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ['organization-members', organization.id],
    queryFn: () => api.get<OrganizationMemberView[]>(`/organizations/${organization.id}/members`),
  });

  const usersQuery = useQuery({
    queryKey: ['organization-member-candidates'],
    queryFn: () => api.getPage<AdminUserView>('/users', { page: 1, pageSize: 100 }),
  });

  const members = membersQuery.data ?? [];
  const memberIds = new Set(members.map((member) => member.userId));
  const candidates = (usersQuery.data?.data ?? []).filter((user) => !memberIds.has(user.id));

  function refreshMembership() {
    void queryClient.invalidateQueries({ queryKey: ['organization-members', organization.id] });
    void queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
    void queryClient.invalidateQueries({ queryKey: ['audit'] });
  }

  const addMutation = useMutation({
    mutationFn: () => api.post<{ added: boolean }>(`/organizations/${organization.id}/members`, { userId, role }),
    onSuccess: () => {
      refreshMembership();
      notify('Organization membership recorded.', 'success');
      setUserId('');
      setRole('MEMBER');
    },
    onError: (error) => notify(error instanceof Error ? error.message : 'The membership could not be recorded.', 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => api.delete<{ removed: boolean }>(`/organizations/${organization.id}/members/${memberId}`),
    onSuccess: () => {
      refreshMembership();
      notify('Organization membership removed.', 'success');
    },
    onError: (error) => notify(error instanceof Error ? error.message : 'The membership could not be removed.', 'error'),
    onSettled: () => setRemovingId(null),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${organization.name} members`}
      description="Memberships describe organizational affiliation. They do not grant platform roles, project ownership, reviewer independence or approval rights."
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="page-stack page-stack--compact">
        <section>
          <SectionHeading
            title="Current members"
            description="Removing a membership does not delete the user account or change its platform role."
            action={<span className="scope-note">{members.length} linked</span>}
          />
          {membersQuery.isLoading ? (
            <LoadingBlock compact label="Loading members…" />
          ) : membersQuery.isError ? (
            <ErrorState error={membersQuery.error} title="Members could not be loaded" />
          ) : members.length === 0 ? (
            <EmptyState icon={Users} title="No members linked" description="Add an existing platform account below." />
          ) : (
            <ul className="membership-list">
              {members.map((member) => (
                <li key={member.userId} className="membership-row">
                  <div className="membership-row__identity">
                    <strong>{member.fullName}</strong>
                    <span>{member.email}</span>
                  </div>
                  <span className={`badge ${member.role === 'ADMIN' ? 'badge--info' : 'badge--neutral'}`}>
                    {member.role === 'ADMIN' ? 'Organization administrator' : 'Member'}
                  </span>
                  <small>Added {formatDate(member.addedAt)}</small>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={removeMutation.isPending && removingId === member.userId}
                    onClick={() => {
                      setRemovingId(member.userId);
                      removeMutation.mutate(member.userId);
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHeading
            title="Add a member"
            description="Choose an existing account. The same account can belong to more than one organization."
          />
          {usersQuery.isLoading ? (
            <LoadingBlock compact label="Loading account choices…" />
          ) : usersQuery.isError ? (
            <ErrorState error={usersQuery.error} title="Account choices could not be loaded" />
          ) : candidates.length === 0 ? (
            <p className="muted-note">Every available account is already linked to this organization.</p>
          ) : (
            <form
              className="membership-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!userId) return;
                addMutation.mutate();
              }}
            >
              <SelectField
                id="member-user"
                label="Account"
                value={userId}
                onChange={setUserId}
                options={candidates.map((user) => ({
                  value: user.id,
                  label: `${user.fullName} · ${user.email}${user.isDemo ? ' (demo)' : ''}`,
                }))}
                placeholder="Select an account"
                required
              />
              <SelectField
                id="member-role"
                label="Organization role"
                value={role}
                onChange={(value) => setRole(value as 'ADMIN' | 'MEMBER')}
                options={[
                  { value: 'MEMBER', label: 'Member' },
                  { value: 'ADMIN', label: 'Organization administrator' },
                ]}
                required
              />
              <Button type="submit" loading={addMutation.isPending} disabled={!userId}>
                <UserPlus size={15} aria-hidden="true" /> Add member
              </Button>
            </form>
          )}
          <p className="form-note">
            This screen adds and removes memberships only. To change an organization role, remove the membership and add
            it again; the change is recorded in the audit chain.
          </p>
        </section>
      </div>
    </Modal>
  );
}
