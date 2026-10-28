import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnchorSummary,
  AuditEventView,
  AuditIntegrityView,
  BudgetChangeView,
  ClaimView,
  CurrencyTotal,
  EvidenceView,
  MilestoneView,
  ProjectStatusChangeView,
  ReviewerAssignmentView,
  ReviewView,
  SubmissionView,
} from '@poi/shared';
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  CalendarDays,
  Clock,
  FileText,
  FolderOpen,
  Landmark,
  ListChecks,
  MapPin,
  MessageSquare,
  Plus,
  SearchCheck,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Upload,
  UserCheck,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AuditTimeline } from '../components/domain/AuditTimeline';
import { EvidenceCard } from '../components/domain/EvidenceCard';
import { EvidenceUploadModal } from '../components/domain/EvidenceUploadModal';
import { RecordAnchorAction } from '../components/domain/RecordAnchorAction';
import {
  DemoBadge,
  EvidenceBadge,
  OutcomeBadge,
  PrivateBadge,
  StatusBadge,
  ToneBadge,
} from '../components/ui/Badges';
import { buttonClass, Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Alert, EmptyState, ErrorState, LoadingBlock, LoadingCard } from '../components/ui/Feedback';
import { Card, DetailGrid, DetailItem, PageHeader, Pagination, ProgressBar, SectionHeading, Tabs } from '../components/ui/Layout';
import { MonoValue } from '../components/ui/Primitives';
import { useAuth } from '../features/auth/AuthProvider';
import { useMeta } from '../features/meta/MetaProvider';
import {
  BudgetChangeModal,
  ClaimFormModal,
  MilestoneCreateModal,
  MilestoneSubmitModal,
  ReportGenerateModal,
  ReviewerAssignModal,
  StatusChangeModal,
} from '../features/projects/ProjectModals';
import { useToast } from '../features/ui/ToastProvider';
import { api, errorMessage } from '../lib/api';
import { anchoringGapDescription } from '../lib/chain';
import {
  allowedTransitions,
  formatBytes,
  formatDate,
  formatDateTime,
  formatMoney,
  labelFor,
  pluralize,
  relativeTime,
  shortHash,
} from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';

