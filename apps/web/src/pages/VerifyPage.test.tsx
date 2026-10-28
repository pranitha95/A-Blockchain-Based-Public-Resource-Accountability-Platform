import type { VerificationResult } from '@poi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../features/ui/ToastProvider';
import { api } from '../lib/api';
import { VerifyPage } from './VerifyPage';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'The request could not be completed.',
}));

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);

function verification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    status: 'MATCH',
    recordType: 'PROJECT',
    recordId: 'record-1',
    recordVersion: 1,
    projectId: 'project-1',
    projectCode: 'POI-2026-0001',
    projectTitle: 'School roof restoration',
    commitment: 'a'.repeat(64),
    contentDigest: 'b'.repeat(64),
    recomputedContentDigest: 'b'.repeat(64),
    onChainContentDigest: 'b'.repeat(64),
    onChainCommitment: 'a'.repeat(64),
    digestMatches: true,
    commitmentMatches: true,
    anchorStatus: 'CONFIRMED',
    txHash: `0x${'c'.repeat(64)}`,
    blockNumber: 123456,
    chainId: 11155111,
    explorerUrl: null,
    payload: { projectCode: 'POI-2026-0001' },
    checkedAt: '2026-10-20T10:00:00.000Z',
    explanation: 'The stored record and the on-chain commitment agree on identity, version and digest.',
    ...overrides,
  };
}

function renderVerify(initialEntry = '/verify') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <VerifyPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('VerifyPage', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it('starts with an explicit empty state rather than a fabricated result', () => {
    renderVerify();
    expect(screen.getByText('No verification has been run')).toBeInTheDocument();
    expect(screen.getByText(/does not establish that an invoice is genuine/)).toBeInTheDocument();
  });

  it('looks up an anchor from the URL and explains a mismatch', async () => {
    getMock.mockResolvedValue(
      verification({
        status: 'MISMATCH',
        digestMatches: false,
        commitmentMatches: false,
        explanation: 'The stored payload digest no longer matches the digest recorded at anchoring time.',
      }),
    );
    renderVerify('/verify?anchor=anchor-123');

    expect(await screen.findByRole('heading', { name: 'Mismatch' })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/verify/anchor-123');
    expect(screen.getAllByText(/no longer matches/).length).toBeGreaterThan(0);
    expect(screen.getByText(/It does not prove that the underlying documents/)).toBeInTheDocument();
  });

  it('submits a project-code lookup and renders a match without asking for a wallet', async () => {
    postMock.mockResolvedValue(verification());
    const user = userEvent.setup();
    renderVerify();

    await user.type(screen.getByLabelText(/Project code/i), 'poi-2026-0001');
    await user.click(screen.getByRole('button', { name: /Verify project record/i }));

    expect(await screen.findByRole('heading', { name: 'Match' })).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith('/verify', {
      projectCode: 'POI-2026-0001',
      recordType: 'PROJECT',
      recordVersion: undefined,
    });
    expect(screen.getByText('Digest and commitment comparison')).toBeInTheDocument();
    expect(screen.queryByText(/Connect wallet/i)).not.toBeInTheDocument();
  });

  it('reports a failed lookup without presenting it as a match', async () => {
    getMock.mockRejectedValue(new Error('The record was not found or is not public.'));
    renderVerify('/verify?anchor=unknown-anchor');

    expect(await screen.findByText('The anchor could not be looked up')).toBeInTheDocument();
    expect(screen.getAllByText(/The record was not found or is not public\./).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Match' })).not.toBeInTheDocument();
  });
});
