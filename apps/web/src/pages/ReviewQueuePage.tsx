import type { OverviewResponse } from '@poi/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, ClipboardCheck, Inbox, SearchCheck, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../components/ui/Badges';
import { buttonClass } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingCard } from '../components/ui/Feedback';
import { Card, PageHeader, SectionHeading } from '../components/ui/Layout';
import { useAuth } from '../features/auth/AuthProvider';
import { api } from '../lib/api';
import { formatDateTime, labelFor, pluralize, relativeTime } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import type { ReviewQueueItem } from '../types';
import { usePageTitle } from '../lib/usePageTitle';

export function ReviewQueuePage() {
  usePageTitle('Review queue');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('project') ?? '';

  const queueQuery = useQuery({
    queryKey: queryKeys.reviewQueue,
    queryFn: () => api.get<ReviewQueueItem[]>('/reviews/queue'),
    enabled: Boolean(user),
  });
  const overviewQuery = useQuery({
    queryKey: queryKeys.stats(user?.role),
    queryFn: () => api.get<OverviewResponse>('/stats/overview'),
    enabled: Boolean(user),
  });

  if (!user) return null;

  const items = (queueQuery.data ?? []).filter((item) => !projectFilter || item.projectId === projectFilter);
  const oldest = items.reduce((max, item) => Math.max(max, item.ageDays), 0);
  const filterLabel = projectFilter ? items[0]?.projectCode : null;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Independent review"
        title="Records awaiting a decision"
        description={
          user.role === 'REVIEWER'
            ? 'Only records from projects with an active reviewer assignment are shown. Ownership, submission and conflict rules are enforced by the API, not by this screen.'
            : 'Administrators can inspect the full queue but cannot record reviewer decisions. Decisions must come from an independent, actively assigned reviewer.'
        }
        actions={
          <Link to="/projects" className={buttonClass('secondary')}>
            Assigned projects <ArrowRight size={15} aria-hidden="true" />
          </Link>
        }
      />

      <div className="metric-strip">
        <div className="metric-strip__lead">
          <span>Awaiting review</span>
          <strong>{items.length}</strong>
        </div>
        <div>
          <span>Oldest submission</span>
          <strong>{items.length === 0 ? '—' : pluralize(oldest, 'day')}</strong>
        </div>
        <div>
          <span>Claims awaiting review in scope</span>
          <strong>{overviewQuery.data?.metrics.claimsAwaitingReview ?? '—'}</strong>
        </div>
        <div>
          <span>Your role</span>
          <strong>{labelFor(user.role)}</strong>
        </div>
      </div>

      {projectFilter ? (
        <Card className="filter-bar">
          <span className="filter-bar__scope">
            Filtered to {filterLabel ?? 'one project'}.
          </span>
          <button type="button" className="text-link" onClick={() => setSearchParams({}, { replace: true })}>
            Clear project filter
          </button>
        </Card>
      ) : null}

      <Card>
        <SectionHeading
          title="Review queue"
          description="Submissions and current expenditure claims that are awaiting an independent decision, oldest first."
          action={<span className="scope-note">{pluralize(items.length, 'record')}</span>}
        />
        {queueQuery.isLoading ? <LoadingCard label="Loading the review queue…" /> : queueQuery.isError ? (
          <ErrorState error={queueQuery.error} title="The review queue could not be loaded" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="Nothing is awaiting review"
            description={
              projectFilter
                ? 'This project has no records awaiting review in your scope.'
                : 'New milestone submissions and expenditure claims will appear here.'
            }
          />
        ) : (
          <ul className="queue-list queue-list--large">
            {items.map((item) => (
              <li key={`${item.targetType}-${item.targetId}`}>
                <Link to={`/review/${item.targetType}/${item.targetId}?projectId=${item.projectId}`}>
                  <span className={`queue-age${item.ageDays >= 3 ? ' queue-age--old' : ''}`}>{item.ageDays}d</span>
                  <div className="queue-list__body">
                    <div className="badge-row">
                      <StatusBadge value={item.targetType} />
                      <span className="scope-note">Version {item.targetVersion}</span>
                    </div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.projectCode} · {item.projectTitle}
                    </span>
                    <small>
                      Submitted {relativeTime(item.submittedAt)} by {item.submittedByName ?? 'unknown user'} ·{' '}
                      {formatDateTime(item.submittedAt)}
                    </small>
                  </div>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="split-panel">
        <div className="split-panel__text">
          <span className="eyebrow">Independence rules</span>
          <h2>What the server checks before a decision is accepted</h2>
          <ul className="trail-links">
            <li><ShieldCheck size={15} aria-hidden="true" />The reviewer holds an active assignment for the project.</li>
            <li><ShieldCheck size={15} aria-hidden="true" />The reviewer is not the project owner and did not submit the record.</li>
            <li><ShieldCheck size={15} aria-hidden="true" />The record is still awaiting a decision for that version.</li>
            <li><ShieldCheck size={15} aria-hidden="true" />No decision already exists for the same target version.</li>
          </ul>
        </div>
        <Card>
          <SectionHeading title="Decision meanings" />
          <dl className="role-list">
            <div>
              <dt><StatusBadge value="APPROVED" /></dt>
              <dd>Accepted for this version. For a milestone, the milestone becomes approved; for a claim, it becomes approved. This is not proof of payment.</dd>
            </div>
            <div>
              <dt><StatusBadge value="REJECTED" /></dt>
              <dd>The record is not accepted at this version. A corrected version may be submitted.</dd>
            </div>
            <div>
              <dt><StatusBadge value="CHANGES_REQUESTED" /></dt>
              <dd>Clarification or correction is required. The record is treated as rejected for this version so a new version can be submitted.</dd>
            </div>
            <div>
              <dt><StatusBadge value="DISCREPANCY_OPENED" /></dt>
              <dd>A discrepancy is recorded. It remains visible as an open accountability issue until it is resolved through a later version and decision.</dd>
            </div>
          </dl>
          <p className="muted-note">
            <CalendarClock size={14} aria-hidden="true" /> Decisions are final for the target version; changes require a new record version.
          </p>
        </Card>
      </div>

      <p className="muted-note">
        <SearchCheck size={14} aria-hidden="true" /> Review decisions are recorded in the append-only audit chain and can themselves be anchored.
        <ClipboardCheck size={14} aria-hidden="true" /> Accountable decisions take time; the queue shows age in days without hiding it.
      </p>
    </div>
  );
}
