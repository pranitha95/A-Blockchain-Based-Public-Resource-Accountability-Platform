import {
  Check,
  CircleSlash,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DemoBadge, RoleBadge, StatusBadge } from '../components/ui/Badges';
import { Button } from '../components/ui/Button';
import { Alert, FormErrorSummary } from '../components/ui/Feedback';
import { Card, DetailGrid, DetailItem, PageHeader, SectionHeading } from '../components/ui/Layout';
import { Field } from '../components/ui/Primitives';
import { useAuth } from '../features/auth/AuthProvider';
import { useMeta } from '../features/meta/MetaProvider';
import { useToast } from '../features/ui/ToastProvider';
import { api } from '../lib/api';
import { fieldError } from '../lib/forms';
import { relativeTime } from '../lib/format';
import { usePageTitle } from '../lib/usePageTitle';
import type { CapabilityMap } from '../types';

const capabilityLabels: { key: keyof CapabilityMap; label: string }[] = [
  { key: 'createProjects', label: 'Create project records' },
  { key: 'approveProjects', label: 'Approve or decline projects' },
  { key: 'editOwnProjects', label: 'Edit owned project records' },
  { key: 'assignReviewers', label: 'Assign independent reviewers' },
  { key: 'submitClaims', label: 'Submit expenditure claims' },
  { key: 'reviewClaims', label: 'Record review decisions' },
  { key: 'anchorRecords', label: 'Prepare blockchain anchors' },
  { key: 'viewAudit', label: 'Read the full audit trail' },
  { key: 'manageUsers', label: 'Manage platform accounts' },
  { key: 'manageOrganizations', label: 'Manage organizations and memberships' },
  { key: 'manageCategories', label: 'Manage project categories' },
  { key: 'manageSettings', label: 'Change platform settings' },
];

