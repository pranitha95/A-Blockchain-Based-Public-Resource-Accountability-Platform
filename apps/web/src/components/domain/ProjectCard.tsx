import type { ProjectListItem } from '@poi/shared';
import { ArrowUpRight, CalendarDays, MapPin, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatMoney, formatDate, labelFor } from '../../lib/format';
import { DemoBadge, PrivateBadge, StatusBadge } from '../ui/Badges';
import { ProgressBar } from '../ui/Layout';

export function ProjectCard({ project }: { project: ProjectListItem }) {
  return (
    <Link to={`/projects/${project.id}`} className="project-card">
      <div className="project-card__top">
        <span className="project-card__code">{project.code}</span>
        <span className="project-card__badges">
          {project.isDemo ? <DemoBadge compact /> : null}
          {project.visibility === 'PRIVATE' ? <PrivateBadge /> : null}
          <StatusBadge value={project.status} dot />
        </span>
      </div>
      <h3>{project.title}</h3>
      <p className="project-card__meta">
        <span><MapPin size={14} aria-hidden="true" />{project.locationName}</span>
        <span>{project.organizationName}</span>
      </p>
      <p className="project-card__category">{project.categoryLabel}</p>

      <dl className="project-card__numbers">
        <div>
          <dt>Approved budget</dt>
          <dd>{formatMoney(project.budgetAmount, project.currency)}</dd>
        </div>
        <div>
          <dt>Claims recorded</dt>
          <dd>{formatMoney(project.claimedAmount, project.currency)}</dd>
        </div>
      </dl>

      <ProgressBar
        value={Number(project.milestoneCompletionPercent) || 0}
        label="Milestone completion"
      />

      <div className="project-card__footer">
        <span><CalendarDays size={14} aria-hidden="true" />Target {formatDate(project.endDate)}</span>
        {project.openDiscrepancies > 0 ? (
          <span className="project-card__flag">
            <TriangleAlert size={14} aria-hidden="true" />
            {project.openDiscrepancies} open {project.openDiscrepancies === 1 ? 'discrepancy' : 'discrepancies'}
          </span>
        ) : project.latestReviewDecision ? (
          <span className="project-card__review">Latest review: {labelFor(project.latestReviewDecision)}</span>
        ) : null}
        <ArrowUpRight size={17} className="project-card__arrow" aria-hidden="true" />
      </div>
    </Link>
  );
}
