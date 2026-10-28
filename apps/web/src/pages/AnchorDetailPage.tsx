import type { AnchorDetailView, ProjectDetail } from '@poi/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  CircleAlert,
  ExternalLink,
  GitCompareArrows,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StatusBadge, ToneBadge } from '../components/ui/Badges';
import { Button, buttonClass } from '../components/ui/Button';
import { Alert, ErrorState, LoadingCard } from '../components/ui/Feedback';
import { Card, DetailGrid, DetailItem, PageHeader, SectionHeading } from '../components/ui/Layout';
import { MonoValue } from '../components/ui/Primitives';
import { useMeta } from '../features/meta/MetaProvider';
import { useToast } from '../features/ui/ToastProvider';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, labelFor, relativeTime, shortHash } from '../lib/format';
import { queryKeys } from '../lib/queryKeys';
import { usePageTitle } from '../lib/usePageTitle';
import {
  WalletError,
  connectWallet,
  contractIsDeployed,
  hasInjectedWallet,
  sendAnchorTransaction,
  switchWalletNetwork,
  walletCanAnchor,
  type WalletConnection,
} from '../lib/wallet';

function walletMessage(error: unknown): string {
  if (error instanceof WalletError) return error.message;
  const record = error as { code?: number; info?: { error?: { code?: number } }; message?: string };
  const code = record?.code ?? record?.info?.error?.code;
  if (code === 4001) return 'You rejected the request in your wallet.';
  if (code === 4100) return 'The wallet account is not authorised for this request. Unlock MetaMask and try again.';
  return errorMessage(error);
}

