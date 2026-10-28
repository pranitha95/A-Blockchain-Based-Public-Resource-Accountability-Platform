import { useQuery } from '@tanstack/react-query';
import type { OverviewResponse } from '@poi/shared';
import {
  ArrowRight,
  Blocks,
  CalendarClock,
  CircleAlert,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Landmark,
  ListChecks,
  Plus,
  SearchCheck,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { StatCard } from '../components/domain/StatCard';
import { ChainStateBadge, StatusBadge } from '../components/ui/Badges';
import { buttonClass } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingCard } from '../components/ui/Feedback';
import { Card, PageHeader, SectionHeading } from '../components/ui/Layout';
import { useAuth } from '../features/auth/AuthProvider';
import { useMeta } from '../features/meta/MetaProvider';
import { api } from '../lib/api';
import {
  actionLabel,
  formatCompactMoney,
  formatDate,
  formatMoney,
  labelFor,
  percent,
  pluralize,
  relativeTime,
  roleLabel,
} from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';

function ScopeNote({ label }: { label: string }) {
  return <span className="scope-note">{label}</span>;
}

export function DashboardPage() {
  usePageTitle('Overview');
  const { user } = useAuth();
  const { meta } = useMeta();
  const overviewQuery = useQuery({
    queryKey: queryKeys.stats(user?.role),
    queryFn: () => api.get<OverviewResponse>('/stats/overview'),
    enabled: Boolean(user),
  });

  if (!user) return null;

  if (overviewQuery.isLoading) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow={roleLabel(user.role)} title={`Welcome, ${user.fullName.split(' ')[0]}`} />
        <div className="stat-grid"><LoadingCard /><LoadingCard /><LoadingCard /><LoadingCard /></div>
        <div className="two-column"><LoadingCard /><LoadingCard /></div>
      </div>
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow={roleLabel(user.role)} title={`Welcome, ${user.fullName.split(' ')[0]}`} />
        <ErrorState error={overviewQuery.error} title="Your overview could not be loaded" action={
          <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => void overviewQuery.refetch()}>
            Try again
          </button>
        } />
      </div>
    );
  }

  const overview = overviewQuery.data;
  const { metrics, projectStatusDistribution, budgetVsClaims, milestoneCompletionByMonth, recentActivity, reviewQueue } = overview;
  const budgetTotals = metrics.totalApprovedBudget;
  const primaryBudget = budgetTotals[0];
  const canReviewArea = user.role === 'REVIEWER' || user.role === 'ADMIN';

  const quickActions = user.role === 'ADMIN'
    ? [
        { to: '/projects/new', icon: Plus, label: 'Register a project', description: 'Create the next public record' },
        { to: '/admin/users', icon: ShieldCheck, label: 'Manage users', description: 'Roles, access and status' },
        { to: '/admin/settings', icon: Landmark, label: 'Platform settings', description: 'Directory and disclosure controls' },
      ]
    : user.role === 'PROJECT_OWNER'
      ? [
          { to: '/projects', icon: FolderKanban, label: 'Your projects', description: 'Milestones, evidence and expenditure' },
          { to: '/reports', icon: FileText, label: 'Accountability reports', description: 'Point-in-time records for your projects' },
          { to: '/verify', icon: ClipboardCheck, label: 'Verify a commitment', description: 'Check an on-chain record' },
        ]
      : user.role === 'REVIEWER'
        ? [
            { to: '/review-queue', icon: SearchCheck, label: 'Open review queue', description: 'Records awaiting an independent decision' },
            { to: '/projects', icon: FolderKanban, label: 'Assigned projects', description: 'Only your active assignments' },
            { to: '/verify', icon: ClipboardCheck, label: 'Verify a commitment', description: 'Check an on-chain record' },
          ]
        : [
            { to: '/projects', icon: FolderKanban, label: 'Explore projects', description: 'Public budgets and delivery records' },
            { to: '/verify', icon: ClipboardCheck, label: 'Verify a record', description: 'Inspect an anchored commitment' },
            { to: '/blockchain', icon: Blocks, label: 'Blockchain registry', description: 'Chain configuration and anchors' },
          ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${roleLabel(user.role)} · ${overview.scopeLabel}`}
        title={`Welcome, ${user.fullName.split(' ')[0]}`}
        description={
          <>
            Your overview is scoped to <strong>{overview.scopeLabel.toLowerCase()}</strong>. Figures are computed from
            the records your role can access, not from every record on the platform.
          </>
        }
        actions={
          <Link to={quickActions[0]!.to} className={buttonClass('primary')}>
            {quickActions[0]!.label} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        }
      />

      <div className="stat-grid">
        <StatCard
          icon={FolderKanban}
          label="Projects in your scope"
          value={metrics.totalProjects}
          hint={overview.scopeLabel}
          tone="navy"
        />
        <StatCard
          icon={Landmark}
          label="Approved budget in view"
          value={
            primaryBudget
              ? <span className="money-stack">{budgetTotals.map((total) => <span key={total.currency}>{formatCompactMoney(total.amount, total.currency)}</span>)}</span>
              : '—'
          }
          hint={budgetTotals.length > 1 ? 'Multiple reporting currencies' : primaryBudget ? primaryBudget.currency : 'No budget in scope'}
          tone="teal"
        />
        <StatCard
          icon={SearchCheck}
          label="Claims awaiting review"
          value={metrics.claimsAwaitingReview}
          hint="Independent decision required"
          tone="amber"
        />
        <StatCard
          icon={CircleAlert}
          label="Overdue milestones"
          value={metrics.overdueMilestones}
          hint={`${metrics.completedMilestones} completed milestones`}
          tone={metrics.overdueMilestones > 0 ? 'rose' : 'blue'}
        />
      </div>

      <div className="quick-grid">
        {quickActions.map(({ to, icon: Icon, label, description }) => (
          <Link key={to} to={to} className="quick-card">
            <span className="quick-card__icon" aria-hidden="true"><Icon size={18} /></span>
            <span><strong>{label}</strong><small>{description}</small></span>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ))}
      </div>

      <div className="dashboard-grid">
        <Card className="chart-card">
          <SectionHeading
            title="Projects by status"
            description="Status counts in your current access scope."
            action={<ScopeNote label={overview.scopeLabel} />}
          />
          {projectStatusDistribution.length === 0 ? (
            <EmptyState icon={FolderKanban} title="No projects in scope" description="Projects will appear as they are registered." />
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={projectStatusDistribution.map((item) => ({ ...item, label: labelFor(item.status) }))} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="#e5eaf1" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5d6b7f' }} interval={0} tickLine={false} axisLine={{ stroke: '#dce3ec' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5d6b7f' }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: 10, borderColor: '#dbe3ee', fontSize: 12 }} />
                  <Bar dataKey="count" name="Projects" radius={[6, 6, 0, 0]} fill="#1d4ed8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="chart-card">
          <SectionHeading
            title="Milestones completed"
            description="Completed milestones by month, based on recorded completion."
            action={<ScopeNote label="All time" />}
          />
          {milestoneCompletionByMonth.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No milestone completions yet" description="Completed milestones are grouped by month here." />
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={milestoneCompletionByMonth} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="milestoneFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0f766e" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e5eaf1" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#5d6b7f' }} tickLine={false} axisLine={{ stroke: '#dce3ec' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5d6b7f' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 10, borderColor: '#dbe3ee', fontSize: 12 }} />
                  <Area type="monotone" dataKey="count" name="Completed" stroke="#0f766e" strokeWidth={2} fill="url(#milestoneFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="dashboard-grid dashboard-grid--wide-left">
        <Card className="budget-panel">
          <SectionHeading
            title="Budget versus recorded claims"
            description="Recorded claims include submitted, approved and disputed amounts. They are not proof of payment."
          />
          {budgetVsClaims.length === 0 ? (
            <EmptyState icon={Landmark} title="No budget data in scope" />
          ) : (
            <div className="budget-bars">
              {budgetVsClaims.slice(0, 6).map((project) => {
                const budget = Number(project.budget);
                const claimed = Number(project.claimed);
                const max = Math.max(budget, claimed, 1);
                return (
                  <div className="budget-bars__item" key={project.projectId}>
                    <div className="budget-bars__head">
                      <Link to={`/projects/${project.projectId}`}>
                        <strong>{project.title}</strong>
                        <span>{project.code}</span>
                      </Link>
                      <span className="budget-bars__ratio">{percent(claimed, budget)}% of budget</span>
                    </div>
                    <div className="budget-bars__pair">
                      <div className="budget-bars__row">
                        <span>Approved budget</span>
                        <div className="budget-bars__track"><span className="budget-bars__fill budget-bars__fill--budget" style={{ width: `${(budget / max) * 100}%` }} /></div>
                        <strong>{formatMoney(project.budget, project.currency)}</strong>
                      </div>
                      <div className="budget-bars__row">
                        <span>Claims recorded</span>
                        <div className="budget-bars__track"><span className="budget-bars__fill budget-bars__fill--claimed" style={{ width: `${(claimed / max) * 100}%` }} /></div>
                        <strong>{formatMoney(project.claimed, project.currency)}</strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="dashboard-side">
          {canReviewArea ? (
            <Card className="queue-panel">
              <SectionHeading
                title="Independent review queue"
                description={user.role === 'REVIEWER' ? 'Only records from projects assigned to you.' : 'All records awaiting a reviewer.'}
                action={<Link to="/review-queue" className="text-link">Open queue <ArrowRight size={14} aria-hidden="true" /></Link>}
              />
              {reviewQueue.length === 0 ? (
                <EmptyState icon={ListChecks} title="Nothing awaiting review" description="New submissions and claims will appear here." />
              ) : (
                <ul className="queue-list">
                  {reviewQueue.slice(0, 4).map((item) => (
                    <li key={`${item.targetType}-${item.id}`}>
                      <Link to={`/review/${item.targetType}/${item.id}?projectId=${item.projectId}`}>
                        <div>
                          <strong>{item.title}</strong>
                          <span>{item.projectCode} · submitted {relativeTime(item.submittedAt)}</span>
                        </div>
                        <span className={`queue-age${item.ageDays >= 3 ? ' queue-age--old' : ''}`}>{item.ageDays}d</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card className="chain-panel">
            <SectionHeading
              title="Blockchain readiness"
              action={<ChainStateBadge available={Boolean(meta?.chain.anchoringAvailable)} />}
            />
            <dl className="mini-facts">
              <div><dt>Network</dt><dd>{meta?.chain.chainName ?? 'Unavailable'} {meta?.chain.chainId ? <span className="subtle">({meta.chain.chainId})</span> : null}</dd></div>
              <div><dt>Registry</dt><dd className="mono-inline">{meta?.chain.contractAddress ?? 'No contract configured'}</dd></div>
              <div><dt>Confirmed anchors</dt><dd>{metrics.anchoredRecords}</dd></div>
            </dl>
            {overview.anchoringActivity.length > 0 ? (
              <div className="anchor-status-list">
                {overview.anchoringActivity.map((item) => (
                  <div key={item.status}><StatusBadge value={item.status} /><span>{item.count}</span></div>
                ))}
              </div>
            ) : (
              <p className="muted-note">
                No anchor records exist in this environment. Demonstration records are not on-chain by default.
              </p>
            )}
            <Link to="/blockchain" className="text-link">Inspect blockchain records <ArrowRight size={14} aria-hidden="true" /></Link>
          </Card>
        </div>
      </div>

      <Card className="activity-panel">
        <SectionHeading
          title="Recent accountability activity"
          description="A compact view of the append-only event chain in your scope."
          action={<Link to="/projects" className="text-link">Browse projects <ArrowRight size={14} aria-hidden="true" /></Link>}
        />
        {recentActivity.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No recent activity" />
        ) : (
          <ul className="activity-list">
            {recentActivity.slice(0, 8).map((event) => (
              <li key={event.id}>
                <span className="activity-list__icon" aria-hidden="true"><ShieldCheck size={15} /></span>
                <div>
                  <strong>{actionLabel(event.action)}</strong>
                  <p>{event.summary}</p>
                </div>
                <span className="activity-list__meta">{formatDate(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <details className="scope-notes">
        <summary>How these figures are defined</summary>
        <dl>
          {Object.entries(overview.definitions).map(([key, value]) => (
            <div key={key}><dt>{labelFor(key)}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        <p>{pluralize(metrics.totalProjects, 'project')} · {pluralize(metrics.projectsInProgress, 'project', 'projects')} in progress.</p>
      </details>
    </div>
  );
}
