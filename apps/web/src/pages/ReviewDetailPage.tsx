import type {
  ClaimView,
  EvidenceView,
  MilestoneView,
  ProjectDetail,
  ReviewDecision,
  ReviewView,
} from '@poi/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  FileText,
  GitCompareArrows,
  Info,
  Landmark,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EvidenceCard } from '../components/domain/EvidenceCard';
import { OutcomeBadge, StatusBadge, ToneBadge } from '../components/ui/Badges';
import { Button, buttonClass } from '../components/ui/Button';
import { Alert, EmptyState, ErrorState, FormErrorSummary, LoadingCard } from '../components/ui/Feedback';
import { Card, DetailGrid, DetailItem, PageHeader, SectionHeading } from '../components/ui/Layout';
import { Field, SelectField } from '../components/ui/Primitives';
import { useAuth } from '../features/auth/AuthProvider';
import { useToast } from '../features/ui/ToastProvider';
import { api, errorMessage } from '../lib/api';
import { fieldError } from '../lib/forms';
import { formatDate, formatDateTime, formatMoney, labelFor, relativeTime } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';
import type { ReviewQueueItem } from '../types';

type ReviewableTarget =
  | { kind: 'claim'; claim: ClaimView }
  | { kind: 'milestone'; milestone: MilestoneView; submission: NonNullable<MilestoneView['latestSubmission']> };

const decisionHelp: Record<ReviewDecision, string> = {
  APPROVED: 'Accept this version as reviewed. This does not confirm that money was paid.',
  REJECTED: 'Do not accept this version. The submitter may create a corrected version.',
  CHANGES_REQUESTED: 'Request a corrected version. This version is treated as rejected.',
  DISCREPANCY_OPENED: 'Record an open discrepancy that requires resolution before the record can be accepted.',
};

