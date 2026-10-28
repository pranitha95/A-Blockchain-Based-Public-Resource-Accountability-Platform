import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChainStateBadge, DemoBadge, EvidenceBadge, RoleBadge, StatusBadge } from './Badges';

describe('Badges', () => {
  it('renders a status badge with the correct tone and label', () => {
    render(<StatusBadge value="APPROVED" dot />);
    const badge = screen.getByText('Approved');
    expect(badge).toHaveClass('badge', 'badge--positive');
  });

  it('renders unknown status values without crashing', () => {
    render(<StatusBadge value={null} />);
    expect(screen.getByText('—')).toHaveClass('badge--neutral');
  });

  it('labels demonstration records explicitly', () => {
    render(<DemoBadge />);
    expect(screen.getByText('Demonstration record')).toHaveClass('badge--demo');
  });

  it('states when chain anchoring is not configured', () => {
    const { rerender } = render(<ChainStateBadge available={false} />);
    expect(screen.getByText('Anchoring not configured')).toHaveClass('badge--warning');
    rerender(<ChainStateBadge available />);
    expect(screen.getByText('Chain anchoring available')).toHaveClass('badge--positive');
  });

  it('distinguishes restricted evidence', () => {
    render(<EvidenceBadge visibility="RESTRICTED" />);
    expect(screen.getByText('Restricted evidence')).toHaveClass('badge--warning');
  });

  it('renders role labels', () => {
    render(<RoleBadge role="REVIEWER" />);
    expect(screen.getByText('Independent reviewer')).toHaveClass('badge--info');
  });
});
