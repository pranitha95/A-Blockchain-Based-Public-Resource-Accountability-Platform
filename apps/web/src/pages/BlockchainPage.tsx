import type { AnchorSummary, AnchorRecordType } from '@poi/shared';
import { ANCHOR_RECORD_TYPES } from '@poi/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Blocks, BadgeCheck, Link2, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChainStateBadge, StatusBadge } from '../components/ui/Badges';
import { buttonClass } from '../components/ui/Button';
import { Alert, EmptyState, ErrorState, LoadingCard } from '../components/ui/Feedback';
import { Card, PageHeader, Pagination, SectionHeading } from '../components/ui/Layout';
import { useMeta } from '../features/meta/MetaProvider';
import { api } from '../lib/api';
import { anchoringGapDescription } from '../lib/chain';
import { formatDateTime, labelFor, pluralize, relativeTime, shortHash } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';
import type { AnchorStatus } from '@poi/shared';

const anchorStatuses: AnchorStatus[] = [
  'AWAITING_WALLET',
  'TRANSACTION_SUBMITTED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'FAILED',
  'VERIFICATION_ERROR',
];

export function BlockchainPage() {
  usePageTitle('Blockchain');
  const { meta } = useMeta();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page') ?? 1) || 1;
  const recordType = (searchParams.get('recordType') ?? '') as AnchorRecordType | '';
  const status = (searchParams.get('status') ?? '') as AnchorStatus | '';
  const projectId = searchParams.get('projectId') ?? '';

  const anchorsQuery = useQuery({
    queryKey: queryKeys.anchors({ page, recordType, status, projectId }),
    queryFn: () =>
      api.getPage<AnchorSummary>('/anchors', {
        page,
        pageSize: 12,
        recordType: recordType || undefined,
        status: status || undefined,
        projectId: projectId || undefined,
      }),
  });

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    setSearchParams(next);
  }

  const chain = meta?.chain;
  const anchors = anchorsQuery.data?.data ?? [];
  const pageMeta = anchorsQuery.data?.meta ?? {};
  const hasFilter = Boolean(recordType || status || projectId);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Sepolia registry"
        title="Blockchain commitments"
        description="Every anchor is a versioned commitment to a specific record digest. A confirmed anchor proves the commitment existed on-chain; it does not prove the record is true."
        actions={
          <div className="action-bar">
            <Link to="/verify" className={buttonClass('primary')}>
              <BadgeCheck size={16} aria-hidden="true" /> Verify a commitment
            </Link>
          </div>
        }
      />

      <div className="chain-config-strip">
        <div>
          <span>Network</span>
          <strong>{chain?.chainName ?? 'Unavailable'} {chain?.chainId ? `(${chain.chainId})` : ''}</strong>
        </div>
        <div>
          <span>Registry contract</span>
          <strong className="mono-inline">{chain?.contractAddress ? shortHash(chain.contractAddress, 12, 8) : 'Not configured'}</strong>
        </div>
        <div>
          <span>RPC endpoint</span>
          <strong>{chain?.rpcConfigured ? 'Configured' : 'Not configured'}</strong>
        </div>
        <div>
          <span>Required confirmations</span>
          <strong>{chain?.requiredConfirmations ?? '—'}</strong>
        </div>
        <div>
          <span>Status</span>
          <ChainStateBadge available={Boolean(chain?.anchoringAvailable)} />
        </div>
      </div>

      {!chain?.anchoringAvailable ? (
        <Alert tone="warning" title="Anchoring is unavailable in this environment">
          The API reports that {anchoringGapDescription(chain)}. Existing anchors in the database, if any, remain
          readable, but no new transaction can be prepared or verified on-chain. No contract address or transaction is
          invented to fill this gap.
        </Alert>
      ) : (
        <Alert tone="info" title="Wallet transactions are submitted by an authorised operator">
          Proof of Impact never asks for a seed phrase or private key. The browser wallet signs the transaction, and the
          API records the resulting hash and confirmation status.
        </Alert>
      )}

      <Card className="filter-panel">
        <div className="filter-panel__row">
          <label className="inline-select">
            <span>Record type</span>
            <select value={recordType} onChange={(event) => apply({ recordType: event.target.value || null })}>
              <option value="">All record types</option>
              {ANCHOR_RECORD_TYPES.map((value) => (
                <option key={value} value={value}>{labelFor(value)}</option>
              ))}
            </select>
          </label>
          <label className="inline-select">
            <span>Status</span>
            <select value={status} onChange={(event) => apply({ status: event.target.value || null })}>
              <option value="">All statuses</option>
              {anchorStatuses.map((value) => (
                <option key={value} value={value}>{labelFor(value)}</option>
              ))}
            </select>
          </label>
          {projectId ? (
            <button type="button" className="text-link" onClick={() => apply({ projectId: null })}>
              Clear project filter
            </button>
          ) : null}
          <span className="filter-bar__scope">
            {pluralize(Number(pageMeta.total ?? 0), 'commitment')} in this view
          </span>
        </div>
      </Card>

      <Card>
        <SectionHeading
          title="Anchored record commitments"
          description="Newest prepared anchors first. A record version may have at most one current commitment; supersession is explicit."
        />
        {anchorsQuery.isLoading ? <LoadingCard label="Loading blockchain records…" /> : anchorsQuery.isError ? (
          <ErrorState error={anchorsQuery.error} title="Blockchain records could not be loaded" />
        ) : anchors.length === 0 ? (
          <EmptyState
            icon={Blocks}
            title={hasFilter ? 'No commitments match these filters' : 'No blockchain commitments exist yet'}
            description={
              hasFilter
                ? 'Change or clear the filters to see other anchor records.'
                : 'Anchors are optional. Their absence is not evidence of wrongdoing; it means no record has been committed to the configured chain in this environment.'
            }
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
                  <span>{anchor.projectCode} · {anchor.projectTitle}</span>
                  <span className="mono-inline">Commitment {shortHash(anchor.commitment, 14, 8)}</span>
                </div>
                <div className="anchor-row__meta">
                  <span>{anchor.txHash ? `Tx ${shortHash(anchor.txHash)}` : 'No wallet transaction yet'}</span>
                  <span>{anchor.anchoredAt ? `Confirmed ${relativeTime(anchor.anchoredAt)}` : `Prepared ${relativeTime(anchor.createdAt)}`}</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </div>
              </Link>
            ))}
          </div>
        )}
        <Pagination
          page={Number(pageMeta.page ?? 1)}
          totalPages={Number(pageMeta.totalPages ?? 1)}
          total={Number(pageMeta.total ?? 0)}
          onChange={(next) => apply({ page: String(next) })}
          noun="commitments"
        />
      </Card>

      <div className="card-grid card-grid--three">
        <Card>
          <SectionHeading title="Versioned commitments" />
          <p>
            A commitment includes the chain id, registry address, project, record type, record id, record version and
            content digest. Amend a record and the next anchor is a new version, never a silent edit.
          </p>
        </Card>
        <Card>
          <SectionHeading title="Explicit supersession" />
          <p>
            When a newer version is anchored, the contract records the previous key. History stays queryable; nothing is
            deleted or rewritten.
          </p>
        </Card>
        <Card>
          <SectionHeading title="What confirmation proves" />
          <p>
            <ShieldCheck size={15} aria-hidden="true" /> Confirmation proves the commitment was recorded. It does not
            validate the underlying document, reviewer judgement or delivery of goods and services.
          </p>
        </Card>
      </div>

      <p className="muted-note">
        <Link2 size={14} aria-hidden="true" /> Anchor times shown here come from the platform database. Inspect a
        commitment to compare the recorded digest with the contract and the block explorer.
        {anchorsQuery.dataUpdatedAt ? <> View generated {formatDateTime(new Date(anchorsQuery.dataUpdatedAt).toISOString())}.</> : null}
      </p>
    </div>
  );
}
