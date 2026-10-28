import type { ClaimView, EvidenceView, ProjectDetail } from '@poi/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  FileText,
  History,
  Landmark,
  SearchCheck,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EvidenceCard } from '../components/domain/EvidenceCard';
import { RecordAnchorAction } from '../components/domain/RecordAnchorAction';
import { OutcomeBadge, StatusBadge, ToneBadge } from '../components/ui/Badges';
import { buttonClass, Button } from '../components/ui/Button';
import { Alert, EmptyState, ErrorState, LoadingCard } from '../components/ui/Feedback';
import { Card, DetailGrid, DetailItem, PageHeader, SectionHeading } from '../components/ui/Layout';
import { ClaimFormModal } from '../features/projects/ProjectModals';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatMoney, labelFor, pluralize, relativeTime } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';

export function ClaimDetailPage() {
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [amendOpen, setAmendOpen] = useState(false);

  const claimQuery = useQuery({
    queryKey: queryKeys.claim(claimId ?? ''),
    queryFn: () => api.get<ClaimView>(`/claims/${claimId}`),
    enabled: Boolean(claimId),
  });
  const claim = claimQuery.data;

  const projectQuery = useQuery({
    queryKey: queryKeys.project(claim?.projectId ?? ''),
    queryFn: () => api.get<ProjectDetail>(`/projects/${claim!.projectId}`),
    enabled: Boolean(claim?.projectId),
  });
  const project = projectQuery.data;
  const permissions = project?.permissions;

  const versionsQuery = useQuery({
    queryKey: ['claim-versions', claim?.reference ?? ''],
    queryFn: () => api.get<ClaimView[]>(`/claims/${claim!.id}/versions`),
    enabled: Boolean(claim?.id),
  });

  const evidenceQuery = useQuery({
    queryKey: queryKeys.evidence(claim?.projectId ?? ''),
    queryFn: () => api.get<EvidenceView[]>(`/projects/${claim!.projectId}/evidence`),
    enabled: Boolean(claim?.projectId && permissions?.canSubmitRecords),
  });

  usePageTitle(claim ? `Expenditure claim ${claim.reference}` : 'Expenditure claim');

  if (!claimId) {
    return <ErrorState error={new Error('The claim reference is missing.')} title="Claim not found" />;
  }

  if (claimQuery.isLoading) {
    return <div className="page-stack"><LoadingCard label="Loading expenditure claim…" /></div>;
  }

  if (claimQuery.isError || !claim) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Expenditure claim" title="Claim unavailable" backTo="/projects" backLabel="Projects" />
        <ErrorState
          error={claimQuery.error}
          title="This expenditure claim could not be loaded"
          action={<Link to="/projects" className={buttonClass('secondary', 'sm')}>Back to projects</Link>}
        />
      </div>
    );
  }

  const canReview = Boolean(permissions?.canReview) && ['SUBMITTED', 'UNDER_REVIEW'].includes(claim.status);
  const canAmend =
    Boolean(permissions?.canSubmitRecords) &&
    claim.isCurrent &&
    ['SUBMITTED', 'REJECTED', 'DISPUTED'].includes(claim.status);
  const canAnchor = Boolean(permissions?.canAnchor) && claim.status !== 'DRAFT';
  const currentVersion = versionsQuery.data?.find((version) => version.isCurrent);
  const versions = versionsQuery.data ?? [claim];

  function returnToProjectEvidence() {
    setAmendOpen(false);
    navigate(`/projects/${claim!.projectId}?tab=evidence`);
    void queryClient.invalidateQueries({ queryKey: queryKeys.evidence(claim!.projectId) });
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`${claim.reference} · ${labelFor(claim.status)}`}
        title="Expenditure claim"
        backTo={`/projects/${claim.projectId}?tab=expenditure`}
        backLabel={project?.code ?? 'Project expenditure'}
        description={
          <div className="project-title-meta">
            <div className="badge-row">
              <StatusBadge value={claim.status} dot />
              <ToneBadge tone="neutral">Version {claim.version}</ToneBadge>
              {claim.isCurrent ? <ToneBadge tone="positive">Current version</ToneBadge> : <ToneBadge tone="neutral">Superseded</ToneBadge>}
              {claim.overBudget ? <ToneBadge tone="warning"><TriangleAlert size={12} aria-hidden="true" />Above budget</ToneBadge> : null}
            </div>
            <p>
              {project ? <Link to={`/projects/${project.id}`} className="text-link">{project.code} · {project.title}</Link> : `Project ${claim.projectId}`}
              <span className="dot-separator" aria-hidden="true">·</span>
              {claim.category}
              <span className="dot-separator" aria-hidden="true">·</span>
              Recorded {formatDate(claim.claimedDate)}
            </p>
          </div>
        }
        actions={
          <div className="action-bar">
            {canReview ? (
              <Link to={`/review/EXPENDITURE_CLAIM/${claim.id}?projectId=${claim.projectId}`} className={buttonClass('primary', 'sm')}>
                <SearchCheck size={15} aria-hidden="true" /> Review this claim
              </Link>
            ) : null}
            {canAmend ? (
              <Button size="sm" variant="secondary" onClick={() => setAmendOpen(true)}>
                <History size={15} aria-hidden="true" /> Create corrected version
              </Button>
            ) : null}
            {claim.isCurrent ? <RecordAnchorAction recordType="EXPENDITURE_CLAIM" recordId={claim.id} label="Anchor claim" /> : null}
          </div>
        }
      />

      {!claim.isCurrent ? (
        <Alert tone="warning" title="This is a historical claim version">
          Version {claim.version} has been superseded and must not be treated as the current record.
          {currentVersion ? (
            <> The current version is <Link to={`/claims/${currentVersion.id}`} className="text-link">version {currentVersion.version}</Link>.</>
          ) : null}
        </Alert>
      ) : null}

      <div className="metric-strip">
        <div className="metric-strip__lead">
          <span>Claim amount</span>
          <strong>{formatMoney(claim.amount, claim.currency)}</strong>
        </div>
        <div>
          <span>Claimed date</span>
          <strong>{formatDate(claim.claimedDate)}</strong>
        </div>
        <div>
          <span>Recorded</span>
          <strong>{relativeTime(claim.createdAt)}</strong>
        </div>
        <div>
          <span>Evidence attached</span>
          <strong>{pluralize(claim.evidence.length, 'document')}</strong>
        </div>
        <div>
          <span>Review decisions</span>
          <strong>{claim.reviews.length}</strong>
        </div>
      </div>

      <div className="two-column two-column--wide-left">
        <div className="page-stack">
          <Card>
            <SectionHeading title="What was claimed" />
            <p className="prose">{claim.description}</p>
            <DetailGrid>
              <DetailItem label="Expense category">{claim.category}</DetailItem>
              <DetailItem label="Supplier">{claim.supplierName ?? 'Not recorded'}</DetailItem>
              <DetailItem label="Supplier reference">{claim.supplierReference ?? 'Not recorded'}</DetailItem>
              <DetailItem label="Submitted by">{claim.submittedByName ?? 'Not available in this view'}</DetailItem>
              <DetailItem label="Submitted at">{claim.submittedAt ? formatDateTime(claim.submittedAt) : 'Not submitted'}</DetailItem>
              <DetailItem label="Project budget">{project ? formatMoney(project.budgetAmount, project.currency) : '—'}</DetailItem>
              <DetailItem label="Recorded claims">{project ? formatMoney(project.claimedAmount, project.currency) : '—'}</DetailItem>
              <DetailItem label="Approved claims">{project ? formatMoney(project.approvedClaimAmount, project.currency) : '—'}</DetailItem>
            </DetailGrid>
            {claim.overBudget && claim.budgetExplanation ? (
              <div className="claim-card__over-budget">
                <TriangleAlert size={16} aria-hidden="true" />
                <div>
                  <strong>Over-budget explanation recorded by the submitter</strong>
                  <p>{claim.budgetExplanation}</p>
                </div>
              </div>
            ) : null}
          </Card>

          <Card>
            <SectionHeading
              title="Supporting evidence"
              description="Files are content-checked on upload and stored with a SHA-256 checksum. A checksum confirms file integrity; it does not establish that the document is authentic or truthful."
            />
            {claim.evidence.length === 0 ? (
              <EmptyState icon={FileText} title="No evidence is visible in this view" description="Restricted evidence is withheld from public viewers." />
            ) : (
              <div className="evidence-grid evidence-grid--single">
                {claim.evidence.map((item) => (
                  <EvidenceCard key={item.id} evidence={item} showUploader={Boolean(permissions?.canSeeRestrictedData)} />
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionHeading
              title="Independent review decisions"
              description="A decision applies to a specific claim version. Owners cannot decide their own claims, and only an actively assigned reviewer may record a decision."
            />
            {claim.reviews.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="This claim has not been reviewed" description="It is either awaiting review or was recorded after the last published decision." />
            ) : (
              <div className="review-list">
                {claim.reviews.map((review) => (
                  <article className="review-card" key={review.id}>
                    <div className="review-card__top">
                      <OutcomeBadge decision={review.decision} />
                      <span className="review-card__target">Version {review.targetVersion}</span>
                      <span className="review-card__date">{formatDateTime(review.createdAt)}</span>
                    </div>
                    <p className="review-card__rationale">{review.rationale}</p>
                    <div className="review-card__foot">
                      <span>{review.reviewerName} · {labelFor(review.reviewerRole)}</span>
                      {canAnchor ? <RecordAnchorAction recordType="REVIEW" recordId={review.id} label="Anchor decision" /> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="page-stack">
          <Card>
            <SectionHeading title="Version history" description="Amendments create new versions. Earlier versions remain in the audit trail." />
            {versionsQuery.isLoading ? (
              <p className="muted-note">Loading versions…</p>
            ) : (
              <ol className="history-list history-list--linked">
                {versions
                  .slice()
                  .sort((a, b) => b.version - a.version)
                  .map((version) => (
                    <li key={version.id}>
                      <div className="history-list__top">
                        <Link to={`/claims/${version.id}`} className="text-link">
                          Version {version.version} {version.isCurrent ? '(current)' : '(superseded)'}
                        </Link>
                        <StatusBadge value={version.status} />
                      </div>
                      <p>{formatMoney(version.amount, version.currency)} · {version.category}</p>
                      <small>Recorded {formatDateTime(version.createdAt)}</small>
                    </li>
                  ))}
              </ol>
            )}
          </Card>

          <Card>
            <SectionHeading title="What this record means" />
            <ul className="trail-links">
              <li><CheckCircle2 size={15} aria-hidden="true" />A claim records declared expenditure and its supporting documents.</li>
              <li><ShieldCheck size={15} aria-hidden="true" />An approved claim is an independent reviewer decision, not proof of payment.</li>
              <li><Blocks size={15} aria-hidden="true" />A blockchain anchor commits to a record version but does not prove the record is true.</li>
            </ul>
            <div className="button-row">
              <Link to={`/projects/${claim.projectId}?tab=activity`} className={buttonClass('secondary', 'sm')}>
                <Landmark size={14} aria-hidden="true" /> Project audit trail
              </Link>
              <Link to="/verify" className={buttonClass('ghost', 'sm')}>
                Verify an anchor <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {project && permissions?.canSubmitRecords ? (
        <ClaimFormModal
          project={project}
          evidence={evidenceQuery.data ?? []}
          claim={claim}
          open={amendOpen}
          onClose={() => setAmendOpen(false)}
          onRequestUpload={returnToProjectEvidence}
        />
      ) : null}
    </div>
  );
}
