import type { NotificationType } from '@poi/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  BellOff,
  Blocks,
  CheckCheck,
  FileText,
  Mail,
  SearchCheck,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { StatusBadge, ToneBadge } from '../components/ui/Badges';
import { Button, buttonClass } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingCard } from '../components/ui/Feedback';
import { Card, PageHeader, Pagination, SectionHeading } from '../components/ui/Layout';
import { useAuth } from '../features/auth/AuthProvider';
import { useToast } from '../features/ui/ToastProvider';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, isSafeInternalPath, labelFor, relativeTime } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';
import type { ApiMeta } from '../lib/api';
import type { NotificationView } from '../types';

const notificationIcons: Record<NotificationType, typeof Bell> = {
  PROJECT_SUBMITTED: FileText,
  PROJECT_APPROVED: BadgeCheck,
  PROJECT_REJECTED: BellOff,
  MILESTONE_SUBMITTED: FileText,
  CLAIM_SUBMITTED: FileText,
  REVIEW_DECIDED: ShieldCheck,
  REVIEWER_ASSIGNED: UserCheck,
  ANCHOR_CONFIRMED: Blocks,
  ANCHOR_FAILED: BellOff,
  REPORT_GENERATED: FileText,
};

export function NotificationsPage() {
  usePageTitle('Notifications');
  const { user } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') ?? 1) || 1;
  const unreadOnly = searchParams.get('unreadOnly') === 'true';

  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications({ page, unreadOnly }),
    queryFn: () =>
      api.getPage<NotificationView>('/notifications', {
        page,
        pageSize: 20,
        unreadOnly: unreadOnly ? 'true' : undefined,
      }),
    enabled: Boolean(user),
  });

  const notifications = notificationsQuery.data?.data ?? [];
  const meta = notificationsQuery.data?.meta ?? {};
  const unreadCount = Number((meta as ApiMeta).unreadCount ?? 0);

  const markAllMutation = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: ({ updated }) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      notify(updated > 0 ? `${updated} notifications marked as read.` : 'No unread notifications remained.', 'success');
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const markOneMutation = useMutation({
    mutationFn: (notificationId: string) => api.patch<NotificationView>(`/notifications/${notificationId}/read`),
    onSuccess: (notification) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (isSafeInternalPath(notification.linkPath)) navigate(notification.linkPath);
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => api.patch<NotificationView>(`/notifications/${notificationId}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

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
        eyebrow="Your account"
        title="Notifications"
        description="In-app notices about assignments, submissions, review decisions and blockchain anchoring. These are conveniences; the append-only audit chain remains the authoritative event history."
        actions={
          <div className="action-bar">
            <Button
              variant="secondary"
              onClick={() => markAllMutation.mutate()}
              loading={markAllMutation.isPending}
              disabled={unreadCount === 0}
            >
              <CheckCheck size={16} aria-hidden="true" /> Mark all as read
            </Button>
            <Link to="/settings" className={buttonClass('ghost')}>Account settings</Link>
          </div>
        }
      />

      <div className="metric-strip">
        <div className="metric-strip__lead">
          <span>Unread notifications</span>
          <strong>{unreadCount}</strong>
        </div>
        <div>
          <span>In this view</span>
          <strong>{Number(meta.total ?? notifications.length)}</strong>
        </div>
        <div>
          <span>Delivery</span>
          <strong>In-app only</strong>
        </div>
        <div>
          <span>Audit history</span>
          <strong>Separate</strong>
        </div>
        <div className="metric-strip__note">
          <Mail size={15} aria-hidden="true" />
          <span>This build does not send email. Notifications cannot be used as proof that an event occurred.</span>
        </div>
      </div>

      <Card className="filter-bar">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => apply({ unreadOnly: event.target.checked ? 'true' : null })}
          />
          Show unread only
        </label>
        <span className="filter-bar__scope">
          {unreadOnly ? 'Only unread notifications are shown, newest first.' : 'All notifications, newest first.'}
        </span>
        {unreadOnly ? (
          <button type="button" className="text-link" onClick={() => apply({ unreadOnly: null })}>Clear filter</button>
        ) : null}
      </Card>

      <Card>
        <SectionHeading
          title="Recent notices"
          description="Opening an unread notice marks it as read. Marking a notice as read does not change the underlying record."
          action={<span className="scope-note">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</span>}
        />
        {notificationsQuery.isLoading ? (
          <LoadingCard label="Loading notifications…" />
        ) : notificationsQuery.isError ? (
          <ErrorState
            error={notificationsQuery.error}
            title="Notifications could not be loaded"
            action={<button type="button" className={buttonClass('secondary', 'sm')} onClick={() => void notificationsQuery.refetch()}>Try again</button>}
          />
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={unreadOnly ? CheckCheck : Bell}
            title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
            description={
              unreadOnly
                ? 'You have read every notice in your account.'
                : 'Notices appear when you are assigned to a project or a record you follow changes state.'
            }
          />
        ) : (
          <ul className="notification-list">
            {notifications.map((notification) => {
              const Icon = notificationIcons[notification.type] ?? Bell;
              const unread = !notification.readAt;
              const canOpen = Boolean(notification.linkPath && isSafeInternalPath(notification.linkPath));
              return (
                <li key={notification.id} className={`notification-row${unread ? ' notification-row--unread' : ''}`}>
                  <span className="notification-row__icon" aria-hidden="true"><Icon size={18} /></span>
                  <div className="notification-row__body">
                    <div className="notification-row__top">
                      <div className="badge-row">
                        <ToneBadge tone={unread ? 'info' : 'neutral'}>{labelFor(notification.type)}</ToneBadge>
                        {unread ? <span className="unread-dot" aria-label="Unread" /> : null}
                      </div>
                      <span className="scope-note" title={formatDateTime(notification.createdAt)}>{relativeTime(notification.createdAt)}</span>
                    </div>
                    <h3>{notification.title}</h3>
                    <p>{notification.message}</p>
                    <div className="notification-row__actions">
                      {canOpen ? (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => {
                            if (unread) markOneMutation.mutate(notification.id);
                            else if (notification.linkPath) navigate(notification.linkPath);
                          }}
                          disabled={markOneMutation.isPending && markOneMutation.variables === notification.id}
                        >
                          Open record <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      ) : <span className="subtle">No linked record</span>}
                      {unread ? (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => markReadMutation.mutate(notification.id)}
                          disabled={markReadMutation.isPending && markReadMutation.variables === notification.id}
                        >
                          Mark as read
                        </button>
                      ) : (
                        <span className="subtle">Read {formatDateTime(notification.readAt)}</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination
          page={Number(meta.page ?? page)}
          totalPages={Number(meta.totalPages ?? 1)}
          total={Number(meta.total ?? notifications.length)}
          onChange={(next) => apply({ page: String(next) })}
          noun="notifications"
        />
      </Card>

      <div className="card-grid card-grid--three">
        <Card>
          <SectionHeading title="Who receives notices" />
          <p>
            Reviewers receive notices for assigned projects, owners receive decisions on their submissions, and
            administrators receive operational notices. These routing rules are applied on the server.
          </p>
        </Card>
        <Card>
          <SectionHeading title="What notices are not" />
          <p>
            A notification is a convenience copy of an event. It is not a legal notice, an approval, or evidence that a
            transaction was confirmed. Use the audit trail and verification pages for authoritative checks.
          </p>
        </Card>
        <Card>
          <SectionHeading title="Unread count" />
          <p>
            The bell shows the current unread count from the API. Reading a notice for one role does not expose records
            that the role is not permitted to see. <StatusBadge value="ACTIVE" /> accounts only.
          </p>
        </Card>
      </div>
    </div>
  );
}
