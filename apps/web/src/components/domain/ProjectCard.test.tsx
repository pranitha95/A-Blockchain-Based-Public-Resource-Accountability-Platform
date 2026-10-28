import type { ProjectListItem } from '@poi/shared';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ProjectCard } from './ProjectCard';

const project: ProjectListItem = {
  id: 'project-1',
  code: 'POI-2026-0001',
  title: 'School roof restoration',
  category: 'EDUCATION',
  categoryLabel: 'Education',
  locationName: 'Ward 12, Nagpur',
  organizationName: 'Municipal Public Works',
  budgetAmount: '2500000.00',
  currency: 'INR',
  claimedAmount: '500000.00',
  approvedClaimAmount: '400000.00',
  milestoneCompletionPercent: 40,
  status: 'IN_PROGRESS',
  visibility: 'PUBLIC',
  endDate: '2026-12-31',
  latestReviewDecision: null,
  openDiscrepancies: 2,
  isDemo: true,
  updatedAt: '2026-10-20T10:00:00.000Z',
};

function renderCard(item: ProjectListItem = project) {
  return render(
    <MemoryRouter>
      <ProjectCard project={item} />
    </MemoryRouter>,
  );
}

describe('ProjectCard', () => {
  it('links to the project detail page and shows the project identity', () => {
    renderCard();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/projects/project-1');
    expect(screen.getByRole('heading', { name: 'School roof restoration' })).toBeInTheDocument();
    expect(screen.getByText('POI-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Education')).toBeInTheDocument();
  });

  it('formats money without floating point display artefacts', () => {
    renderCard();
    const budget = screen.getByText('Approved budget').closest('div');
    const claims = screen.getByText('Claims recorded').closest('div');
    expect(within(budget!).getByText(/25,00,000/)).toBeInTheDocument();
    expect(within(claims!).getByText(/5,00,000/)).toBeInTheDocument();
  });

  it('labels demonstration records and open discrepancies', () => {
    renderCard();
    expect(screen.getByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('2 open discrepancies')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });

  it('shows a private marker for private working records', () => {
    renderCard({ ...project, visibility: 'PRIVATE', openDiscrepancies: 0 });
    expect(screen.getByText('Private working record')).toBeInTheDocument();
    expect(screen.queryByText('2 open discrepancies')).not.toBeInTheDocument();
  });
});
