import type { ReportDetailView, ReviewView } from '@poi/shared';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  Download,
  FileJson,
  Fingerprint,
  Landmark,
  ListChecks,
  Printer,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { DemoBadge, OutcomeBadge, StatusBadge, ToneBadge } from '../components/ui/Badges';
import { Button, buttonClass } from '../components/ui/Button';
import { Alert, EmptyState, ErrorState, LoadingCard } from '../components/ui/Feedback';
import { Card, DetailGrid, DetailItem, PageHeader, SectionHeading } from '../components/ui/Layout';
import { MonoValue } from '../components/ui/Primitives';
import { useToast } from '../features/ui/ToastProvider';
import { api } from '../lib/api';
import { formatDate, formatDateTime, formatMoney, labelFor, percent, pluralize, shortHash } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';
import type { ReportSnapshot } from '../types';

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'proof-of-impact-report';
}

function downloadSnapshot(report: ReportDetailView, snapshot: ReportSnapshot) {
  const payload = {
    report: {
      id: report.id,
      title: report.title,
      format: report.format,
      checksum: report.checksum,
      generatedAt: snapshot.generatedAt,
      generatedBy: snapshot.generatedBy,
    },
    snapshot,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFilename(report.title)}-${report.id.slice(0, 8)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportDetailPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const { notify } = useToast();
  usePageTitle('Accountability report');

  const reportQuery = useQuery({
    queryKey: queryKeys.report(reportId ?? ''),
    queryFn: () => api.get<ReportDetailView>(`/reports/${reportId}`),
    enabled: Boolean(reportId),
  });

  if (!reportId) {
    return <ErrorState error={new Error('The report reference is missing.')} title="Report not found" />;
  }
  if (reportQuery.isLoading) {
    return <div className="page-stack"><LoadingCard label="Loading accountability report…" /></div>;
  }
  if (reportQuery.isError || !reportQuery.data) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Accountability report" title="Report unavailable" backTo="/reports" backLabel="Reports" />
        <ErrorState
          error={reportQuery.error}
          title="This report could not be loaded"
          action={<Link to="/reports" className={buttonClass('secondary', 'sm')}>Back to reports</Link>}
        />
      </div>
    );
  }

  const report = reportQuery.data;
  const snapshot = report.snapshot as unknown as ReportSnapshot;
  const project = snapshot.project;

  if (!project) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Accountability report" title={report.title} backTo="/reports" backLabel="Reports" />
        <Alert tone="warning" title="This report has an unexpected shape">
          The stored snapshot does not contain a project section. The raw snapshot remains available below; it cannot be
          rendered as a structured report.
        </Alert>
        <Card>
          <pre className="json-block">{JSON.stringify(report.snapshot, null, 2)}</pre>
        </Card>
      </div>
    );
  }

  const milestones = snapshot.milestones ?? [];
  const claims = snapshot.expenditureClaims?.items ?? [];
  const reviews = snapshot.reviews ?? [];
  const anchors = snapshot.anchors ?? [];
  const completedMilestones = project.milestoneStats?.completed ?? milestones.filter((milestone) => milestone.status === 'APPROVED').length;
  const totalMilestones = project.milestoneStats?.total ?? milestones.length;
  const objectiveList = project.objectives ?? [];

  return (
    <div className="page-stack report-document">
      <PageHeader
        eyebrow={`Accountability report · ${labelFor(report.format)}`}
        title={report.title}
        backTo="/reports"
        backLabel="Reports"
        description={
          <div className="project-title-meta">
            <div className="badge-row">
              <ToneBadge tone="neutral">Immutable snapshot</ToneBadge>
              {project.isDemo ? <DemoBadge /> : null}
              {project.visibility === 'PRIVATE' ? <ToneBadge tone="warning">Private project record</ToneBadge> : null}
            </div>
            <p>
              <Link to={`/projects/${project.id}`} className="text-link">{project.code} · {project.title}</Link>
              <span className="dot-separator" aria-hidden="true">·</span>
              Generated {formatDateTime(report.createdAt)} by {report.generatedByName ?? 'a removed account'}
            </p>
          </div>
        }
        actions={
          <div className="action-bar">
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer size={16} aria-hidden="true" /> Print report
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                downloadSnapshot(report, snapshot);
                notify('The stored report snapshot was exported as JSON.', 'success');
              }}
            >
              <FileJson size={16} aria-hidden="true" /> Export JSON
            </Button>
          </div>
        }
      />

      <Alert tone="info" title="A point-in-time record, not a live certification">
        This report reflects only the records visible to its generator when it was created. Later versions, decisions or
        anchors are not included. A matching checksum shows the stored snapshot has not changed; it does not prove the
        underlying records are true.
      </Alert>

      <div className="metric-strip report-metrics">
        <div className="metric-strip__lead">
          <span>Approved budget at generation</span>
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
          <span>Milestones completed</span>
          <strong>{completedMilestones}/{totalMilestones}</strong>
        </div>
        <div>
          <span>Audit events covered</span>
          <strong>{snapshot.audit?.count ?? '—'}</strong>
        </div>
      </div>

      <Card className="report-section">
        <SectionHeading title="1. Project record" description="The project as it appeared when this report was generated." />
        <div className="report-project-head">
          <div>
            <div className="badge-row">
              <StatusBadge value={project.status} dot />
              <ToneBadge tone="neutral">{project.categoryLabel}</ToneBadge>
              <ToneBadge tone="neutral">Record v{project.version}</ToneBadge>
            </div>
            <h2>{project.title}</h2>
            <p>{project.organization?.name ?? 'Organization not recorded'} · {project.locationName}</p>
          </div>
          <div className="report-project-head__budget">
            <span>Approved budget</span>
            <strong>{formatMoney(project.budgetAmount, project.currency)}</strong>
            <small>{percent(Number(project.claimedAmount), Number(project.budgetAmount))}% recorded as claims</small>
          </div>
        </div>

        <div className="report-prose">
          <h3>Description</h3>
          <p>{project.description}</p>
          <h3>Problem statement</h3>
          <p>{project.problemStatement}</p>
          <h3>Objectives</h3>
          <ol className="objective-display">
            {objectiveList.map((objective, index) => (
              <li key={`${index}-${objective}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{objective}</p></li>
            ))}
          </ol>
        </div>

        <DetailGrid className="report-detail-grid">
          <DetailItem label="Project code">{project.code}</DetailItem>
          <DetailItem label="Project owner">{project.owner?.fullName ?? 'Not visible to this report'}</DetailItem>
          <DetailItem label="Start date">{formatDate(project.startDate)}</DetailItem>
          <DetailItem label="Target completion">{formatDate(project.endDate)}</DetailItem>
          <DetailItem label="Coordinates">{project.latitude?.toFixed(5)}, {project.longitude?.toFixed(5)}</DetailItem>
          <DetailItem label="Visibility">{project.visibility === 'PUBLIC' ? 'Public record' : 'Private record'}</DetailItem>
          <DetailItem label="Milestone completion">{project.milestoneStats?.completionPercent ?? 0}%</DetailItem>
          <DetailItem label="Open discrepancies">{project.openDiscrepancies ?? 0}</DetailItem>
        </DetailGrid>
      </Card>

      <Card className="report-section">
        <SectionHeading
          title="2. Delivery milestones"
          description="Milestone state is copied from the project record at generation time. A completed milestone does not itself prove the work was done well."
        />
        {milestones.length === 0 ? (
          <EmptyState icon={ListChecks} title="No milestones were recorded at generation time" />
        ) : (
          <div className="table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Milestone</th>
                  <th>Status</th>
                  <th>Expected</th>
                  <th>Allocated</th>
                  <th>Latest submission</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((milestone) => (
                  <tr key={milestone.id}>
                    <td className="mono-inline">{String(milestone.sequence).padStart(2, '0')}</td>
                    <td>
                      <strong>{milestone.title}</strong>
                      <span className="table-subtext">{milestone.responsibleParty}</span>
                    </td>
                    <td>
                      <StatusBadge value={milestone.status} />
                      {milestone.isOverdue ? <span className="table-subtext text-warning">Overdue at generation</span> : null}
                    </td>
                    <td>{formatDate(milestone.expectedCompletionDate)}</td>
                    <td>{milestone.allocatedBudget ? formatMoney(milestone.allocatedBudget, project.currency) : '—'}</td>
                    <td>
                      {milestone.latestSubmission ? (
                        <>
                          <span>v{milestone.latestSubmission.version}</span>
                          <span className="table-subtext">{labelFor(milestone.latestSubmission.status)} · {formatDate(milestone.latestSubmission.submittedAt)}</span>
                        </>
                      ) : (
                        <span className="subtle">No submission</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="report-section">
        <SectionHeading
          title="3. Expenditure claims"
          description="Claim versions visible to the report generator. Approved claims are independent review decisions, not proof of payment."
        />
        {claims.length === 0 ? (
          <EmptyState icon={Landmark} title="No expenditure claims were visible at generation time" />
        ) : (
          <div className="table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Claimed</th>
                  <th>Version</th>
                  <th>Supplier</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim.id}>
                    <td>
                      <Link to={`/claims/${claim.id}`} className="text-link">{claim.reference}</Link>
                      <span className="table-subtext">{claim.category}</span>
                    </td>
                    <td>{formatMoney(claim.amount, claim.currency)}</td>
                    <td>
                      <StatusBadge value={claim.status} />
                      {claim.overBudget ? <span className="table-subtext text-warning">Above budget</span> : null}
                    </td>
                    <td>{formatDate(claim.claimedDate)}</td>
                    <td>v{claim.version}{claim.isCurrent ? ' · current' : ' · superseded'}</td>
                    <td>{claim.supplierName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {snapshot.expenditureClaims?.note ? <p className="muted-note">{snapshot.expenditureClaims.note}</p> : null}
      </Card>

      <Card className="report-section">
        <SectionHeading
          title="4. Independent review decisions"
          description="Decisions apply to specific record versions. Reviewers must have held an active, independent assignment on the project."
        />
        {reviews.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No review decisions were recorded at generation time" />
        ) : (
          <div className="report-review-list">
            {reviews.map((review: ReviewView) => (
              <article className="report-review" key={review.id}>
                <div className="report-review__top">
                  <OutcomeBadge decision={review.decision} />
                  <span>{labelFor(review.targetType)} · version {review.targetVersion}</span>
                  <span>{formatDateTime(review.createdAt)}</span>
                </div>
                <p>{review.rationale}</p>
                <small>Recorded by {review.reviewerName} · {labelFor(review.reviewerRole)}</small>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Card className="report-section">
        <SectionHeading
          title="5. Blockchain commitments"
          description="Anchors included in this snapshot. A confirmed anchor proves a commitment existed; it does not prove the record is true."
        />
        {anchors.length === 0 ? (
          <EmptyState
            icon={Blocks}
            title="No blockchain commitments were included"
            description="Anchoring is optional. The absence of an anchor is not evidence of wrongdoing."
          />
        ) : (
          <div className="table-scroll">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Status</th>
                  <th>Commitment</th>
                  <th>Transaction</th>
                  <th>Anchored</th>
                </tr>
              </thead>
              <tbody>
                {anchors.map((anchor) => (
                  <tr key={anchor.id}>
                    <td>
                      {labelFor(anchor.recordType)} v{anchor.recordVersion}
                      <span className="table-subtext mono-inline">{shortHash(anchor.recordId, 8, 6)}</span>
                    </td>
                    <td><StatusBadge value={anchor.status} /></td>
                    <td><span className="mono-inline">{shortHash(anchor.commitment, 10, 8)}</span></td>
                    <td>
                      {anchor.txHash ? (
                        <Link to={`/blockchain/${anchor.id}`} className="text-link">{shortHash(anchor.txHash, 10, 8)}</Link>
                      ) : (
                        <span className="subtle">Not submitted</span>
                      )}
                    </td>
                    <td>{anchor.anchoredAt ? formatDateTime(anchor.anchoredAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="report-section">
        <SectionHeading
          title="6. Audit checkpoint"
          description="The platform's append-only audit head when this report was generated. This is a recorded checkpoint, not a live integrity re-check."
        />
        <div className="report-audit">
          <div>
            <span>Latest audit sequence</span>
            <strong>#{snapshot.audit?.latestSeq ?? '—'}</strong>
          </div>
          <div>
            <span>Events included in hash chain</span>
            <strong>{snapshot.audit?.count ?? '—'}</strong>
          </div>
          <div className="report-audit__hash">
            <span>Head hash</span>
            {snapshot.audit?.headHash ? (
              <MonoValue value={snapshot.audit.headHash} display={shortHash(snapshot.audit.headHash, 20, 12)} />
            ) : (
              <span className="subtle">Not recorded</span>
            )}
          </div>
        </div>
        <p className="muted-note">
          <Link to={`/projects/${project.id}?tab=activity`} className="text-link">
            Open the live project audit trail <ArrowRight size={14} aria-hidden="true" />
          </Link>{' '}
          to inspect current events and run the platform integrity check.
        </p>
      </Card>

      <Card className="report-section">
        <SectionHeading title="7. Disclosures" />
        <ul className="trail-links">
          {(snapshot.disclosures ?? []).map((disclosure) => (
            <li key={disclosure}><TriangleAlert size={15} aria-hidden="true" />{disclosure}</li>
          ))}
          <li><Fingerprint size={15} aria-hidden="true" />The snapshot checksum is SHA-256 over the canonical JSON of the stored report.</li>
        </ul>
        {snapshot.platform?.footerNote ? <p className="report-footnote">{snapshot.platform.footerNote}</p> : null}
      </Card>

      <footer className="report-print-meta">
        <div>
          <span>Report id</span>
          <MonoValue value={report.id} display={shortHash(report.id, 8, 6)} />
        </div>
        <div>
          <span>Snapshot checksum</span>
          <MonoValue value={report.checksum} display={shortHash(report.checksum, 20, 12)} />
        </div>
        <div>
          <span>Generated</span>
          <strong>{formatDateTime(report.createdAt)}</strong>
        </div>
        <div>
          <span>Snapshot schema</span>
          <strong>v{snapshot.reportSchemaVersion ?? '—'}</strong>
        </div>
        <p>
          This is a point-in-time accountability report from Proof of Impact. It records what the platform held and which
          commitments had been made at generation time. Approved claims are not proof of payment, and blockchain anchors
          are not proof that records are true. {pluralize(snapshot.audit?.count ?? 0, 'audit event')} were covered by the
          recorded head hash.
        </p>
        <div className="report-print-meta__actions">
          <Link to={`/projects/${project.id}`} className={buttonClass('secondary', 'sm')}>
            <CheckCircle2 size={14} aria-hidden="true" /> Open live project record
          </Link>
          <button type="button" className={buttonClass('ghost', 'sm')} onClick={() => window.print()}>
            <Download size={14} aria-hidden="true" /> Print or save via browser
          </button>
        </div>
      </footer>
    </div>
  );
}