export function ReviewDetailPage() {
  const { targetType, targetId } = useParams<{ targetType: string; targetId: string }>();
  const [searchParams] = useSearchParams();
  const projectIdParam = searchParams.get('projectId') ?? '';
  const { user } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isClaim = targetType === 'EXPENDITURE_CLAIM';
  const isMilestone = targetType === 'MILESTONE_SUBMISSION';
  const validTarget = isClaim || isMilestone;

  const claimQuery = useQuery({
    queryKey: queryKeys.claim(targetId ?? ''),
    queryFn: () => api.get<ClaimView>(`/claims/${targetId}`),
    enabled: validTarget && isClaim && Boolean(targetId),
  });

  const queueQuery = useQuery({
    queryKey: queryKeys.reviewQueue,
    queryFn: () => api.get<ReviewQueueItem[]>('/reviews/queue'),
    enabled: validTarget && isMilestone && !projectIdParam,
  });
  const queued = queueQuery.data?.find((item) => item.targetId === targetId);
  const resolvedProjectId = isClaim
    ? claimQuery.data?.projectId ?? projectIdParam
    : projectIdParam || queued?.projectId || '';

  const milestonesQuery = useQuery({
    queryKey: queryKeys.milestones(resolvedProjectId),
    queryFn: () => api.get<MilestoneView[]>(`/projects/${resolvedProjectId}/milestones`),
    enabled: validTarget && isMilestone && Boolean(resolvedProjectId),
  });

  const projectQuery = useQuery({
    queryKey: queryKeys.project(resolvedProjectId),
    queryFn: () => api.get<ProjectDetail>(`/projects/${resolvedProjectId}`),
    enabled: Boolean(resolvedProjectId),
  });
  const project = projectQuery.data;

  usePageTitle(isClaim ? 'Review expenditure claim' : 'Review milestone submission');

  const [decision, setDecision] = useState<ReviewDecision | ''>('');
  const [rationale, setRationale] = useState('');
  const [error, setError] = useState<unknown>(null);

  const milestoneMatch = milestonesQuery.data?.find((milestone) => milestone.latestSubmission?.id === targetId);
  const target: ReviewableTarget | null = isClaim
    ? claimQuery.data
      ? { kind: 'claim', claim: claimQuery.data }
      : null
    : milestoneMatch?.latestSubmission
      ? { kind: 'milestone', milestone: milestoneMatch, submission: milestoneMatch.latestSubmission }
      : null;

  const existingReview: ReviewView | null =
    target?.kind === 'claim'
      ? target.claim.reviews.find((review) => review.targetVersion === target.claim.version) ?? null
      : target?.kind === 'milestone'
        ? target.submission.review
        : null;

  const actionable =
    target !== null &&
    !existingReview &&
    (target.kind === 'claim'
      ? ['SUBMITTED', 'UNDER_REVIEW'].includes(target.claim.status)
      : target.submission.status === 'SUBMITTED');

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ReviewView>('/reviews', {
        targetType,
        targetId,
        decision,
        rationale,
      }),
    onSuccess: async (review) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.reviewQueue });
      if (resolvedProjectId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.project(resolvedProjectId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.milestones(resolvedProjectId) });
        void queryClient.invalidateQueries({ queryKey: ['claims', resolvedProjectId] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.reviews(resolvedProjectId) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.claim(targetId ?? '') });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
      notify(`Decision recorded: ${labelFor(review.decision)}.`, 'success');
      navigate(
        isClaim ? `/claims/${targetId}` : `/projects/${resolvedProjectId}?tab=milestones`,
        { replace: true },
      );
    },
    onError: setError,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!decision) {
      notify('Choose a decision before submitting.', 'error');
      return;
    }
    mutation.mutate();
  }

  if (!validTarget || !targetId) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Independent review" title="Unknown review target" backTo="/review-queue" backLabel="Review queue" />
        <EmptyState icon={GitCompareArrows} title="This target type is not reviewable" description="Only milestone submissions and expenditure claims can be reviewed." />
      </div>
    );
  }

  if (!user) return null;

  const loading = claimQuery.isLoading || milestonesQuery.isLoading || projectQuery.isLoading;
  const targetError = claimQuery.error ?? milestonesQuery.error ?? projectQuery.error;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`Independent review · ${labelFor(targetType)}`}
        title={
          target?.kind === 'claim'
            ? target.claim.reference
            : target?.kind === 'milestone'
              ? target.milestone.title
              : 'Review target'
        }
        backTo="/review-queue"
        backLabel="Review queue"
        description={
          project ? (
            <div className="project-title-meta">
              <div className="badge-row">
                <StatusBadge value={isClaim ? (target?.kind === 'claim' ? target.claim.status : '') : target?.kind === 'milestone' ? target.submission.status : ''} dot />
                <ToneBadge tone="neutral">Version {target?.kind === 'claim' ? target.claim.version : target?.kind === 'milestone' ? target.submission.version : '—'}</ToneBadge>
                {project.isDemo ? <ToneBadge tone="neutral">Demonstration record</ToneBadge> : null}
              </div>
              <p>
                <Link to={`/projects/${project.id}`} className="text-link">{project.code} · {project.title}</Link>
                <span className="dot-separator" aria-hidden="true">·</span>
                Owner {project.owner?.fullName ?? 'not disclosed'}
              </p>
            </div>
          ) : undefined
        }
      />

      {loading ? <LoadingCard label="Loading the submitted record…" /> : targetError ? (
        <ErrorState error={targetError} title="The review target could not be loaded" />
      ) : !target ? (
        <EmptyState
          icon={GitCompareArrows}
          title="This record is not currently awaiting review"
          description={
            isMilestone
              ? 'Only the latest submitted version appears in the review queue. The record may already have a decision or a newer version may have replaced it.'
              : 'The claim may already have a decision, or it is not visible to your role.'
          }
          action={
            project ? (
              <Link to={`/projects/${project.id}?tab=${isClaim ? 'expenditure' : 'milestones'}`} className={buttonClass('secondary', 'sm')}>
                Open project record
              </Link>
            ) : undefined
          }
        />
      ) : !project ? (
        <EmptyState
          icon={ShieldAlert}
          title="Project context is unavailable"
          description="This decision requires the project record, but it could not be resolved. Open the review queue and choose the record again."
          action={
            <Link to="/review-queue" className={buttonClass('secondary', 'sm')}>
              Return to the review queue
            </Link>
          }
        />
      ) : (
        <>
          <div className="metric-strip">
            <div className="metric-strip__lead">
              <span>{isClaim ? 'Claim amount' : 'Milestone'}</span>
              <strong>
                {isClaim && target.kind === 'claim'
                  ? formatMoney(target.claim.amount, target.claim.currency)
                  : target.kind === 'milestone'
                    ? `#${String(target.milestone.sequence).padStart(2, '0')}`
                    : '—'}
              </strong>
            </div>
            <div>
              <span>Submitted</span>
              <strong>{relativeTime(isClaim && target.kind === 'claim' ? target.claim.submittedAt : target.kind === 'milestone' ? target.submission.submittedAt : null)}</strong>
            </div>
            <div>
              <span>Submitted by</span>
              <strong>{isClaim && target.kind === 'claim' ? target.claim.submittedByName ?? 'Unknown' : target.kind === 'milestone' ? target.submission.submittedByName ?? 'Unknown' : '—'}</strong>
            </div>
            <div>
              <span>Evidence</span>
              <strong>{isClaim && target.kind === 'claim' ? target.claim.evidence.length : target.kind === 'milestone' ? target.submission.evidence.length : 0} documents</strong>
            </div>
            <div>
              <span>Record version</span>
              <strong>v{isClaim && target.kind === 'claim' ? target.claim.version : target.kind === 'milestone' ? target.submission.version : '—'}</strong>
            </div>
          </div>

          {user.role !== 'REVIEWER' ? (
            <Alert tone="warning" title="Administrators cannot record reviewer decisions">
              The API accepts review decisions only from an independent reviewer with an active assignment. You can inspect
              the evidence and history, but a decision must be recorded by the assigned reviewer.
            </Alert>
          ) : project?.owner?.id === user.id ? (
            <Alert tone="danger" title="You own this project">
              An owner cannot review their own record. This submission must be decided by another assigned reviewer.
            </Alert>
          ) : null}

          <div className="two-column two-column--wide-left">
            <div className="page-stack">
              <Card>
                <SectionHeading
                  title={isClaim ? 'Claim declared by the project owner' : 'Completion submission'}
                />
                {target.kind === 'claim' ? (
                  <>
                    <p className="prose">{target.claim.description}</p>
                    <DetailGrid>
                      <DetailItem label="Category">{target.claim.category}</DetailItem>
                      <DetailItem label="Claimed date">{formatDate(target.claim.claimedDate)}</DetailItem>
                      <DetailItem label="Supplier">{target.claim.supplierName ?? 'Not recorded'}</DetailItem>
                      <DetailItem label="Supplier reference">{target.claim.supplierReference ?? 'Not recorded'}</DetailItem>
                      <DetailItem label="Submitted at">{formatDateTime(target.claim.submittedAt)}</DetailItem>
                      <DetailItem label="Project budget">{formatMoney(project.budgetAmount, project.currency)}</DetailItem>
                    </DetailGrid>
                    {target.claim.overBudget ? (
                      <div className="claim-card__over-budget">
                        <TriangleAlert size={16} aria-hidden="true" />
                        <div>
                          <strong>This claim is above the approved budget</strong>
                          <p>{target.claim.budgetExplanation ?? 'No explanation was recorded.'}</p>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="prose">{target.milestone.description}</p>
                    <h3>Completion summary</h3>
                    <p className="prose">{target.submission.summary}</p>
                    <DetailGrid>
                      <DetailItem label="Expected completion">{formatDate(target.milestone.expectedCompletionDate)}</DetailItem>
                      <DetailItem label="Deliverables">{target.milestone.deliverables}</DetailItem>
                      <DetailItem label="Responsible party">{target.milestone.responsibleParty}</DetailItem>
                      <DetailItem label="Allocated budget">
                        {target.milestone.allocatedBudget ? formatMoney(target.milestone.allocatedBudget, project.currency) : 'Not allocated'}
                      </DetailItem>
                    </DetailGrid>
                  </>
                )}
              </Card>

              <Card>
                <SectionHeading
                  title="Evidence supplied for this version"
                  description="Review the documents attached to this exact version. Later uploads do not retroactively support an earlier submission."
                />
                {(target.kind === 'claim' ? target.claim.evidence : target.submission.evidence).length === 0 ? (
                  <EmptyState icon={FileText} title="No evidence is visible in this view" />
                ) : (
                  <div className="evidence-grid evidence-grid--single">
                    {(target.kind === 'claim' ? target.claim.evidence : target.submission.evidence).map((item: EvidenceView) => (
                      <EvidenceCard key={item.id} evidence={item} showUploader />
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <SectionHeading title="Context for an independent decision" />
                <ul className="trail-links">
                  <li><Info size={15} aria-hidden="true" />The decision applies only to version {target.kind === 'claim' ? target.claim.version : target.submission.version}.</li>
                  <li><ShieldCheck size={15} aria-hidden="true" />Approval records a review outcome, not proof that goods were delivered or money was paid.</li>
                  <li><ShieldAlert size={15} aria-hidden="true" />If evidence is insufficient, request changes or open a discrepancy rather than approving on trust.</li>
                  <li><CalendarDays size={15} aria-hidden="true" />The decision, rationale and reviewer identity are written to the audit chain.</li>
                </ul>
              </Card>
            </div>

            <div className="page-stack">
              <Card className="decision-panel">
                <SectionHeading
                  title={existingReview ? 'Decision already recorded' : 'Record an independent decision'}
                  description={
                    existingReview
                      ? 'A decision is final for this record version.'
                      : 'Choose the outcome that the evidence supports. The server re-checks your assignment and independence.'
                  }
                />
                {existingReview ? (
                  <div className="submission-decision">
                    <OutcomeBadge decision={existingReview.decision} />
                    <div>
                      <strong>{existingReview.reviewerName}</strong>
                      <p>{existingReview.rationale}</p>
                      <small>{formatDateTime(existingReview.createdAt)}</small>
                    </div>
                  </div>
                ) : (
                  <form className="form-stack" onSubmit={submit}>
                    <FormErrorSummary error={error} />
                    <SelectField
                      id="review-decision"
                      label="Decision"
                      value={decision}
                      onChange={(value) => setDecision(value as ReviewDecision | '')}
                      placeholder="Select a decision"
                      options={(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'DISCREPANCY_OPENED'] as ReviewDecision[]).map((value) => ({
                        value,
                        label: labelFor(value),
                      }))}
                      required
                      error={fieldError(error, 'decision')}
                      disabled={!actionable || user.role !== 'REVIEWER'}
                    />
                    {decision ? <p className="form-note">{decisionHelp[decision]}</p> : null}
                    <Field
                      label="Review rationale"
                      htmlFor="review-rationale"
                      required
                      hint="At least 20 characters. Explain what you checked and why the evidence supports this decision."
                      error={fieldError(error, 'rationale')}
                    >
                      <textarea
                        id="review-rationale"
                        rows={7}
                        minLength={20}
                        maxLength={4000}
                        value={rationale}
                        onChange={(event) => setRationale(event.target.value)}
                        required
                        disabled={!actionable || user.role !== 'REVIEWER'}
                      />
                    </Field>
                    <Button
                      type="submit"
                      loading={mutation.isPending}
                      disabled={!actionable || user.role !== 'REVIEWER' || !decision || rationale.trim().length < 20}
                    >
                      Record decision
                    </Button>
                    {!actionable ? (
                      <p className="muted-note">This record is no longer awaiting a decision for the displayed version.</p>
                    ) : null}
                  </form>
                )}
              </Card>

              <Card>
                <SectionHeading title="Project context" />
                <DetailGrid>
                  <DetailItem label="Project status">
                    <StatusBadge value={project.status} />
                  </DetailItem>
                  <DetailItem label="Approved budget">{formatMoney(project.budgetAmount, project.currency)}</DetailItem>
                  <DetailItem label="Claims recorded">{formatMoney(project.claimedAmount, project.currency)}</DetailItem>
                  <DetailItem label="Approved claims">{formatMoney(project.approvedClaimAmount, project.currency)}</DetailItem>
                  <DetailItem label="Open discrepancies">{project.openDiscrepancies}</DetailItem>
                </DetailGrid>
                <div className="button-row">
                  <Link to={`/projects/${project.id}`} className={buttonClass('secondary', 'sm')}>
                    <Landmark size={14} aria-hidden="true" /> Open project record
                  </Link>
                  {isMilestone ? (
                    <Link to={`/projects/${project.id}?tab=expenditure`} className={buttonClass('ghost', 'sm')}>
                      Claims in this project <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  ) : null}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
