import type { AnchorRecordType, VerificationResult } from '@poi/shared';
import { ANCHOR_RECORD_TYPES } from '@poi/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  CheckCircle2,
  CircleAlert,
  FileSearch,
  Fingerprint,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { StatusBadge, ToneBadge } from '../components/ui/Badges';
import { Button, buttonClass } from '../components/ui/Button';
import { Alert, EmptyState, FormErrorSummary, LoadingCard } from '../components/ui/Feedback';
import { Card, DetailGrid, DetailItem, PageHeader, SectionHeading } from '../components/ui/Layout';
import { Field, MonoValue, SelectField } from '../components/ui/Primitives';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, labelFor, shortHash } from '../lib/format';
import { usePageTitle } from '../lib/usePageTitle';

function ComparisonRow({
  label,
  value,
  matches,
  detail,
}: {
  label: string;
  value: string | null;
  matches: boolean | null;
  detail: string;
}) {
  const tone = matches === true ? 'positive' : matches === false ? 'danger' : 'neutral';
  return (
    <div className="verification-comparison__row">
      <div className="verification-comparison__label">
        <span>{label}</span>
        <ToneBadge tone={tone}>
          {matches === true ? 'Matches' : matches === false ? 'Mismatch' : 'Not compared'}
        </ToneBadge>
      </div>
      <div className="verification-comparison__value">
        {value ? <MonoValue value={value} display={shortHash(value, 22, 12)} /> : <span className="subtle">No value recorded</span>}
      </div>
      <p>{detail}</p>
    </div>
  );
}