type TabKey = 'overview' | 'milestones' | 'expenditure' | 'evidence' | 'reviews' | 'activity' | 'anchors' | 'reviewers';

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const { meta } = useMeta();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') ?? 'overview') as TabKey;

  const [statusOpen, setStatusOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [milestoneCreateOpen, setMilestoneCreateOpen] = useState(false);
  const [submitMilestone, setSubmitMilestone] = useState<MilestoneView | null>(null);
  const [claimFormOpen, setClaimFormOpen] = useState(false);
  const [amendClaim, setAmendClaim] = useState<ClaimView | null>(null);
  const [reviewerAssignOpen, setReviewerAssignOpen] = useState(false);
  const [removeAssignment, setRemoveAssignment] = useState<ReviewerAssignmentView | null>(null);
  const [claimStatus, setClaimStatus] = useState('');
  const [claimHistory, setClaimHistory] = useState(false);
  const [auditPage, setAuditPage] = useState(1);

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId ?? ''),
    queryFn: () => api.get<import('@poi/shared').ProjectDetail>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });
  const project = projectQuery.data;
  const permissions = project?.permissions;
  const canSeeInternal = Boolean(permissions?.canSeeRestrictedData);
  const canAnchor = Boolean(permissions?.canAnchor);

  usePageTitle(project?.code ?? 'Project record');

  const needsEvidence = activeTab === 'milestones' || activeTab === 'expenditure' || activeTab === 'evidence';

  const evidenceQuery = useQuery({
    queryKey: queryKeys.evidence(projectId ?? ''),
    queryFn: () => api.get<EvidenceView[]>(`/projects/${projectId}/evidence`),
    enabled: Boolean(project) && needsEvidence,
  });
  const milestonesQuery = useQuery({
    queryKey: queryKeys.milestones(projectId ?? ''),
    queryFn: () => api.get<MilestoneView[]>(`/projects/${projectId}/milestones`),
    enabled: Boolean(project) && activeTab === 'milestones',
  });
  const claimsQuery = useQuery({
    queryKey: queryKeys.claims(projectId ?? '', { status: claimStatus, history: claimHistory }),
    queryFn: async () => {
      const result = await api.getPage<ClaimView>(`/projects/${projectId}/claims`, {
        page: 1,
        pageSize: 100,
        status: claimStatus || undefined,
        history: claimHistory && canSeeInternal ? 'true' : undefined,
      });
      return result;
    },
    enabled: Boolean(project) && activeTab === 'expenditure',
  });
  const reviewsQuery = useQuery({
    queryKey: queryKeys.reviews(projectId ?? ''),
    queryFn: () => api.get<ReviewView[]>(`/projects/${projectId}/reviews`),
    enabled: Boolean(project) && activeTab === 'reviews',
  });
  const anchorsQuery = useQuery({
    queryKey: queryKeys.anchors({ projectId: projectId ?? '' }),
    queryFn: async () => {
      const result = await api.getPage<AnchorSummary>('/anchors', { projectId, page: 1, pageSize: 100 });
      return result.data;
    },
    enabled: Boolean(project) && activeTab === 'anchors',
  });
  const auditQuery = useQuery({
    queryKey: queryKeys.audit({ projectId, page: auditPage }),
    queryFn: async () => {
      const result = await api.getPage<AuditEventView>('/audit', { projectId, page: auditPage, pageSize: 20 });
      return result;
    },
    enabled: Boolean(project) && activeTab === 'activity',
  });
  const integrityQuery = useQuery({
    queryKey: queryKeys.auditIntegrity,
    queryFn: () => api.get<AuditIntegrityView>('/audit/integrity'),
    enabled: Boolean(project) && activeTab === 'activity',
  });
  const budgetHistoryQuery = useQuery({
    queryKey: ['budget-history', projectId],
    queryFn: () => api.get<BudgetChangeView[]>(`/projects/${projectId}/budget-history`),
    enabled: Boolean(project) && activeTab === 'overview',
  });
  const statusHistoryQuery = useQuery({
    queryKey: ['status-history', projectId],
    queryFn: () => api.get<ProjectStatusChangeView[]>(`/projects/${projectId}/status-history`),
    enabled: Boolean(project) && activeTab === 'overview',
  });
  const reviewersQuery = useQuery({
    queryKey: queryKeys.reviewers(projectId ?? ''),
    queryFn: () => api.get<ReviewerAssignmentView[]>(`/projects/${projectId}/reviewers`),
    enabled: Boolean(project) && activeTab === 'reviewers' && Boolean(user) && canSeeInternal,
  });

  const removeReviewerMutation = useMutation({
    mutationFn: (assignmentId: string) => api.delete(`/projects/${projectId}/reviewers/${assignmentId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.reviewers(projectId ?? '') });
      void queryClient.invalidateQueries({ queryKey: qkEligible(projectId ?? '') });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      notify('Reviewer assignment removed. Historical reviews remain intact.', 'success');
      setRemoveAssignment(null);
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  function qkEligible(id: string) {
    return queryKeys.eligibleReviewers(id);
  }

  function setTab(tab: TabKey) {
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    next.delete('page');
    setSearchParams(next);
    setAuditPage(1);
  }

  if (!projectId) {
    return <ErrorState error={new Error('The project reference is missing.')} title="Project not found" />;
  }

  if (projectQuery.isLoading) {
    return <div className="page-stack"><LoadingCard label="Loading project record…" /></div>;
  }

  if (projectQuery.isError || !project) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Project record" title="Project unavailable" backTo="/projects" backLabel="Projects" />
        <ErrorState
          error={projectQuery.error}
          title="This project could not be loaded"
          action={<Link to="/projects" className={buttonClass('secondary', 'sm')}>Back to the directory</Link>}
        />
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'milestones', label: 'Milestones' },
    { key: 'expenditure', label: 'Expenditure' },
    { key: 'evidence', label: 'Evidence' },
    { key: 'reviews', label: 'Reviews' },
    { key: 'activity', label: 'Activity' },
    { key: 'anchors', label: 'Chain anchors' },
  ];
  if (canSeeInternal) tabs.push({ key: 'reviewers', label: 'Reviewers' });

  const transitions = user && user.role !== 'REVIEWER' && user.role !== 'OBSERVER'
    ? allowedTransitions(project.status, user.role)
    : [];
  const evidence = evidenceQuery.data ?? [];
  const milestones = milestonesQuery.data ?? [];
  const claims = claimsQuery.data?.data ?? [];
  const reviews = reviewsQuery.data ?? [];
  const anchors = anchorsQuery.data ?? [];
  const activeReviewers = (reviewersQuery.data ?? []).filter((assignment) => assignment.active);
  const historicalReviewers = (reviewersQuery.data ?? []).filter((assignment) => !assignment.active);

  const budgetLabels = (totals: CurrencyTotal[]) =>
    totals.length === 0 ? '—' : totals.map((total) => formatMoney(total.amount, total.currency)).join(' · ');

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${project.code} · ${project.categoryLabel}`}
        title={project.title}
        backTo="/projects"
        backLabel="Projects"
        description={
          <div className="project-title-meta">
            <div className="badge-row">
              <StatusBadge value={project.status} dot />
              <PrivateBadge />
              {project.isDemo ? <DemoBadge /> : null}
              {project.version > 1 ? <ToneBadge tone="neutral">Record v{project.version}</ToneBadge> : null}
            </div>
            <p>
              <MapPin size={14} aria-hidden="true" />{project.locationName}
              <span className="dot-separator" aria-hidden="true">·</span>
              {project.organization.name}
              <span className="dot-separator" aria-hidden="true">·</span>
              {formatDate(project.startDate)} – {formatDate(project.endDate)}
            </p>
          </div>
        }
        actions={
          <div className="action-bar">
            {permissions?.canEditProject ? (
              <Link to={`/projects/${project.id}/edit`} className={buttonClass('secondary', 'sm')}>Edit record</Link>
            ) : null}
            {permissions?.canEditProject ? (
              <Button variant="secondary" size="sm" onClick={() => setBudgetOpen(true)}>Change budget</Button>
            ) : null}
            {transitions.length > 0 ? (
              <Button variant="primary" size="sm" onClick={() => setStatusOpen(true)}>Project status</Button>
            ) : null}
            {permissions?.canGenerateReport ? (
              <Button variant="secondary" size="sm" onClick={() => setReportOpen(true)}><FileText size={15} aria-hidden="true" /> Report</Button>
            ) : null}
            {canAnchor && !['DRAFT', 'SUBMITTED'].includes(project.status) ? (
              <RecordAnchorAction recordType="PROJECT" recordId={project.id} label="Anchor project" />
            ) : null}
          </div>
        }
      />

      <section className="project-summary">
        <div className="project-summary__money">
          <div>
            <span>Approved budget</span>
            <strong>{formatMoney(project.budgetAmount, project.currency)}</strong>
          </div>
          <div>
            <span>Claims recorded</span>
            <strong>{formatMoney(project.claimedAmount, project.currency)}</strong>
          </div>
          <div>
            <span>Approved claims</span>
            <strong>{formatMoney(project.approvedClaimAmount, project.currency)}</strong>
          </div>
          <div>
            <span>Open discrepancies</span>
            <strong className={project.openDiscrepancies > 0 ? 'text-danger' : undefined}>{project.openDiscrepancies}</strong>
          </div>
        </div>
        <div className="project-summary__progress">
          <ProgressBar value={project.milestoneStats.completionPercent} label={`Milestones completed (${project.milestoneStats.completed}/${project.milestoneStats.total})`} />
          <p>
            {project.milestoneStats.overdue > 0
              ? `${pluralize(project.milestoneStats.overdue, 'milestone is', 'milestones are')} overdue.`
              : 'No milestones are currently overdue.'}
          </p>
        </div>
      </section>

      {project.status === 'DRAFT' || project.status === 'SUBMITTED' ? (
        <Alert tone="info" compact title="This is a working record">
          {project.visibility === 'PUBLIC'
            ? 'The project is marked public, but draft and submitted records are not exposed in the public directory until approved.'
            : 'This record is private and visible only to its owner, assigned reviewer and administrators.'}
        </Alert>
      ) : null}

      <Tabs tabs={tabs} active={activeTab} onChange={setTab} />

      {activeTab === 'overview' ? (
        <OverviewTab
          project={project}
          budgetHistory={budgetHistoryQuery.data ?? []}
          statusHistory={statusHistoryQuery.data ?? []}
          loadingHistory={budgetHistoryQuery.isLoading || statusHistoryQuery.isLoading}
        />
      ) : null}

      {activeTab === 'milestones' ? (
        <section className="page-stack">
          <SectionHeading
            title="Delivery milestones"
            description="Milestones make progress observable. Submissions require evidence and an independent decision; neither the owner nor the browser can approve them."
            action={permissions?.canEditProject ? (
              <Button size="sm" onClick={() => setMilestoneCreateOpen(true)}><Plus size={15} aria-hidden="true" /> Add milestone</Button>
            ) : undefined}
          />
          {milestonesQuery.isLoading ? <LoadingCard label="Loading milestones…" /> : milestonesQuery.isError ? (
            <ErrorState error={milestonesQuery.error} />
          ) : milestones.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No milestones have been recorded"
              description="An administrator must approve at least one milestone plan before approving the project."
              action={permissions?.canEditProject ? <Button size="sm" onClick={() => setMilestoneCreateOpen(true)}>Add the first milestone</Button> : undefined}
            />
          ) : (
            <div className="milestone-list">
              {milestones.map((milestone) => (
                <MilestoneCard
                  key={milestone.id}
                  milestone={milestone}
                  projectId={project.id}
                  canSubmit={Boolean(permissions?.canSubmitRecords)}
                  canReview={Boolean(permissions?.canReview)}
                  canAnchor={canAnchor}
                  evidence={evidence}
                  currency={project.currency}
                  onStart={async () => {
                    try {
                      await api.post(`/milestones/${milestone.id}/start`);
                      await queryClient.invalidateQueries({ queryKey: queryKeys.milestones(project.id) });
                      await queryClient.invalidateQueries({ queryKey: queryKeys.project(project.id) });
                      notify('Milestone started.', 'success');
                    } catch (startError) {
                      notify(errorMessage(startError), 'error');
                    }
                  }}
                  onSubmit={() => setSubmitMilestone(milestone)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'expenditure' ? (
        <section className="page-stack">
          <SectionHeading
            title="Expenditure claims"
            description="Claims record expenditure, not payments. Owners submit supporting evidence; an assigned reviewer decides. Amounts use fixed-precision decimals."
            action={permissions?.canSubmitRecords ? (
              <Button size="sm" onClick={() => { setAmendClaim(null); setClaimFormOpen(true); }}>
                <Plus size={15} aria-hidden="true" /> Record claim
              </Button>
            ) : undefined}
          />
          <div className="filter-bar">
            <label className="inline-select">
              <span>Status</span>
              <select value={claimStatus} onChange={(event) => setClaimStatus(event.target.value)}>
                <option value="">All statuses</option>
                {['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISPUTED'].map((value) => (
                  <option key={value} value={value}>{labelFor(value)}</option>
                ))}
              </select>
            </label>
            {canSeeInternal ? (
              <label className="checkbox-field">
                <input type="checkbox" checked={claimHistory} onChange={(event) => setClaimHistory(event.target.checked)} />
                Include superseded versions
              </label>
            ) : null}
            <span className="filter-bar__scope">{canSeeInternal ? 'Including restricted records visible to your role.' : 'Public current claims only.'}</span>
          </div>
          {claimsQuery.isLoading ? <LoadingCard label="Loading expenditure claims…" /> : claimsQuery.isError ? (
            <ErrorState error={claimsQuery.error} />
          ) : claims.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No expenditure claims in this view"
              description={claimStatus ? 'No claims match the selected status.' : 'Claims appear here after the project owner records expenditure and attaches evidence.'}
            />
          ) : (
            <div className="claim-list">
              {claims.map((claim) => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  projectId={project.id}
                  canReview={Boolean(permissions?.canReview)}
                  canAnchor={canAnchor}
                  canAmend={Boolean(permissions?.canSubmitRecords) && claim.isCurrent && ['SUBMITTED', 'REJECTED', 'DISPUTED'].includes(claim.status)}
                  onAmend={() => { setAmendClaim(claim); setClaimFormOpen(true); }}
                />
              ))}
            </div>
          )}
          <p className="muted-note">Approved claims are review decisions, not confirmation that a supplier was paid.</p>
        </section>
      ) : null}

      {activeTab === 'evidence' ? (
        <section className="page-stack">
          <SectionHeading
            title="Evidence library"
            description="Files are content-checked, stored under randomised names and accompanied by a SHA-256 checksum. Public and restricted evidence are clearly distinguished."
            action={permissions?.canUploadEvidence ? (
              <Button size="sm" onClick={() => setUploadOpen(true)}><Upload size={15} aria-hidden="true" /> Upload evidence</Button>
            ) : undefined}
          />
          {!canSeeInternal ? (
            <Alert tone="info" compact>
              Restricted evidence is withheld from public viewers. Only files marked public are shown.
            </Alert>
          ) : null}
          {evidenceQuery.isLoading ? <LoadingCard label="Loading evidence…" /> : evidenceQuery.isError ? (
            <ErrorState error={evidenceQuery.error} />
          ) : evidence.length === 0 ? (
            <EmptyState icon={FolderOpen} title="No evidence has been uploaded" description="Owners attach documents when submitting milestone or expenditure records." />
          ) : (
            <div className="evidence-grid">
              {evidence.map((item) => <EvidenceCard key={item.id} evidence={item} showUploader={canSeeInternal} />)}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'reviews' ? (
        <section className="page-stack">
          <SectionHeading
            title="Independent review decisions"
            description="A decision is recorded against a target version. Owners cannot review their own records, and reviewers must hold an active assignment."
          />
          {reviewsQuery.isLoading ? <LoadingCard label="Loading reviews…" /> : reviewsQuery.isError ? (
            <ErrorState error={reviewsQuery.error} />
          ) : reviews.length === 0 ? (
            <EmptyState icon={MessageSquare} title="No review decisions yet" description="Submitted milestones and claims appear in an assigned reviewer’s queue." />
          ) : (
            <div className="review-list">
              {reviews.map((review) => (
                <article className="review-card" key={review.id}>
                  <div className="review-card__top">
                    <OutcomeBadge decision={review.decision} />
                    <span className="review-card__target">{labelFor(review.targetType)} · version {review.targetVersion}</span>
                    <span className="review-card__date">{formatDateTime(review.createdAt)}</span>
                  </div>
                  <p className="review-card__rationale">{review.rationale}</p>
                  <div className="review-card__foot">
                    <span><UserCheck size={14} aria-hidden="true" />{review.reviewerName} · {labelFor(review.reviewerRole)}</span>
                    <div className="button-row button-row--compact">
                      {review.targetType === 'EXPENDITURE_CLAIM' ? (
                        <Link to={`/claims/${review.targetId}`} className="text-link">Open claim <ArrowRight size={13} aria-hidden="true" /></Link>
                      ) : (
                        <Link to={`/projects/${project.id}?tab=milestones`} className="text-link">Milestone record <ArrowRight size={13} aria-hidden="true" /></Link>
                      )}
                      {canAnchor ? <RecordAnchorAction recordType="REVIEW" recordId={review.id} label="Anchor decision" /> : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'activity' ? (
        <section className="page-stack">
          <SectionHeading
            title="Activity and audit history"
            description="The platform maintains an append-only, hash-chained event history. Public viewers see a restricted projection of it."
          />
          {integrityQuery.isLoading ? <LoadingCard label="Checking the audit chain…" /> : integrityQuery.isError ? (
            <ErrorState error={integrityQuery.error} />
          ) : integrityQuery.data ? (
            <Card className={`integrity-card${integrityQuery.data.valid ? '' : ' integrity-card--broken'}`}>
              <span className="integrity-card__icon" aria-hidden="true">
                {integrityQuery.data.valid ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
              </span>
              <div>
                <strong>{integrityQuery.data.valid ? 'Audit chain integrity verified' : 'Audit chain integrity check failed'}</strong>
                <p>
                  {pluralize(integrityQuery.data.checkedEvents, 'event')} checked at {formatDateTime(integrityQuery.data.checkedAt)}.
                  {integrityQuery.data.valid
                    ? ' Each event hash links to its predecessor.'
                    : ` The first broken link is at sequence ${integrityQuery.data.firstBrokenSeq ?? 'unknown'}.`}
                </p>
              </div>
              {integrityQuery.data.headHash ? <MonoValue value={integrityQuery.data.headHash} display={`head ${shortHash(integrityQuery.data.headHash, 12, 8)}`} /> : null}
            </Card>
          ) : null}
          {auditQuery.isLoading ? <LoadingBlock label="Loading audit events…" /> : auditQuery.isError ? (
            <ErrorState error={auditQuery.error} />
          ) : (
            <>
              <AuditTimeline events={auditQuery.data?.data ?? []} emptyLabel="No public audit events are available for this project." />
              <Pagination
                page={Number(auditQuery.data?.meta.page ?? 1)}
                totalPages={Number(auditQuery.data?.meta.totalPages ?? 1)}
                total={Number(auditQuery.data?.meta.total ?? 0)}
                onChange={setAuditPage}
                noun="events"
              />
            </>
          )}
          <p className="muted-note">
            Public audit output omits reviewer-assignment events and restricted-evidence events. Participant views can
            include additional internal events through the API.
          </p>
        </section>
      ) : null}

      {activeTab === 'anchors' ? (
        <section className="page-stack">
          <SectionHeading
            title="Blockchain commitments"
            description="Anchors create a versioned commitment to a record digest. Supersession is explicit; an earlier commitment is never silently replaced."
            action={canAnchor ? <RecordAnchorAction recordType="PROJECT" recordId={project.id} label="Prepare project anchor" /> : undefined}
          />
          <div className="chain-config-strip">
            <div>
              <span>Network</span>
              <strong>{meta?.chain.chainName ?? 'Unavailable'} {meta?.chain.chainId ? `(${meta.chain.chainId})` : ''}</strong>
            </div>
            <div>
              <span>Registry contract</span>
              <strong className="mono-inline">{meta?.chain.contractAddress ? shortHash(meta.chain.contractAddress, 10, 8) : 'Not configured'}</strong>
            </div>
            <div>
              <span>Confirmations required</span>
              <strong>{meta?.chain.requiredConfirmations ?? '—'}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{meta?.chain.anchoringAvailable ? 'Anchoring available' : 'Anchoring unavailable'}</strong>
            </div>
          </div>
          {!meta?.chain.anchoringAvailable ? (
            <Alert tone="warning" title="Anchoring is not configured in this environment">
              Anchoring is unavailable because {anchoringGapDescription(meta?.chain)}. Records remain off-chain and
              cannot be anchored until an operator completes the chain configuration. No anchor is fabricated in this
              state.
            </Alert>
          ) : null}
          {anchorsQuery.isLoading ? <LoadingCard label="Loading chain anchors…" /> : anchorsQuery.isError ? (
            <ErrorState error={anchorsQuery.error} />
          ) : anchors.length === 0 ? (
            <EmptyState
              icon={Blocks}
              title="No blockchain anchors exist for this project"
              description="Anchoring is optional. The absence of an anchor is not evidence of wrongdoing; it simply means no on-chain commitment has been submitted in this environment."
              action={canAnchor && meta?.chain.anchoringAvailable ? <RecordAnchorAction recordType="PROJECT" recordId={project.id} label="Prepare the first anchor" /> : undefined}
            />
          ) : (
            <div className="anchor-list">
              {anchors.map((anchor) => (
                <Link key={anchor.id} to={`/blockchain/${anchor.id}`} className="anchor-row">
                  <div className="anchor-row__main">
                    <div className="anchor-row__title">
                      <StatusBadge value={anchor.status} dot />
                      <strong>{labelFor(anchor.recordType)} v{anchor.recordVersion}</strong>
                    </div>
                    <span className="mono-inline">Commitment {shortHash(anchor.commitment, 12, 8)}</span>
                  </div>
                  <div className="anchor-row__meta">
                    <span>{anchor.txHash ? `Tx ${shortHash(anchor.txHash)}` : 'No transaction submitted'}</span>
                    <span>{anchor.anchoredAt ? formatDate(anchor.anchoredAt) : relativeTime(anchor.createdAt)}</span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'reviewers' && canSeeInternal ? (
        <section className="page-stack">
          <SectionHeading
            title="Independent reviewer assignments"
            description="Reviewer independence is enforced in the API: only active assignees may record decisions, and an owner can never review their own record."
            action={permissions?.canManageReviewers ? (
              <Button size="sm" onClick={() => setReviewerAssignOpen(true)}><Plus size={15} aria-hidden="true" /> Assign reviewer</Button>
            ) : undefined}
          />
          {!user ? (
            <Alert tone="info">Sign in to view reviewer assignments.</Alert>
          ) : reviewersQuery.isLoading ? <LoadingCard /> : reviewersQuery.isError ? (
            <ErrorState error={reviewersQuery.error} />
          ) : (
            <>
              {activeReviewers.length === 0 ? (
                <EmptyState icon={Users} title="No active reviewer assignment" description="An administrator must assign an independent reviewer before this project’s records can be decided." />
              ) : (
                <div className="reviewer-list">
                  {activeReviewers.map((assignment) => (
                    <article className="reviewer-card" key={assignment.id}>
                      <span className="avatar avatar--large">{assignment.reviewer.fullName.slice(0, 2).toUpperCase()}</span>
                      <div className="reviewer-card__body">
                        <div className="reviewer-card__top">
                          <strong>{assignment.reviewer.fullName}</strong>
                          <ToneBadge tone="positive">Active assignment</ToneBadge>
                        </div>
                        {assignment.reviewerEmail ? <span className="reviewer-card__email">{assignment.reviewerEmail}</span> : null}
                        <p>Assigned {relativeTime(assignment.assignedAt)}.</p>
                        {assignment.conflictNote ? <p className="reviewer-card__conflict"><ShieldAlert size={14} aria-hidden="true" /> {assignment.conflictNote}</p> : <p className="reviewer-card__conflict reviewer-card__conflict--none">No declared conflict.</p>}
                      </div>
                      {permissions?.canManageReviewers ? (
                        <Button variant="ghost" size="sm" onClick={() => setRemoveAssignment(assignment)}>Remove</Button>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
              {historicalReviewers.length > 0 ? (
                <details className="history-details">
                  <summary>Earlier assignments ({historicalReviewers.length})</summary>
                  <div className="reviewer-list reviewer-list--muted">
                    {historicalReviewers.map((assignment) => (
                      <article className="reviewer-card" key={assignment.id}>
                        <div className="reviewer-card__body">
                          <div className="reviewer-card__top">
                            <strong>{assignment.reviewer.fullName}</strong>
                            <ToneBadge tone="neutral">Removed</ToneBadge>
                          </div>
                          <p>Removed {relativeTime(assignment.removedAt)}. Prior decisions remain attributed and visible.</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          )}
          <div className="card card--padded">
            <h3>Separation of duties</h3>
            <p>
              Project owner: {project.owner?.fullName ?? 'not disclosed to this view'}. The owner cannot review, approve
              or decide a claim or submission. Platform administrators manage assignments but cannot record a reviewer
              decision on the owner’s behalf.
            </p>
          </div>
        </section>
      ) : null}

      {statusOpen && user ? (
        <StatusChangeModal project={project} role={user.role} open={statusOpen} onClose={() => setStatusOpen(false)} />
      ) : null}
      <BudgetChangeModal project={project} open={budgetOpen} onClose={() => setBudgetOpen(false)} />
      <ReportGenerateModal project={project} open={reportOpen} onClose={() => setReportOpen(false)} />
      <EvidenceUploadModal projectId={project.id} open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <MilestoneCreateModal project={project} open={milestoneCreateOpen} onClose={() => setMilestoneCreateOpen(false)} />
      {submitMilestone ? (
        <MilestoneSubmitModal
          milestone={submitMilestone}
          evidence={evidence}
          open={Boolean(submitMilestone)}
          onClose={() => setSubmitMilestone(null)}
          onRequestUpload={() => {
            setSubmitMilestone(null);
            setUploadOpen(true);
          }}
        />
      ) : null}
      <ClaimFormModal
        project={project}
        evidence={evidence}
        claim={amendClaim ?? undefined}
        open={claimFormOpen}
        onClose={() => { setClaimFormOpen(false); setAmendClaim(null); }}
        onRequestUpload={() => {
          setClaimFormOpen(false);
          setAmendClaim(null);
          setUploadOpen(true);
        }}
      />
      <ReviewerAssignModal projectId={project.id} open={reviewerAssignOpen} onClose={() => setReviewerAssignOpen(false)} />
      <ConfirmDialog
        open={Boolean(removeAssignment)}
        onClose={() => setRemoveAssignment(null)}
        onConfirm={() => { if (removeAssignment) removeReviewerMutation.mutate(removeAssignment.id); }}
        title="Remove reviewer assignment?"
        description="The reviewer will no longer be able to decide new records. Reviews already recorded remain in the audit history and cannot be removed."
        confirmLabel="Remove assignment"
        tone="danger"
        loading={removeReviewerMutation.isPending}
      />
    </div>
  );
}

function OverviewTab({
  project,
  budgetHistory,
  statusHistory,
  loadingHistory,
}: {
  project: import('@poi/shared').ProjectDetail;
  budgetHistory: BudgetChangeView[];
  statusHistory: ProjectStatusChangeView[];
  loadingHistory: boolean;
}) {
  return (
    <div className="overview-grid">
      <Card className="overview-main">
        <SectionHeading title="About this project" />
        <p className="prose">{project.description}</p>
        <h3>Problem statement</h3>
        <p className="prose">{project.problemStatement}</p>
        <h3>Objectives</h3>
        <ol className="objective-display">
          {project.objectives.map((objective, index) => (
            <li key={objective}><span>{String(index + 1).padStart(2, '0')}</span><p>{objective}</p></li>
          ))}
        </ol>
        <div className="project-note">
          <ShieldCheck size={17} aria-hidden="true" />
          <p>
            Public records describe what was declared, submitted, reviewed and committed. They do not by themselves
            establish that a project was completed or that money was spent wisely.
          </p>
        </div>
      </Card>

      <div className="overview-side">
        <Card>
          <SectionHeading title="Record facts" />
          <DetailGrid>
            <DetailItem label="Project code">{project.code}</DetailItem>
            <DetailItem label="Category">{project.categoryLabel}</DetailItem>
            <DetailItem label="Organization">{project.organization.name}</DetailItem>
            <DetailItem label="Project owner">{project.owner?.fullName ?? 'Withheld from this view'}</DetailItem>
            <DetailItem label="Coordinates">{project.latitude.toFixed(5)}, {project.longitude.toFixed(5)}</DetailItem>
            <DetailItem label="Start date">{formatDate(project.startDate)}</DetailItem>
            <DetailItem label="Target completion">{formatDate(project.endDate)}</DetailItem>
            <DetailItem label="Approved at">{project.approvedAt ? formatDateTime(project.approvedAt) : 'Not approved'}</DetailItem>
            <DetailItem label="Visibility">{project.visibility === 'PUBLIC' ? 'Public directory (when approved)' : 'Private working record'}</DetailItem>
            <DetailItem label="Record version">v{project.version}</DetailItem>
            <DetailItem label="Created">{formatDateTime(project.createdAt)}</DetailItem>
            <DetailItem label="Updated">{formatDateTime(project.updatedAt)}</DetailItem>
          </DetailGrid>
        </Card>

        <Card>
          <SectionHeading title="Budget history" description="Each change is preserved as a new version." />
          {loadingHistory ? <LoadingBlock compact label="Loading budget history…" /> : budgetHistory.length === 0 ? (
            <p className="muted-note">No budget history is available.</p>
          ) : (
            <ul className="history-list">
              {budgetHistory.map((entry) => (
                <li key={entry.version}>
                  <div className="history-list__top">
                    <strong>{formatMoney(entry.amount, entry.currency)}</strong>
                    <span>v{entry.version}</span>
                  </div>
                  <p>{entry.reason}</p>
                  <small>{entry.changedByName ?? 'Withheld from this view'} · {formatDateTime(entry.createdAt)}</small>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeading title="Project status history" />
          {loadingHistory ? <LoadingBlock compact label="Loading status history…" /> : statusHistory.length === 0 ? (
            <p className="muted-note">No status changes recorded.</p>
          ) : (
            <ul className="history-list">
              {statusHistory.map((entry, index) => (
                <li key={`${entry.toStatus}-${index}`}>
                  <div className="history-list__top">
                    <StatusBadge value={entry.toStatus} />
                    <span>{entry.fromStatus ? `from ${labelFor(entry.fromStatus)}` : 'initial status'}</span>
                  </div>
                  {entry.reason ? <p>{entry.reason}</p> : null}
                  <small>{entry.changedByName ?? 'Withheld from this view'} · {formatDateTime(entry.createdAt)}</small>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeading title="Accountability trail" />
          <ul className="trail-links">
            <li><Link to={`/projects/${project.id}?tab=reviews`}><MessageSquare size={15} aria-hidden="true" />Independent reviews <ArrowRight size={13} aria-hidden="true" /></Link></li>
            <li><Link to={`/projects/${project.id}?tab=activity`}><ShieldCheck size={15} aria-hidden="true" />Audit history <ArrowRight size={13} aria-hidden="true" /></Link></li>
            <li><Link to={`/projects/${project.id}?tab=anchors`}><Blocks size={15} aria-hidden="true" />Chain anchors <ArrowRight size={13} aria-hidden="true" /></Link></li>
            <li><Link to="/verify"><BadgeCheck size={15} aria-hidden="true" />Verify a record <ArrowRight size={13} aria-hidden="true" /></Link></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function MilestoneCard({
  milestone,
  projectId,
  canSubmit,
  canReview,
  canAnchor,
  evidence,
  currency,
  onStart,
  onSubmit,
}: {
  milestone: MilestoneView;
  projectId: string;
  canSubmit: boolean;
  canReview: boolean;
  canAnchor: boolean;
  evidence: EvidenceView[];
  currency: string;
  onStart: () => void;
  onSubmit: () => void;
}) {
  const latest = milestone.latestSubmission;
  const canStart = canSubmit && milestone.status === 'PLANNED';
  const canSubmitNow = canSubmit && ['PLANNED', 'IN_PROGRESS', 'REJECTED'].includes(milestone.status);
  const canReviewNow = canReview && latest?.status === 'SUBMITTED';
  const unassignedEvidence = evidence.filter((item) => !item.milestoneId && !item.claimId).length;

  return (
    <article className="milestone-card">
      <div className="milestone-card__rail" aria-hidden="true">
        <span>{String(milestone.sequence).padStart(2, '0')}</span>
        <div />
      </div>
      <div className="milestone-card__body">
        <div className="milestone-card__top">
          <div>
            <div className="badge-row">
              <StatusBadge value={milestone.status} dot />
              {milestone.isOverdue ? <ToneBadge tone="danger"><Clock size={12} aria-hidden="true" />Overdue</ToneBadge> : null}
              {milestone.submissionCount > 0 ? <ToneBadge tone="neutral">v{milestone.version} · {pluralize(milestone.submissionCount, 'submission')}</ToneBadge> : null}
            </div>
            <h3>{milestone.title}</h3>
          </div>
          <span className="milestone-card__date"><CalendarDays size={14} aria-hidden="true" />Expected {formatDate(milestone.expectedCompletionDate)}</span>
        </div>
        <p className="prose">{milestone.description}</p>
        <div className="milestone-facts">
          <span><strong>Deliverables</strong>{milestone.deliverables}</span>
          <span><strong>Responsible</strong>{milestone.responsibleParty}</span>
          <span><strong>Allocation</strong>{milestone.allocatedBudget ? formatMoney(milestone.allocatedBudget, currency) : 'Not allocated'}</span>
        </div>

        {latest ? (
          <div className="submission-block" id={`submission-${latest.id}`}>
            <div className="submission-block__top">
              <div>
                <strong>Latest submission · v{latest.version}</strong>
                <small>{formatDateTime(latest.submittedAt)} · {latest.submittedByName ?? 'Submitter withheld from this view'}</small>
              </div>
              <StatusBadge value={latest.status} />
            </div>
            <p className="prose">{latest.summary}</p>
            {latest.evidence.length > 0 ? (
              <ul className="mini-file-list">
                {latest.evidence.map((item) => (
                  <li key={item.id}>
                    <FileText size={14} aria-hidden="true" />
                    <a href={item.downloadUrl} download>{item.file.originalName}</a>
                    <span>{formatBytes(item.file.sizeBytes)}</span>
                    <EvidenceBadge visibility={item.visibility} />
                  </li>
                ))}
              </ul>
            ) : null}
            {latest.review ? (
              <div className="submission-decision">
                <OutcomeBadge decision={latest.review.decision} />
                <div>
                  <strong>{latest.review.reviewerName}</strong>
                  <p>{latest.review.rationale}</p>
                  <small>{formatDateTime(latest.review.createdAt)}</small>
                </div>
                {canAnchor ? <RecordAnchorAction recordType="REVIEW" recordId={latest.review.id} label="Anchor decision" /> : null}
              </div>
            ) : (
              <p className="muted-note">Awaiting an independent decision.</p>
            )}
            <div className="button-row button-row--compact">
              {canReviewNow ? (
                <Link to={`/review/MILESTONE_SUBMISSION/${latest.id}?projectId=${projectId}`} className={buttonClass('primary', 'sm')}>
                  <SearchCheck size={14} aria-hidden="true" /> Review submission
                </Link>
              ) : null}
              {canAnchor ? <RecordAnchorAction recordType="MILESTONE_SUBMISSION" recordId={latest.id} label="Anchor submission" /> : null}
            </div>
          </div>
        ) : null}

        {milestone.submissionCount > 1 ? (
          <MilestoneHistory milestoneId={milestone.id} count={milestone.submissionCount} skipId={latest?.id} />
        ) : null}

        <div className="button-row milestone-card__actions">
          {canStart ? <Button size="sm" variant="secondary" onClick={onStart}>Start milestone</Button> : null}
          {canSubmitNow ? (
            <Button size="sm" onClick={onSubmit} disabled={unassignedEvidence === 0} title={unassignedEvidence === 0 ? 'Upload unassigned evidence first' : undefined}>
              <Upload size={14} aria-hidden="true" /> Submit completion
            </Button>
          ) : null}
          {canSubmitNow && unassignedEvidence === 0 ? <span className="muted-note">Upload evidence in the Evidence tab before submitting.</span> : null}
        </div>
      </div>
    </article>
  );
}

function MilestoneHistory({ milestoneId, count, skipId }: { milestoneId: string; count: number; skipId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const submissionsQuery = useQuery({
    queryKey: ['milestone-submissions', milestoneId],
    queryFn: () => api.get<SubmissionView[]>(`/milestones/${milestoneId}/submissions`),
    enabled: expanded,
  });
  const earlier = (submissionsQuery.data ?? []).filter((submission) => submission.id !== skipId);

  return (
    <div className="history-details">
      <button type="button" className="text-link" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        {expanded ? 'Hide earlier submissions' : `Earlier submissions (${Math.max(0, count - 1)})`}
      </button>
      {expanded ? (
        submissionsQuery.isLoading ? (
          <LoadingBlock compact label="Loading submission history…" />
        ) : submissionsQuery.isError ? (
          <p className="muted-note">{errorMessage(submissionsQuery.error)}</p>
        ) : (
          <div className="submission-history">
            {earlier.map((submission) => (
              <SubmissionHistoryEntry key={submission.id} submission={submission} />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function SubmissionHistoryEntry({ submission }: { submission: SubmissionView }) {
  return (
    <div className="submission-history__item">
      <div className="submission-block__top">
        <div><strong>v{submission.version}</strong><small>{formatDateTime(submission.submittedAt)}</small></div>
        <StatusBadge value={submission.status} />
      </div>
      <p>{submission.summary}</p>
      {submission.review ? (
        <div className="submission-decision submission-decision--compact">
          <OutcomeBadge decision={submission.review.decision} />
          <p>{submission.review.rationale}</p>
        </div>
      ) : null}
    </div>
  );
}

function ClaimCard({
  claim,
  projectId,
  canReview,
  canAnchor,
  canAmend,
  onAmend,
}: {
  claim: ClaimView;
  projectId: string;
  canReview: boolean;
  canAnchor: boolean;
  canAmend: boolean;
  onAmend: () => void;
}) {
  const reviewable = canReview && ['SUBMITTED', 'UNDER_REVIEW'].includes(claim.status);
  return (
    <article className={`claim-card${claim.isCurrent ? '' : ' claim-card--superseded'}`}>
      <div className="claim-card__top">
        <div>
          <div className="badge-row">
            <StatusBadge value={claim.status} dot />
            <ToneBadge tone="neutral">v{claim.version}</ToneBadge>
            {claim.overBudget ? <ToneBadge tone="warning"><TriangleAlert size={12} aria-hidden="true" />Over budget</ToneBadge> : null}
            {!claim.isCurrent ? <ToneBadge tone="neutral">Superseded</ToneBadge> : null}
          </div>
          <h3><Link to={`/claims/${claim.id}`}>{claim.reference}</Link></h3>
          <p className="claim-card__sub">{claim.category} · {formatDate(claim.claimedDate)} · recorded {relativeTime(claim.createdAt)}</p>
        </div>
        <div className="claim-card__amount">
          <strong>{formatMoney(claim.amount, claim.currency)}</strong>
          <span>{claim.submittedByName ? `Submitted by ${claim.submittedByName}` : 'Not submitted'}</span>
        </div>
      </div>
      <p className="prose">{claim.description}</p>
      {claim.supplierName ? <p className="claim-card__supplier">Supplier: {claim.supplierName}{claim.supplierReference ? ` · ${claim.supplierReference}` : ''}</p> : null}
      {claim.overBudget && claim.budgetExplanation ? (
        <div className="claim-card__over-budget"><TriangleAlert size={15} aria-hidden="true" /><p>{claim.budgetExplanation}</p></div>
      ) : null}
      {claim.evidence.length > 0 ? (
        <ul className="mini-file-list">
          {claim.evidence.map((item) => (
            <li key={item.id}>
              <FileText size={14} aria-hidden="true" />
              <a href={item.downloadUrl} download>{item.file.originalName}</a>
              <span>{formatBytes(item.file.sizeBytes)}</span>
              <EvidenceBadge visibility={item.visibility} />
            </li>
          ))}
        </ul>
      ) : <p className="muted-note">No evidence attached in this view.</p>}
      {claim.reviews.length > 0 ? (
        <div className="claim-card__reviews">
          {claim.reviews.map((review) => (
            <div key={review.id} className="submission-decision submission-decision--compact">
              <OutcomeBadge decision={review.decision} />
              <div><strong>{review.reviewerName}</strong><p>{review.rationale}</p><small>{formatDateTime(review.createdAt)}</small></div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="button-row button-row--compact claim-card__actions">
        <Link to={`/claims/${claim.id}`} className={buttonClass('secondary', 'sm')}>Open claim <ArrowRight size={14} aria-hidden="true" /></Link>
        {reviewable ? (
          <Link to={`/review/EXPENDITURE_CLAIM/${claim.id}?projectId=${projectId}`} className={buttonClass('primary', 'sm')}>
            <SearchCheck size={14} aria-hidden="true" /> Review claim
          </Link>
        ) : null}
        {canAmend ? <Button variant="ghost" size="sm" onClick={onAmend}>Create corrected version</Button> : null}
        {canAnchor && claim.status !== 'DRAFT' ? <RecordAnchorAction recordType="EXPENDITURE_CLAIM" recordId={claim.id} label="Anchor claim" /> : null}
      </div>
    </article>
  );
}