export function AnchorDetailPage() {
  const { anchorId } = useParams<{ anchorId: string }>();
  const { meta } = useMeta();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const anchorQuery = useQuery({
    queryKey: queryKeys.anchor(anchorId ?? ''),
    queryFn: () => api.get<AnchorDetailView>(`/anchors/${anchorId}`),
    enabled: Boolean(anchorId),
  });
  const anchor = anchorQuery.data;

  const projectQuery = useQuery({
    queryKey: queryKeys.project(anchor?.projectId ?? ''),
    queryFn: () => api.get<ProjectDetail>(`/projects/${anchor!.projectId}`),
    enabled: Boolean(anchor?.projectId),
  });
  const project = projectQuery.data;
  const canAnchor = Boolean(project?.permissions.canAnchor);

  usePageTitle(anchor ? `${anchor.recordLabel} · blockchain anchor` : 'Blockchain anchor');

  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);

  const reconcileMutation = useMutation({
    mutationFn: () => api.post<AnchorDetailView>(`/anchors/${anchorId}/reconcile`),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.anchor(anchorId ?? ''), updated);
      if (anchor?.projectId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.project(anchor.projectId) });
      }
      void queryClient.invalidateQueries({ queryKey: ['anchors'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      notify(`Anchor status refreshed: ${labelFor(updated.status)}.`, updated.status === 'CONFIRMED' ? 'success' : 'info');
    },
    onError: (error) => notify(errorMessage(error), 'error'),
  });

  if (!anchorId) {
    return <ErrorState error={new Error('The anchor reference is missing.')} title="Anchor not found" />;
  }
  if (anchorQuery.isLoading) {
    return <div className="page-stack"><LoadingCard label="Loading blockchain commitment…" /></div>;
  }
  if (anchorQuery.isError || !anchor) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Blockchain commitment" title="Anchor unavailable" backTo="/blockchain" backLabel="Blockchain" />
        <ErrorState
          error={anchorQuery.error}
          title="This commitment could not be loaded"
          action={<Link to="/blockchain" className={buttonClass('secondary', 'sm')}>Back to blockchain records</Link>}
        />
      </div>
    );
  }

  const targetChainId = anchor.chainId ?? meta?.chain.chainId ?? null;
  const contractAddress = anchor.contractAddress ?? meta?.chain.contractAddress ?? null;
  const chainName = meta?.chain.chainName ?? (targetChainId ? `chain ${targetChainId}` : 'the configured network');
  const anchoringConfigured = Boolean(meta?.chain.anchoringAvailable);
  const walletDetected = hasInjectedWallet();
  const alreadyConfirmed = anchor.status === 'CONFIRMED';
  const canSubmitTransaction = canAnchor && !alreadyConfirmed && ['AWAITING_WALLET', 'FAILED', 'VERIFICATION_ERROR'].includes(anchor.status);
  const canReconcile = Boolean(anchor.txHash) && !alreadyConfirmed;
  const networkMismatch = Boolean(wallet && targetChainId && wallet.chainId !== targetChainId);
  const contractMismatch =
    Boolean(anchor.chainId && meta?.chain.chainId && anchor.chainId !== meta.chain.chainId) ||
    Boolean(
      anchor.contractAddress &&
        meta?.chain.contractAddress &&
        anchor.contractAddress.toLowerCase() !== meta.chain.contractAddress.toLowerCase(),
    );

  async function handleConnect() {
    setConnecting(true);
    setWalletError(null);
    try {
      let connection = await connectWallet();
      if (targetChainId && connection.chainId !== targetChainId) {
        connection = await switchWalletNetwork(targetChainId, chainName);
      }
      setWallet(connection);
      if (!contractAddress) throw new WalletError('No registry contract address is recorded for this anchor.');
      const deployed = await contractIsDeployed(contractAddress);
      if (!deployed) {
        throw new WalletError(
          `No contract bytecode was found at ${shortHash(contractAddress, 10, 8)} on ${chainName}. Deploy the registry contract and update the API configuration before anchoring.`,
        );
      }
      const allowed = await walletCanAnchor(contractAddress, connection.address);
      setAuthorized(allowed);
      if (!allowed) {
        setWalletError(
          `This wallet (${shortHash(connection.address, 8, 6)}) does not hold ANCHOR_ROLE on the registry contract. Ask the contract administrator to grant the role; this screen cannot bypass it.`,
        );
      } else {
        notify('Wallet connected and authorised to anchor records.', 'success');
      }
    } catch (error) {
      setWalletError(walletMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  async function handleSubmit() {
    if (!anchor) {
      setWalletError('The anchor record is not loaded yet. Refresh the page and try again.');
      return;
    }
    if (!wallet || !contractAddress || !targetChainId) {
      setWalletError('Connect an authorised wallet before submitting a transaction.');
      return;
    }
    if (wallet.chainId !== targetChainId) {
      setWalletError(`The wallet is on chain ${wallet.chainId}; this anchor targets chain ${targetChainId}.`);
      return;
    }
    if (authorized !== true) {
      setWalletError('The connected wallet has not been confirmed as an authorised anchorer.');
      return;
    }
    setSending(true);
    setWalletError(null);
    try {
      const txHash = await sendAnchorTransaction(anchor, targetChainId, contractAddress);
      notify('Transaction submitted by the wallet. Recording the hash with the API…', 'info');
      const updated = await api.post<AnchorDetailView>(`/anchors/${anchor.id}/transaction`, { txHash });
      queryClient.setQueryData(queryKeys.anchor(anchor.id), updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(anchor.projectId) });
      void queryClient.invalidateQueries({ queryKey: ['anchors'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['audit'] });
      if (updated.status === 'CONFIRMED') {
        notify('Anchor confirmed on-chain.', 'success');
      } else {
        notify(
          `Transaction recorded with status ${labelFor(updated.status)}. It is not confirmed yet; use the refresh action after the required confirmations.`,
          'info',
        );
      }
    } catch (error) {
      setWalletError(walletMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`Blockchain commitment · ${labelFor(anchor.recordType)}`}
        title={anchor.recordLabel}
        backTo={`/projects/${anchor.projectId}?tab=anchors`}
        backLabel={`${anchor.projectCode} anchors`}
        description={
          <div className="project-title-meta">
            <div className="badge-row">
              <StatusBadge value={anchor.status} dot />
              <ToneBadge tone="neutral">Record version {anchor.recordVersion}</ToneBadge>
              {anchor.anchoredAt ? <ToneBadge tone="positive">Confirmed {relativeTime(anchor.anchoredAt)}</ToneBadge> : null}
            </div>
            <p>
              <Link to={`/projects/${anchor.projectId}`} className="text-link">{anchor.projectCode} · {anchor.projectTitle}</Link>
              <span className="dot-separator" aria-hidden="true">·</span>
              Prepared {formatDateTime(anchor.createdAt)} by {anchor.createdByName}
            </p>
          </div>
        }
        actions={
          <div className="action-bar">
            <Link to={`/verify?anchor=${anchor.id}`} className={buttonClass('secondary', 'sm')}>
              <BadgeCheck size={15} aria-hidden="true" /> Verify this commitment
            </Link>
            {canReconcile ? (
              <Button size="sm" variant="secondary" loading={reconcileMutation.isPending} onClick={() => reconcileMutation.mutate()}>
                <RefreshCw size={15} aria-hidden="true" /> Refresh status
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="chain-config-strip">
        <div>
          <span>Anchor state</span>
          <StatusBadge value={anchor.status} dot />
        </div>
        <div>
          <span>Network</span>
          <strong>{chainName} {targetChainId ? `(${targetChainId})` : ''}</strong>
        </div>
        <div>
          <span>Registry contract</span>
          <strong className="mono-inline">{contractAddress ? shortHash(contractAddress, 12, 8) : 'Not recorded'}</strong>
        </div>
        <div>
          <span>Confirmations</span>
          <strong>{anchor.confirmations ?? '—'} of {meta?.chain.requiredConfirmations ?? '—'} required</strong>
        </div>
        <div>
          <span>Block</span>
          <strong>{anchor.blockNumber ?? 'Not confirmed'}</strong>
        </div>
      </div>

      {contractMismatch ? (
        <Alert tone="warning" title="This anchor targets a different registry configuration">
          The anchor records chain {anchor.chainId ?? 'unknown'} and contract {anchor.contractAddress ?? 'unknown'}, while
          the API is currently configured for chain {meta?.chain.chainId ?? 'unknown'} and contract{' '}
          {meta?.chain.contractAddress ?? 'none'}. Verification compares the anchor's own recorded values; do not assume
          they match the current deployment.
        </Alert>
      ) : null}

      {anchor.status === 'AWAITING_WALLET' ? (
        <Alert tone="info" title="No wallet transaction has been submitted">
          A commitment exists in the platform database, but it is not on-chain yet. Only a wallet holding ANCHOR_ROLE can
          submit it. Until then, treat this record as unanchored.
        </Alert>
      ) : null}
      {anchor.status === 'TRANSACTION_SUBMITTED' || anchor.status === 'PENDING_CONFIRMATION' ? (
        <Alert tone="info" title="Transaction submitted, not yet confirmed">
          A transaction hash is recorded. This is not a confirmed anchor until the registry record is observed at the
          required confirmation depth. Use “Refresh status” to reconcile.
        </Alert>
      ) : null}
      {anchor.status === 'FAILED' ? (
        <Alert tone="danger" title="The transaction did not anchor this record">
          {anchor.failureReason ?? 'The registry transaction failed. No confirmed on-chain commitment exists for this version.'}
        </Alert>
      ) : null}
      {anchor.status === 'VERIFICATION_ERROR' ? (
        <Alert tone="warning" title="The transaction could not be verified">
          {anchor.failureReason ?? 'The platform could not confirm the on-chain state. Do not treat this anchor as confirmed.'}
        </Alert>
      ) : null}
      {anchor.status === 'CONFIRMED' ? (
        <Alert tone="success" title="Confirmed on-chain commitment">
          The registry contains a matching commitment at block {anchor.blockNumber ?? 'unknown'} with{' '}
          {anchor.confirmations ?? 0} recorded confirmations. This proves the commitment existed; it does not prove the
          record's contents are true.
        </Alert>
      ) : null}

      <div className="two-column two-column--wide-left">
        <div className="page-stack">
          <Card>
            <SectionHeading
              title="Commitment details"
              description="The commitment binds this version and digest to the recorded registry and chain."
            />
            <DetailGrid>
              <DetailItem label="Record type">{labelFor(anchor.recordType)}</DetailItem>
              <DetailItem label="Record version">v{anchor.recordVersion}</DetailItem>
              <DetailItem label="Project code">{anchor.projectCode}</DetailItem>
              <DetailItem label="Anchor id">{anchor.id}</DetailItem>
              <DetailItem label="Prepared by">{anchor.createdByName}</DetailItem>
              <DetailItem label="Prepared at">{formatDateTime(anchor.createdAt)}</DetailItem>
              <DetailItem label="Anchored at">{anchor.anchoredAt ? formatDateTime(anchor.anchoredAt) : 'Not confirmed'}</DetailItem>
              <DetailItem label="Last checked">{anchor.lastCheckedAt ? formatDateTime(anchor.lastCheckedAt) : 'Never'}</DetailItem>
              <DetailItem label="Chain id">{anchor.chainId ?? 'Not recorded'}</DetailItem>
              <DetailItem label="Contract">{anchor.contractAddress ?? 'Not recorded'}</DetailItem>
              <DetailItem label="Transaction">{anchor.txHash ?? 'Not submitted'}</DetailItem>
              <DetailItem label="Block number">{anchor.blockNumber ?? 'Not confirmed'}</DetailItem>
            </DetailGrid>

            <div className="hash-stack">
              <div>
                <span>Content digest (keccak256 of canonical record JSON)</span>
                <MonoValue value={anchor.contentDigest} display={shortHash(anchor.contentDigest, 18, 10)} />
              </div>
              <div>
                <span>On-chain commitment</span>
                <MonoValue value={anchor.commitment} display={shortHash(anchor.commitment, 18, 10)} />
              </div>
              <div>
                <span>Project id hash</span>
                <MonoValue value={anchor.projectIdBytes32} display={shortHash(anchor.projectIdBytes32, 18, 10)} />
              </div>
              <div>
                <span>Record id hash</span>
                <MonoValue value={anchor.recordIdBytes32} display={shortHash(anchor.recordIdBytes32, 18, 10)} />
              </div>
              <div>
                <span>Previous record key</span>
                <MonoValue value={anchor.previousKey} display={shortHash(anchor.previousKey, 18, 10)} />
              </div>
            </div>
            {anchor.explorerUrl ? (
              <a href={anchor.explorerUrl} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>
                <ExternalLink size={14} aria-hidden="true" /> Open transaction in block explorer
              </a>
            ) : null}
          </Card>

          <Card>
            <SectionHeading
              title="Local verification"
              description="The API re-computes the digest and commitment from the stored payload. A separate on-chain comparison is available through the verification endpoint."
            />
            <div className="verification-pair">
              <div className={anchor.verification.localDigestMatches ? 'verification-chip verification-chip--ok' : 'verification-chip verification-chip--bad'}>
                <GitCompareArrows size={16} aria-hidden="true" />
                <span>Stored payload digest</span>
                <strong>{anchor.verification.localDigestMatches ? 'Matches' : 'Does not match'}</strong>
              </div>
              <div className={anchor.verification.localCommitmentMatches ? 'verification-chip verification-chip--ok' : 'verification-chip verification-chip--bad'}>
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Commitment recomputation</span>
                <strong>{anchor.verification.localCommitmentMatches ? 'Matches' : 'Does not match'}</strong>
              </div>
            </div>
            <p className="muted-note">{anchor.verification.explanation}</p>
            <Link to={`/verify?anchor=${anchor.id}`} className="text-link">
              Compare with the registry contract <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </Card>

          <Card>
            <SectionHeading title="Wallet submission" description="Signing happens in your wallet. The platform never receives a private key or seed phrase." />
            {!anchoringConfigured ? (
              <Alert tone="warning">Blockchain anchoring is not configured for this environment.</Alert>
            ) : !canAnchor ? (
              <Alert tone="info" title="Read-only view">
                Your role cannot anchor records. Only a project owner or platform administrator with an authorised wallet
                may submit a transaction for this project.
              </Alert>
            ) : alreadyConfirmed ? (
              <p className="muted-note">This anchor is confirmed. No further transaction is needed for this version.</p>
            ) : (
              <div className="wallet-panel">
                <div className="wallet-panel__status">
                  <span className="wallet-panel__icon" aria-hidden="true"><Wallet size={22} /></span>
                  <div>
                    <strong>{wallet ? shortHash(wallet.address, 10, 8) : 'Wallet not connected'}</strong>
                    <p>
                      {wallet
                        ? `Connected to chain ${wallet.chainId}${networkMismatch ? ` — expected chain ${targetChainId}` : ''}.`
                        : walletDetected
                          ? 'A browser wallet was detected. Connect it to check whether it may anchor this record.'
                          : 'No browser wallet was detected. Install MetaMask (or a compatible injected wallet) to submit a transaction.'}
                    </p>
                    {authorized !== null ? (
                      <span className={authorized ? 'badge badge--positive' : 'badge badge--warning'}>
                        <KeyRound size={12} aria-hidden="true" />
                        {authorized ? 'ANCHOR_ROLE confirmed on-chain' : 'Wallet lacks ANCHOR_ROLE'}
                      </span>
                    ) : null}
                  </div>
                </div>

                {walletError ? (
                  <div className="form-error-summary" role="alert">
                    <TriangleAlert size={17} aria-hidden="true" />
                    <span>{walletError}</span>
                  </div>
                ) : null}

                <div className="button-row">
                  <Button variant="secondary" loading={connecting} onClick={handleConnect} disabled={!walletDetected || sending}>
                    {wallet ? 'Reconnect or switch account' : 'Connect wallet'}
                  </Button>
                  {canSubmitTransaction ? (
                    <Button loading={sending} onClick={handleSubmit} disabled={!wallet || authorized !== true || networkMismatch}>
                      <Blocks size={15} aria-hidden="true" /> Sign and submit anchor
                    </Button>
                  ) : null}
                </div>

                <p className="muted-note">
                  <CircleAlert size={14} aria-hidden="true" /> Submitting a transaction is not evidence of confirmation.
                  The platform records the hash, then waits for the registry contract to be observed at the configured
                  confirmation depth.
                </p>
              </div>
            )}

            {!walletDetected ? (
              <p className="form-note">
                MetaMask is a browser extension. Open this page in a browser with the wallet installed, or use the
                verification and read-only features without a wallet.
              </p>
            ) : null}
          </Card>
        </div>

        <div className="page-stack">
          <Card>
            <SectionHeading title="Transaction attempts" />
            {anchor.transactions.length === 0 ? (
              <p className="muted-note">No wallet transaction has been recorded for this anchor.</p>
            ) : (
              <ol className="transaction-list">
                {anchor.transactions.map((transaction) => (
                  <li key={transaction.txHash}>
                    <div className="history-list__top">
                      <StatusBadge value={transaction.status} />
                      <span>{formatDateTime(transaction.submittedAt)}</span>
                    </div>
                    <MonoValue value={transaction.txHash} display={shortHash(transaction.txHash, 14, 8)} />
                    <small>
                      {transaction.fromAddress ? `From ${shortHash(transaction.fromAddress, 8, 6)}` : 'Sender not recorded'}
                      {transaction.blockNumber ? ` · Block ${transaction.blockNumber}` : ' · Not mined'}
                    </small>
                    {transaction.failureReason ? <p className="muted-note">{transaction.failureReason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <SectionHeading title="What this does and does not prove" />
            <ul className="trail-links">
              <li><ShieldCheck size={15} aria-hidden="true" />The registry contract stores a commitment and its version.</li>
              <li><CircleAlert size={15} aria-hidden="true" />It does not validate documents, delivery, payment or reviewer independence.</li>
              <li><CircleAlert size={15} aria-hidden="true" />A confirmed transaction is not a government endorsement or a legal finding.</li>
              <li><ShieldCheck size={15} aria-hidden="true" />The audit chain and record history remain the authoritative account of what the platform recorded.</li>
            </ul>
          </Card>

          <Card>
            <SectionHeading title="Record payload" />
            <p className="muted-note">This is the canonical record snapshot committed by the digest, as stored by the platform.</p>
            {anchor.payload ? (
              <details className="payload-details">
                <summary>Show canonical record details</summary>
                <pre>{JSON.stringify(anchor.payload, null, 2)}</pre>
              </details>
            ) : (
              <p className="muted-note">The payload is not visible in this view.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