function VerificationResultPanel({ result }: { result: VerificationResult }) {
  const tone =
    result.status === 'MATCH'
      ? 'success'
      : result.status === 'MISMATCH'
        ? 'danger'
        : result.status === 'NOT_FOUND'
          ? 'info'
          : 'warning';

  return (
    <div className="page-stack verification-result" aria-live="polite">
      <Card className={`verification-result__summary verification-result__summary--${tone}`}>
        <div className="verification-result__head">
          <span className="verification-result__icon" aria-hidden="true">
            {result.status === 'MATCH' ? <ShieldCheck size={26} /> : result.status === 'MISMATCH' ? <ShieldAlert size={26} /> : <CircleAlert size={26} />}
          </span>
          <div>
            <div className="badge-row">
              <StatusBadge value={result.status} dot />
              <ToneBadge tone="neutral">{labelFor(result.recordType)}</ToneBadge>
              {result.recordVersion ? <ToneBadge tone="neutral">Version {result.recordVersion}</ToneBadge> : null}
            </div>
            <h2>{labelFor(result.status)}</h2>
            <p>{result.explanation}</p>
          </div>
        </div>
        <div className="verification-result__meta">
          <span>Checked {formatDateTime(result.checkedAt)}</span>
          {result.projectCode ? (
            <Link to={`/projects/${result.projectId}`} className="text-link">
              {result.projectCode} · {result.projectTitle} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          ) : null}
          {result.explorerUrl ? (
            <a href={result.explorerUrl} target="_blank" rel="noreferrer" className="text-link">
              Open transaction in explorer <ArrowRight size={14} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </Card>

      <div className="two-column">
        <Card>
          <SectionHeading
            title="Digest and commitment comparison"
            description="The platform recomputes the payload digest and commitment. On-chain values are read from the registry contract when an RPC endpoint is configured."
          />
          <div className="verification-comparison">
            <ComparisonRow
              label="Stored payload digest"
              value={result.recomputedContentDigest}
              matches={result.digestMatches}
              detail="Recomputed from the canonical record payload stored by the platform. A mismatch means the database payload no longer matches the recorded digest."
            />
            <ComparisonRow
              label="Recorded content digest"
              value={result.contentDigest}
              matches={result.digestMatches}
              detail="The digest that was committed by this anchor when it was prepared."
            />
            <ComparisonRow
              label="On-chain content digest"
              value={result.onChainContentDigest}
              matches={result.commitmentMatches}
              detail="Read from the registry contract. This value is only available when on-chain verification succeeds."
            />
            <ComparisonRow
              label="Stored commitment"
              value={result.commitment}
              matches={result.commitmentMatches}
              detail="The binding of chain, registry, project, record identity, version and digest."
            />
            <ComparisonRow
              label="On-chain commitment"
              value={result.onChainCommitment}
              matches={result.commitmentMatches}
              detail="The commitment the contract actually stores for this record key."
            />
          </div>
          {result.anchorStatus ? (
            <p className="muted-note">
              Platform anchor state: <StatusBadge value={result.anchorStatus} />{' '}
              {result.txHash ? <>Transaction {shortHash(result.txHash, 12, 8)}{result.blockNumber ? ` · block ${result.blockNumber}` : ''}.</> : 'No transaction hash is recorded.'}
            </p>
          ) : null}
        </Card>

        <div className="page-stack">
          <Card>
            <SectionHeading title="Verified record context" />
            <DetailGrid>
              <DetailItem label="Project code">{result.projectCode || '—'}</DetailItem>
              <DetailItem label="Project title">{result.projectTitle || '—'}</DetailItem>
              <DetailItem label="Record type">{labelFor(result.recordType)}</DetailItem>
              <DetailItem label="Record version">{result.recordVersion ?? '—'}</DetailItem>
              <DetailItem label="Anchor record id">{result.recordId || '—'}</DetailItem>
              <DetailItem label="Chain id">{result.chainId ?? 'Not recorded'}</DetailItem>
              <DetailItem label="Transaction">{result.txHash ?? 'Not recorded'}</DetailItem>
              <DetailItem label="Block number">{result.blockNumber ?? 'Not recorded'}</DetailItem>
            </DetailGrid>
          </Card>

          <Card>
            <SectionHeading title="What this result means" />
            <ul className="trail-links">
              <li><ShieldCheck size={15} aria-hidden="true" />A MATCH means the stored record and the on-chain commitment agree on the recorded identity, version and digest.</li>
              <li><CircleAlert size={15} aria-hidden="true" />It does not prove that the underlying documents, invoices, delivery or spending are truthful.</li>
              <li><CircleAlert size={15} aria-hidden="true" />NOT_FOUND means no anchor exists for this record in the platform database, or the record is withheld from this view.</li>
              <li><TriangleAlert size={15} aria-hidden="true" />MISMATCH and VERIFICATION_ERROR require investigation before the commitment is trusted.</li>
            </ul>
          </Card>
        </div>
      </div>

      {result.payload ? (
        <Card>
          <SectionHeading title="Canonical payload" description="The record snapshot used to compute the digest." />
          <details className="payload-details">
            <summary>Show canonical record payload</summary>
            <pre>{JSON.stringify(result.payload, null, 2)}</pre>
          </details>
        </Card>
      ) : null}
    </div>
  );
}

export function VerifyPage() {
  usePageTitle('Verify a record');
  const [searchParams, setSearchParams] = useSearchParams();
  const anchorParam = searchParams.get('anchor') ?? '';

  const [anchorId, setAnchorId] = useState(anchorParam);
  const [projectCode, setProjectCode] = useState('');
  const [recordType, setRecordType] = useState<AnchorRecordType>('PROJECT');
  const [recordVersion, setRecordVersion] = useState('');

  const anchorLookup = useQuery({
    queryKey: ['public-verification', anchorParam],
    queryFn: () => api.get<VerificationResult>(`/verify/${anchorParam}`),
    enabled: Boolean(anchorParam),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<VerificationResult>('/verify', payload),
  });

  const result = mutation.data ?? anchorLookup.data;
  const lookupError = anchorLookup.isError ? anchorLookup.error : null;

  function verifyAnchor(event: FormEvent) {
    event.preventDefault();
    const value = anchorId.trim();
    if (!value) return;
    setSearchParams({ anchor: value }, { replace: false });
    mutation.mutate({ anchorId: value });
  }

  function verifyRecord(event: FormEvent) {
    event.preventDefault();
    mutation.mutate({
      projectCode: projectCode.trim(),
      recordType,
      recordVersion: recordVersion ? Number(recordVersion) : undefined,
    });
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Public record verification"
        title="Verify a commitment"
        description="Check whether a record commitment exists and whether the platform record, the recomputed digest and the registry contract agree. Verification never asks for a wallet connection."
      />

      <Alert tone="info" title="What verification can and cannot establish">
        A confirmed match shows that a specific record digest was committed to the registry contract and has not silently
        changed. It does not establish that an invoice is genuine, that work was completed, that money was paid or that a
        reviewer is trustworthy. Project codes and anchor identifiers are not secrets; restricted records remain withheld.
      </Alert>

      {anchorParam ? (
        <Card className="filter-bar">
          <span className="filter-bar__scope">
            Verifying anchor <span className="mono-inline">{shortHash(anchorParam, 12, 8)}</span>
          </span>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setSearchParams({}, { replace: true });
              setAnchorId('');
              mutation.reset();
            }}
          >
            Clear anchor lookup
          </button>
        </Card>
      ) : null}

      <div className="two-column verify-forms">
        <Card>
          <SectionHeading
            title="Verify by anchor id"
            description="Use the identifier shown on a blockchain commitment page. This checks the exact anchor version."
          />
          <form className="form-stack" onSubmit={verifyAnchor}>
            <FormErrorSummary error={mutation.error ?? lookupError} />
            <Field
              label="Anchor id"
              htmlFor="verify-anchor-id"
              required
              hint="A UUID from a blockchain commitment page, for example 6a3b1f2c-…"
            >
              <input
                id="verify-anchor-id"
                value={anchorId}
                onChange={(event) => setAnchorId(event.target.value)}
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </Field>
            <Button type="submit" loading={mutation.isPending}>
              <Fingerprint size={16} aria-hidden="true" /> Verify anchor
            </Button>
          </form>
        </Card>

        <Card>
          <SectionHeading
            title="Verify a project commitment"
            description="Look up the newest anchor for a record type in a public project. Provide a version to inspect a specific historical commitment."
          />
          <form className="form-stack" onSubmit={verifyRecord}>
            <FormErrorSummary error={mutation.error ?? lookupError} />
            <div className="field-grid field-grid--two">
              <Field label="Project code" htmlFor="verify-project-code" required hint="For example POI-2026-0001.">
                <input
                  id="verify-project-code"
                  value={projectCode}
                  onChange={(event) => setProjectCode(event.target.value.toUpperCase())}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="POI-2026-0001"
                />
              </Field>
              <SelectField
                id="verify-record-type"
                label="Record type"
                value={recordType}
                onChange={(value) => setRecordType(value as AnchorRecordType)}
                options={ANCHOR_RECORD_TYPES.map((value) => ({ value, label: labelFor(value) }))}
                required
              />
            </div>
            <Field
              label="Record version (optional)"
              htmlFor="verify-record-version"
              hint="Leave blank to check the newest anchor for this record type."
            >
              <input
                id="verify-record-version"
                type="number"
                min={1}
                step={1}
                value={recordVersion}
                onChange={(event) => setRecordVersion(event.target.value)}
                placeholder="e.g. 2"
              />
            </Field>
            <Button type="submit" loading={mutation.isPending}>
              <FileSearch size={16} aria-hidden="true" /> Verify project record
            </Button>
          </form>
        </Card>
      </div>

      {anchorLookup.isLoading || mutation.isPending ? (
        <LoadingCard label="Checking the record commitment…" />
      ) : result ? (
        <VerificationResultPanel result={result} />
      ) : lookupError ? (
        <Alert tone="warning" title="The anchor could not be looked up">
          {errorMessage(lookupError)} Check the identifier, or verify by project code instead.
        </Alert>
      ) : (
        <EmptyState
          icon={BadgeCheck}
          title="No verification has been run"
          description="Enter an anchor id or a project code above. The result will show which values matched and which could not be checked."
        />
      )}

      <div className="card-grid card-grid--three">
        <Card>
          <SectionHeading title="Where to find an anchor" />
          <p>
            Open a project’s <strong>Chain anchors</strong> tab, or browse the public{' '}
            <Link to="/blockchain" className="text-link">blockchain registry</Link>.
          </p>
        </Card>
        <Card>
          <SectionHeading title="Why on-chain comparison may be unavailable" />
          <p>
            If the API has no RPC endpoint configured, the record digest can still be compared offline, but the registry
            contract cannot be read. That state is reported as a verification error, not as a match.
          </p>
        </Card>
        <Card>
          <SectionHeading title="Independent verification" />
          <p>
            The commitment construction and registry ABI are documented in the project repository. A third party can
            recompute the digest and read the contract directly rather than trusting this interface.
          </p>
          <div className="button-row">
            <Link to="/blockchain" className={buttonClass('secondary', 'sm')}>
              <Blocks size={14} aria-hidden="true" /> Registry records
            </Link>
            <Link to="/projects" className={buttonClass('ghost', 'sm')}>
              <CheckCircle2 size={14} aria-hidden="true" /> Browse projects
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