export function SettingsPage() {
  usePageTitle('Account settings');
  const { user, loading, setUser } = useAuth();
  const { meta } = useMeta();
  const { notify } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading || !user) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Your account" title="Account settings" />
        <Card><p className="muted-note">Loading your account…</p></Card>
      </div>
    );
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    if (newPassword !== confirmPassword) {
      setLocalError('The new password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setLocalError('Choose a new password that differs from the current one.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post<{ changed: boolean }>('/auth/change-password', {
        currentPassword,
        newPassword,
        confirmPassword,
      });
      queryClient.clear();
      setUser(null);
      notify('Password changed. Every session was revoked; sign in again with the new password.', 'success');
      navigate('/login', { replace: true });
    } catch (changeError) {
      setError(changeError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Your account"
        title="Account settings"
        description="Your identity, effective permissions and password. Role appointments and platform configuration are administrator actions recorded in the audit chain."
      />

      <div className="two-column two-column--wide-left">
        <div className="page-stack">
          <Card>
            <SectionHeading
              title="Account identity"
              description="This information comes from the authenticated server session, not from browser-supplied values."
              action={user.isDemo ? <DemoBadge /> : undefined}
            />
            <div className="settings-identity">
              <span className="avatar avatar--large" aria-hidden="true">
                {user.fullName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part.charAt(0).toUpperCase())
                  .join('')}
              </span>
              <div>
                <h3>{user.fullName}</h3>
                <p><Mail size={14} aria-hidden="true" /> {user.email}</p>
                <div className="badge-row">
                  <RoleBadge role={user.role} />
                  <StatusBadge value={user.status} dot />
                </div>
              </div>
            </div>
            <DetailGrid>
              <DetailItem label="Account role">{user.role === 'ADMIN' ? 'Platform administrator' : user.role === 'PROJECT_OWNER' ? 'Project owner' : user.role === 'REVIEWER' ? 'Independent reviewer' : 'Public observer'}</DetailItem>
              <DetailItem label="Account status"><StatusBadge value={user.status} /></DetailItem>
              <DetailItem label="Account type">{user.isDemo ? 'Demonstration account' : 'Self-registered / administrator-created'}</DetailItem>
              <DetailItem label="Account identifier">{user.id}</DetailItem>
            </DetailGrid>
            <Alert tone="info" compact>
              Role-based access is evaluated by the API on every request. Hiding interface controls is a convenience;
              the server remains the authority.
            </Alert>
          </Card>

          <Card>
            <SectionHeading
              title="Change password"
              description="Passwords are hashed with Argon2id. The server never stores or returns the plaintext."
            />
            <Alert tone="warning" title="This signs you out everywhere">
              A successful change revokes every active session for this account, including this one. You will need to
              sign in again with the new password. There is no self-service or administrator password-reset endpoint in
              this build; a forgotten password must be handled by an operator with database access.
            </Alert>
            <form className="form-stack settings-password-form" onSubmit={submitPassword}>
              <FormErrorSummary error={error} />
              {localError ? <div className="form-error-summary" role="alert">{localError}</div> : null}
              <Field
                label="Current password"
                htmlFor="current-password"
                required
                error={fieldError(error, 'currentPassword')}
              >
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  maxLength={128}
                />
              </Field>
              <Field
                label="New password"
                htmlFor="new-password"
                required
                hint="At least 10 characters, including a letter and a number."
                error={fieldError(error, 'newPassword')}
              >
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  minLength={10}
                  maxLength={128}
                />
              </Field>
              <Field
                label="Confirm new password"
                htmlFor="confirm-password"
                required
                error={fieldError(error, 'confirmPassword') ?? localError ?? undefined}
              >
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  maxLength={128}
                />
              </Field>
              <div className="button-row">
                <Button type="submit" loading={submitting}>
                  <KeyRound size={16} aria-hidden="true" /> Change password and sign out
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={submitting}
                  onClick={() => {
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setError(null);
                    setLocalError(null);
                  }}
                >
                  Clear form
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <SectionHeading
              title="Your effective permissions"
              description="Capabilities granted to your role by the server. A granted capability still requires project-level authorisation."
            />
            <ul className="capability-grid">
              {capabilityLabels.map(({ key, label }) => {
                const granted = user.capabilities[key];
                return (
                  <li key={key} className={`capability-item${granted ? ' capability-item--granted' : ' capability-item--denied'}`}>
                    {granted ? <Check size={15} aria-hidden="true" /> : <CircleSlash size={15} aria-hidden="true" />}
                    <span>{label}</span>
                    <small>{granted ? 'Granted' : 'Not granted'}</small>
                  </li>
                );
              })}
            </ul>
            <p className="muted-note">
              Reviewer independence, ownership conflicts and claim approval rules are additional server-side checks that
              are not represented as a simple permission toggle.
            </p>
          </Card>
        </div>

        <div className="page-stack">
          <Card>
            <SectionHeading title="Session security" />
            <ul className="trail-links">
              <li><LockKeyhole size={15} aria-hidden="true" />Sessions use an opaque token in an HttpOnly cookie; only a hash is stored server-side.</li>
              <li><ShieldCheck size={15} aria-hidden="true" />State-changing requests require a CSRF header tied to your session.</li>
              <li><UserRound size={15} aria-hidden="true" />Session status and role are re-read on each request, so suspension takes effect immediately.</li>
            </ul>
            <DetailGrid>
              <DetailItem label="Server time">{meta ? relativeTime(meta.serverTime) : '—'}</DetailItem>
              <DetailItem label="API version">{meta?.apiVersion ?? '—'}</DetailItem>
              <DetailItem label="Environment">{meta?.platform.demoMode ? 'Demonstration' : 'Standard'}</DetailItem>
            </DetailGrid>
          </Card>

          <Card>
            <SectionHeading title="Privacy and evidence" />
            <p>
              Public observers can see public records only. Restricted evidence is withheld by the API for roles without
              authorisation. Uploaded files are content-checked and stored with randomised names.
            </p>
            <p className="muted-note">
              A file checksum confirms integrity of the stored bytes. It does not establish that a document is authentic,
              complete or truthful.
            </p>
          </Card>

          <Card>
            <SectionHeading title="Need a role change?" />
            <p>
              Owner, reviewer and administrator roles are appointed by a platform administrator. Role changes are recorded
              in the append-only audit chain and may be blocked while a user still owns projects or holds active reviewer
              assignments.
            </p>
            {meta?.platform.showDemoData && user.isDemo ? (
              <Alert tone="info" compact>
                This is a labelled demonstration account. Its credentials and records must not be used as evidence of a
                real project or real approval.
              </Alert>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
