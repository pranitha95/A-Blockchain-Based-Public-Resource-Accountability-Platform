import {
  computeCommitment,
  computeContentDigest,
  computeRecordKey,
  idToBytes32,
  RECORD_TYPE_CODE,
  RECORD_TYPE_LABEL,
  REGISTRY_ABI,
  ZERO_BYTES32,
  type AnchorDetailView,
  type AnchorStatus,
  type AnchorSummary,
  type AnchorRecordType,
  type SessionUser,
  type VerificationResult,
  type VerificationStatus,
} from '@poi/shared';
import { Contract, Interface, JsonRpcProvider, getAddress } from 'ethers';
import { query, withTransaction } from '../../db/pool.js';
import { getEnv } from '../../config/env.js';
import { badRequest, conflict, notFound, serviceUnavailable, unprocessable } from '../../lib/errors.js';
import { paginationFromQuery, totalPages } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { appendAuditEvent, AUDIT_ACTIONS, getProjectAuditHead, verifyAuditChain } from '../audit/audit.service.js';
import { createNotification } from '../notifications/notifications.service.js';
import {
  assertCanAnchor,
  getProjectAccess,
  getProjectAccessForUpdate,
  isPubliclyVisibleProject,
  sessionActor,
} from '../projects/project-access.js';
import type { ProjectStatus } from '@poi/shared';

const ANCHOR_SELECT = `
  SELECT a.*, p.code AS project_code, p.title AS project_title, p.visibility AS project_visibility,
         p.status AS project_status, u.full_name AS created_by_name
    FROM blockchain_anchors a
    JOIN projects p ON p.id = a.project_id
    LEFT JOIN users u ON u.id = a.created_by
`;

interface AnchorRow {
  id: string;
  project_id: string;
  record_type: AnchorRecordType;
  record_id: string;
  record_version: number;
  content_digest: string;
  commitment: string;
  payload: Record<string, unknown>;
  status: AnchorStatus;
  chain_id: number | null;
  contract_address: string | null;
  previous_anchor_id: string | null;
  tx_hash: string | null;
  block_number: number | null;
  confirmations: number | null;
  anchored_at: Date | null;
  last_checked_at: Date | null;
  failure_reason: string | null;
  created_by: string;
  created_at: Date;
  project_code: string;
  project_title: string;
  project_visibility: 'PUBLIC' | 'PRIVATE';
  project_status: ProjectStatus;
  created_by_name: string | null;
}

interface TxRow {
  tx_hash: string;
  from_address: string | null;
  status: string;
  submitted_at: Date;
  checked_at: Date | null;
  block_number: number | null;
  failure_reason: string | null;
}

const registryInterface = new Interface([...REGISTRY_ABI]);

export interface ChainInfo {
  chainId: number;
  chainName: string;
  contractAddress: string | null;
  rpcConfigured: boolean;
  explorerBaseUrl: string;
  requiredConfirmations: number;
  anchoringAvailable: boolean;
}

export function getChainInfo(): ChainInfo {
  const env = getEnv();
  return {
    chainId: env.CHAIN_ID,
    chainName: env.CHAIN_NAME,
    contractAddress: env.CONTRACT_ADDRESS,
    rpcConfigured: Boolean(env.RPC_URL),
    explorerBaseUrl: env.EXPLORER_BASE_URL,
    requiredConfirmations: env.ANCHOR_CONFIRMATIONS,
    anchoringAvailable: Boolean(env.CONTRACT_ADDRESS && env.RPC_URL),
  };
}

function requireAnchoringConfigured(): { chainId: number; contractAddress: string } {
  const env = getEnv();
  if (!env.CONTRACT_ADDRESS) {
    throw serviceUnavailable(
      'The blockchain registry address is not configured. Deploy the ProofOfImpactRegistry contract and set CONTRACT_ADDRESS before anchoring records.',
      { code: 'CONTRACT_NOT_CONFIGURED' },
    );
  }
  if (!env.RPC_URL) {
    throw serviceUnavailable('A blockchain RPC endpoint is not configured (RPC_URL).', { code: 'RPC_NOT_CONFIGURED' });
  }
  return { chainId: env.CHAIN_ID, contractAddress: getAddress(env.CONTRACT_ADDRESS) };
}

let cachedProvider: { url: string; provider: JsonRpcProvider } | null = null;

function getProvider(): JsonRpcProvider {
  const env = getEnv();
  if (!env.RPC_URL) {
    throw serviceUnavailable('A blockchain RPC endpoint is not configured (RPC_URL).', { code: 'RPC_NOT_CONFIGURED' });
  }
  if (!cachedProvider || cachedProvider.url !== env.RPC_URL) {
    cachedProvider = { url: env.RPC_URL, provider: new JsonRpcProvider(env.RPC_URL) };
  }
  return cachedProvider.provider;
}

function explorerTxUrl(txHash: string | null): string | null {
  if (!txHash) return null;
  return `${getEnv().EXPLORER_BASE_URL.replace(/\/$/, '')}/tx/${txHash}`;
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function loadAnchorRow(id: string): Promise<AnchorRow | null> {
  const result = await query<AnchorRow>(`${ANCHOR_SELECT} WHERE a.id = $1`, [id]);
  return result.rows[0] ?? null;
}

async function loadTransactions(anchorId: string): Promise<TxRow[]> {
  const result = await query<TxRow>(
    `SELECT tx_hash, from_address, status::text AS status, submitted_at, checked_at, block_number, failure_reason
       FROM blockchain_transactions WHERE anchor_id = $1 ORDER BY submitted_at DESC`,
    [anchorId],
  );
  return result.rows;
}

function previousKeyFor(anchor: AnchorRow, previousAnchor: { record_id: string; record_version: number } | null): string {
  if (!previousAnchor) return ZERO_BYTES32;
  return computeRecordKey({
    projectId: anchor.project_id,
    recordType: anchor.record_type,
    recordId: previousAnchor.record_id,
    recordVersion: Number(previousAnchor.record_version),
  });
}

export async function getAnchorDetail(actor: SessionUser | null, anchorId: string): Promise<AnchorDetailView> {
  const anchor = await loadAnchorRow(anchorId);
  if (!anchor) throw notFound('Blockchain anchor not found');
  const access = await getProjectAccess(sessionActor(actor), anchor.project_id);
  if (!access.canView) throw notFound('Blockchain anchor not found');

  // Public viewers may read commitments for publicly visible projects.
  if (!actor || actor.role === 'OBSERVER') {
    if (anchor.project_visibility !== 'PUBLIC' || !isPubliclyVisibleProject({ status: anchor.project_status, visibility: anchor.project_visibility })) {
      throw notFound('Blockchain anchor not found');
    }
  }

  const transactions = await loadTransactions(anchorId);
  let previousAnchor: { record_id: string; record_version: number } | null = null;
  if (anchor.previous_anchor_id) {
    const previous = await query<{ record_id: string; record_version: number }>(
      'SELECT record_id, record_version FROM blockchain_anchors WHERE id = $1',
      [anchor.previous_anchor_id],
    );
    previousAnchor = previous.rows[0] ?? null;
  }

  const recomputedDigest = (() => {
    try {
      return computeContentDigest(anchor.payload);
    } catch {
      return null;
    }
  })();
  const recomputedCommitment = (() => {
    try {
      if (!anchor.chain_id || !anchor.contract_address || !recomputedDigest) return null;
      return computeCommitment({
        chainId: Number(anchor.chain_id),
        registryAddress: anchor.contract_address,
        projectId: anchor.project_id,
        recordType: anchor.record_type,
        recordId: anchor.record_id,
        recordVersion: Number(anchor.record_version),
        contentDigest: recomputedDigest,
      });
    } catch {
      return null;
    }
  })();

  return {
    id: anchor.id,
    projectId: anchor.project_id,
    projectCode: anchor.project_code,
    projectTitle: anchor.project_title,
    recordType: anchor.record_type,
    recordId: anchor.record_id,
    recordVersion: Number(anchor.record_version),
    recordLabel: String(anchor.payload?.recordLabel ?? `${RECORD_TYPE_LABEL[anchor.record_type]} v${anchor.record_version}`),
    contentDigest: anchor.content_digest,
    commitment: anchor.commitment,
    status: anchor.status,
    chainId: anchor.chain_id === null ? null : Number(anchor.chain_id),
    contractAddress: anchor.contract_address,
    txHash: anchor.tx_hash,
    blockNumber: anchor.block_number === null ? null : Number(anchor.block_number),
    confirmations: anchor.confirmations === null ? null : Number(anchor.confirmations),
    anchoredAt: iso(anchor.anchored_at),
    lastCheckedAt: iso(anchor.last_checked_at),
    failureReason: anchor.failure_reason,
    createdAt: iso(anchor.created_at)!,
    createdByName: anchor.created_by_name ?? 'Unknown user',
    explorerUrl: explorerTxUrl(anchor.tx_hash),
    previousAnchorId: anchor.previous_anchor_id,
    projectIdBytes32: idToBytes32(anchor.project_id),
    recordIdBytes32: idToBytes32(anchor.record_id),
    recordTypeCode: RECORD_TYPE_CODE[anchor.record_type],
    previousKey: previousKeyFor(anchor, previousAnchor),
    payload: anchor.payload,
    transactions: transactions.map((tx) => ({
      txHash: tx.tx_hash,
      fromAddress: tx.from_address,
      status: tx.status,
      submittedAt: iso(tx.submitted_at)!,
      checkedAt: iso(tx.checked_at),
      blockNumber: tx.block_number === null ? null : Number(tx.block_number),
      failureReason: tx.failure_reason,
    })),
    verification: {
      localDigestMatches: recomputedDigest === anchor.content_digest,
      localCommitmentMatches: recomputedCommitment === anchor.commitment,
      onChainDigest: null,
      onChainChecked: false,
      explanation:
        'Local re-computation checks the stored payload against the recorded digest and commitment. Use the verification endpoint to compare the commitment with the registry contract on-chain.',
    },
  };
}

interface AnchorSummaryRow {
  id: string;
  project_id: string;
  record_type: AnchorRecordType;
  record_id: string;
  record_version: number;
  content_digest: string;
  commitment: string;
  status: AnchorStatus;
  chain_id: number | null;
  contract_address: string | null;
  tx_hash: string | null;
  block_number: number | null;
  confirmations: number | null;
  anchored_at: Date | null;
  failure_reason: string | null;
  created_at: Date;
  project_code: string;
  project_title: string;
}

function mapAnchorSummary(row: AnchorSummaryRow): AnchorSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectTitle: row.project_title,
    recordType: row.record_type,
    recordId: row.record_id,
    recordVersion: Number(row.record_version),
    contentDigest: row.content_digest,
    commitment: row.commitment,
    status: row.status,
    chainId: row.chain_id === null ? null : Number(row.chain_id),
    contractAddress: row.contract_address,
    txHash: row.tx_hash,
    blockNumber: row.block_number === null ? null : Number(row.block_number),
    confirmations: row.confirmations === null ? null : Number(row.confirmations),
    anchoredAt: iso(row.anchored_at),
    failureReason: row.failure_reason,
    createdAt: iso(row.created_at)!,
  };
}

export async function listAnchors(
  actor: SessionUser | null,
  options: {
    projectId?: string;
    recordType?: AnchorRecordType;
    status?: AnchorStatus;
    page?: number;
    pageSize?: number;
  },
): Promise<{ items: AnchorSummary[]; page: number; pageSize: number; total: number; totalPages: number }> {
  const pagination = paginationFromQuery({ page: options.page ?? 1, pageSize: options.pageSize ?? 20 }, 20);
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (options.projectId) {
    const access = await getProjectAccess(sessionActor(actor), options.projectId);
    if (!access.viewer || actor?.role === 'OBSERVER') {
      if (!access.isPubliclyVisible) throw notFound('Project not found');
    }
    params.push(options.projectId);
    conditions.push(`a.project_id = $${params.length}`);
  } else if (!actor || actor.role === 'OBSERVER') {
    conditions.push(`p.visibility = 'PUBLIC' AND p.status IN ('APPROVED','IN_PROGRESS','UNDER_REVIEW','COMPLETED','SUSPENDED','CANCELLED')`);
  } else if (actor.role === 'PROJECT_OWNER') {
    params.push(actor.id);
    conditions.push(`p.owner_id = $${params.length}`);
  } else if (actor.role === 'REVIEWER') {
    params.push(actor.id);
    conditions.push(`a.project_id IN (SELECT project_id FROM reviewer_assignments WHERE reviewer_id = $${params.length} AND active)`);
  }
  if (options.recordType) {
    params.push(options.recordType);
    conditions.push(`a.record_type = $${params.length}`);
  }
  if (options.status) {
    params.push(options.status);
    conditions.push(`a.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const count = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM blockchain_anchors a JOIN projects p ON p.id = a.project_id ${where}`,
    params,
  );
  const total = Number(count.rows[0]?.count ?? 0);
  const result = await query<AnchorSummaryRow>(
    `SELECT a.*, p.code AS project_code, p.title AS project_title
       FROM blockchain_anchors a JOIN projects p ON p.id = a.project_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pagination.pageSize, pagination.offset],
  );
  return {
    items: result.rows.map(mapAnchorSummary),
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: totalPages(total, pagination.pageSize),
  };
}

interface ResolvedRecord {
  projectId: string;
  projectCode: string;
  projectTitle: string;
  recordType: AnchorRecordType;
  recordId: string;
  recordVersion: number;
  payload: Record<string, unknown>;
}

async function publicEvidenceSummary(projectId: string, filter: { submissionId?: string; claimId?: string }) {
  const params: unknown[] = [projectId];
  let join = '';
  let condition = '';
  if (filter.submissionId) {
    join = 'JOIN milestone_submission_evidence link ON link.evidence_id = e.id AND link.submission_id = $2';
  } else if (filter.claimId) {
    join = 'JOIN expenditure_claim_evidence link ON link.evidence_id = e.id AND link.claim_id = $2';
  }
  if (join) params.push(filter.submissionId ?? filter.claimId);
  condition = "AND e.visibility = 'PUBLIC' AND e.archived_at IS NULL";
  const result = await query<{ title: string; sha256: string; mime_type: string; size_bytes: string }>(
    `SELECT e.title, f.sha256, f.mime_type, f.size_bytes
       FROM evidence e JOIN stored_files f ON f.id = e.file_id ${join}
      WHERE e.project_id = $1 ${condition}
      ORDER BY e.created_at ASC`,
    params,
  );
  return result.rows.map((row) => ({
    title: row.title,
    sha256: row.sha256,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
  }));
}

async function resolveAnchorRecord(
  actor: SessionUser,
  recordType: AnchorRecordType,
  recordId: string,
): Promise<ResolvedRecord> {
  if (recordType === 'PROJECT') {
    const access = await getProjectAccess(sessionActor(actor), recordId);
    assertCanAnchor(access);
    if (['DRAFT', 'SUBMITTED'].includes(access.project.status)) {
      throw unprocessable('A project can only be anchored after it has been approved');
    }
    const project = access.project;
    const objectives = await query<{ objective: string }>(
      'SELECT objective FROM project_objectives WHERE project_id = $1 ORDER BY position',
      [project.id],
    );
    const payload: Record<string, unknown> = {
      schema: 'proof-of-impact/anchor/v1',
      recordLabel: `Project ${project.code}`,
      project: {
        id: project.id,
        code: project.code,
        title: project.title,
        description: project.description,
        problemStatement: project.problem_statement,
        categoryId: project.category_id,
        organizationName: project.organization_name,
        locationName: project.location_name,
        latitude: Number(project.latitude),
        longitude: Number(project.longitude),
        budgetAmount: String(project.budget_amount),
        currency: project.currency,
        startDate: project.start_date,
        endDate: project.end_date,
        status: project.status,
        approvedAt: iso(project.approved_at),
        updatedAt: iso(project.updated_at),
      },
      objectives: objectives.rows.map((row) => row.objective),
      recordVersion: Number(project.version),
    };
    return {
      projectId: project.id,
      projectCode: project.code,
      projectTitle: project.title,
      recordType,
      recordId: project.id,
      recordVersion: Number(project.version),
      payload,
    };
  }

  if (recordType === 'MILESTONE_SUBMISSION') {
    const result = await query<{
      id: string;
      milestone_id: string;
      version: number;
      summary: string;
      submitted_at: Date;
      status: string;
      milestone_title: string;
      sequence: number;
      expected_completion: string;
      project_id: string;
      project_code: string;
      project_title: string;
      project_status: ProjectStatus;
    }>(
      `SELECT ms.id, ms.milestone_id, ms.version, ms.summary, ms.submitted_at, ms.status::text AS status,
              m.title AS milestone_title, m.sequence, m.expected_completion,
              p.id AS project_id, p.code AS project_code, p.title AS project_title, p.status::text AS project_status
         FROM milestone_submissions ms
         JOIN milestones m ON m.id = ms.milestone_id
         JOIN projects p ON p.id = m.project_id
        WHERE ms.id = $1`,
      [recordId],
    );
    const row = result.rows[0];
    if (!row) throw notFound('Milestone submission not found');
    const access = await getProjectAccess(sessionActor(actor), row.project_id);
    assertCanAnchor(access);
    if (!['SUBMITTED', 'APPROVED', 'REJECTED', 'DISPUTED'].includes(row.status)) {
      throw unprocessable('Only a submitted milestone record can be anchored');
    }
    const root = await query<{ id: string }>(
      'SELECT id FROM milestone_submissions WHERE milestone_id = $1 ORDER BY version ASC LIMIT 1',
      [row.milestone_id],
    );
    const recordRootId = root.rows[0]?.id ?? row.id;
    const evidence = await publicEvidenceSummary(row.project_id, { submissionId: row.id });
    return {
      projectId: row.project_id,
      projectCode: row.project_code,
      projectTitle: row.project_title,
      recordType,
      recordId: recordRootId,
      recordVersion: Number(row.version),
      payload: {
        schema: 'proof-of-impact/anchor/v1',
        recordLabel: `Milestone submission: ${row.milestone_title} (v${row.version})`,
        project: { id: row.project_id, code: row.project_code, title: row.project_title },
        milestone: {
          id: row.milestone_id,
          sequence: Number(row.sequence),
          title: row.milestone_title,
          expectedCompletionDate: row.expected_completion,
        },
        submission: {
          id: row.id,
          version: Number(row.version),
          summary: row.summary,
          submittedAt: iso(row.submitted_at),
          status: row.status,
        },
        publicEvidence: evidence,
        note: 'Evidence marked restricted is excluded from this commitment payload. The anchoring commitment does not attest that the evidence is truthful.',
      },
    };
  }

  if (recordType === 'REVIEW') {
    const result = await query<{
      id: string;
      project_id: string;
      target_type: string;
      target_id: string;
      target_version: number;
      decision: string;
      rationale: string;
      created_at: Date;
      project_code: string;
      project_title: string;
    }>(
      `SELECT r.*, p.code AS project_code, p.title AS project_title
         FROM reviews r JOIN projects p ON p.id = r.project_id WHERE r.id = $1`,
      [recordId],
    );
    const row = result.rows[0];
    if (!row) throw notFound('Review not found');
    const access = await getProjectAccess(sessionActor(actor), row.project_id);
    assertCanAnchor(access);
    return {
      projectId: row.project_id,
      projectCode: row.project_code,
      projectTitle: row.project_title,
      recordType,
      recordId: row.id,
      recordVersion: 1,
      payload: {
        schema: 'proof-of-impact/anchor/v1',
        recordLabel: `Independent review decision: ${row.decision.replaceAll('_', ' ').toLowerCase()}`,
        project: { id: row.project_id, code: row.project_code, title: row.project_title },
        review: {
          id: row.id,
          targetType: row.target_type,
          targetId: row.target_id,
          targetVersion: Number(row.target_version),
          decision: row.decision,
          rationale: row.rationale,
          createdAt: iso(row.created_at),
        },
        note: 'This commitment records that a review decision with this content existed at a point in time. It does not prove that the decision was correct.',
      },
    };
  }

  if (recordType === 'EXPENDITURE_CLAIM') {
    const result = await query<{
      id: string;
      project_id: string;
      reference: string;
      version: number;
      amount: string;
      currency: string;
      claimed_date: string;
      category: string;
      description: string;
      supplier_name: string | null;
      status: string;
      submitted_at: Date;
      project_code: string;
      project_title: string;
    }>(
      `SELECT ec.*, p.code AS project_code, p.title AS project_title
         FROM expenditure_claims ec JOIN projects p ON p.id = ec.project_id WHERE ec.id = $1`,
      [recordId],
    );
    const row = result.rows[0];
    if (!row) throw notFound('Expenditure claim not found');
    const access = await getProjectAccess(sessionActor(actor), row.project_id);
    assertCanAnchor(access);
    if (row.status === 'DRAFT') throw unprocessable('Only submitted expenditure claims can be anchored');
    const root = await query<{ id: string }>(
      'SELECT id FROM expenditure_claims WHERE project_id = $1 AND reference = $2 ORDER BY version ASC LIMIT 1',
      [row.project_id, row.reference],
    );
    const recordRootId = root.rows[0]?.id ?? row.id;
    const evidence = await publicEvidenceSummary(row.project_id, { claimId: row.id });
    return {
      projectId: row.project_id,
      projectCode: row.project_code,
      projectTitle: row.project_title,
      recordType,
      recordId: recordRootId,
      recordVersion: Number(row.version),
      payload: {
        schema: 'proof-of-impact/anchor/v1',
        recordLabel: `Expenditure claim ${row.reference} (v${row.version})`,
        project: { id: row.project_id, code: row.project_code, title: row.project_title },
        claim: {
          id: row.id,
          reference: row.reference,
          version: Number(row.version),
          amount: String(row.amount),
          currency: row.currency,
          claimedDate: row.claimed_date,
          category: row.category,
          description: row.description,
          supplierName: row.supplier_name,
          status: row.status,
          submittedAt: iso(row.submitted_at),
        },
        publicEvidence: evidence,
        note: 'An approved or anchored expenditure claim is not proof that a payment was made or that an invoice is genuine.',
      },
    };
  }

  // AUDIT_BATCH: recordId is the project id; version is the current audit sequence.
  const access = await getProjectAccess(sessionActor(actor), recordId);
  assertCanAnchor(access);
  const head = await getProjectAuditHead(recordId);
  if (!head.latestSeq || !head.headHash) throw unprocessable('There are no audit events to anchor for this project yet');
  const integrity = await verifyAuditChain();
  return {
    projectId: recordId,
    projectCode: access.project.code,
    projectTitle: access.project.title,
    recordType,
    recordId,
    recordVersion: head.latestSeq,
    payload: {
      schema: 'proof-of-impact/anchor/v1',
      recordLabel: `Audit history through event #${head.latestSeq}`,
      project: { id: access.project.id, code: access.project.code, title: access.project.title },
      auditBatch: {
        latestSeq: head.latestSeq,
        headHash: head.headHash,
        eventCount: head.count,
        chainVerifiedAtPreparation: integrity.valid,
      },
      note: 'This commits to the audit hash head at preparation time. It does not make the underlying project records true.',
    },
  };
}

export async function prepareAnchor(
  actor: SessionUser,
  input: { recordType: AnchorRecordType; recordId: string },
): Promise<AnchorDetailView> {
  const { chainId, contractAddress } = requireAnchoringConfigured();
  const record = await resolveAnchorRecord(actor, input.recordType, input.recordId);
  const contentDigest = computeContentDigest(record.payload);

  const anchorId = await withTransaction(async (client) => {
    const access = await getProjectAccessForUpdate(client, sessionActor(actor), record.projectId);
    assertCanAnchor(access);
    const existingRows = await client.query<AnchorRow>(
      `${ANCHOR_SELECT} WHERE a.project_id = $1 AND a.record_type = $2 AND a.record_id = $3 ORDER BY a.record_version DESC FOR UPDATE OF a`,
      [record.projectId, record.recordType, record.recordId],
    );
    const existingSame = existingRows.rows.find((row) => Number(row.record_version) === record.recordVersion);
    if (existingSame) {
      const existingDigest = computeContentDigest(existingSame.payload);
      if (existingDigest !== contentDigest) {
        throw conflict('This record version has changed since its anchor was prepared. Create a new version before anchoring.');
      }
      if (existingSame.status === 'FAILED') {
        await client.query(
          `UPDATE blockchain_anchors
              SET status = 'AWAITING_WALLET', tx_hash = NULL, block_number = NULL, confirmations = NULL,
                  failure_reason = NULL, last_checked_at = NULL
            WHERE id = $1`,
          [existingSame.id],
        );
        await appendAuditEvent(client, {
          projectId: record.projectId,
          actorId: actor.id,
          actorRole: actor.role,
          action: AUDIT_ACTIONS.ANCHOR_PREPARED,
          entityType: record.recordType,
          entityId: record.recordId,
          summary: `Anchor re-opened for wallet submission after a failed transaction: ${String(record.payload.recordLabel ?? record.recordType)}`,
          metadata: { anchorId: existingSame.id, previousFailure: existingSame.failure_reason, commitment: existingSame.commitment },
          recordVersion: record.recordVersion,
        });
      }
      return existingSame.id;
    }
    const newer = existingRows.rows.find((row) => Number(row.record_version) > record.recordVersion);
    if (newer) throw conflict('A newer version of this record is already prepared or anchored');
    const pending = existingRows.rows.find((row) => row.status !== 'CONFIRMED' && row.status !== 'FAILED');
    if (pending) {
      throw conflict('An earlier version of this record is awaiting blockchain confirmation. Finish or reconcile that anchor first.');
    }
    const latestConfirmed = existingRows.rows
      .filter((row) => row.status === 'CONFIRMED')
      .sort((a, b) => Number(b.record_version) - Number(a.record_version))[0];
    if (latestConfirmed && Number(latestConfirmed.record_version) >= record.recordVersion) {
      throw conflict('This record version is not newer than the last confirmed anchor');
    }

    const commitment = computeCommitment({
      chainId,
      registryAddress: contractAddress,
      projectId: record.projectId,
      recordType: record.recordType,
      recordId: record.recordId,
      recordVersion: record.recordVersion,
      contentDigest,
    });
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO blockchain_anchors
         (project_id, record_type, record_id, record_version, content_digest, commitment, payload,
          status, chain_id, contract_address, previous_anchor_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'AWAITING_WALLET',$8,$9,$10,$11)
       RETURNING id`,
      [
        record.projectId,
        record.recordType,
        record.recordId,
        record.recordVersion,
        contentDigest,
        commitment,
        JSON.stringify(record.payload),
        chainId,
        contractAddress,
        latestConfirmed?.id ?? null,
        actor.id,
      ],
    );
    const id = inserted.rows[0]!.id;
    await appendAuditEvent(client, {
      projectId: record.projectId,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.ANCHOR_PREPARED,
      entityType: record.recordType,
      entityId: record.recordId,
      summary: `Anchor prepared: ${String(record.payload.recordLabel ?? record.recordType)}`,
      metadata: {
        anchorId: id,
        recordType: record.recordType,
        recordVersion: record.recordVersion,
        contentDigest,
        commitment,
        chainId,
        contractAddress,
        previousAnchorId: latestConfirmed?.id ?? null,
      },
      recordVersion: record.recordVersion,
    });
    return id;
  });

  return getAnchorDetail(actor, anchorId);
}

interface OnChainVerification {
  status: AnchorStatus | null;
  confirmations: number | null;
  blockNumber: number | null;
  anchoredAt: Date | null;
  fromAddress: string | null;
  failureReason: string | null;
  transactionVisible: boolean;
  receiptVisible: boolean;
  event: {
    key: string;
    commitment: string;
    contentDigest: string;
    recordVersion: number;
    projectIdHash: string;
    recordIdHash: string;
    recordTypeCode: number;
    previousKey: string;
  } | null;
}

async function inspectTransaction(anchor: AnchorRow, txHash: string): Promise<OnChainVerification> {
  const env = getEnv();
  const provider = getProvider();
  const successStatus = (confirmations: number): AnchorStatus =>
    confirmations >= env.ANCHOR_CONFIRMATIONS ? 'CONFIRMED' : 'PENDING_CONFIRMATION';

  try {
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== Number(anchor.chain_id ?? env.CHAIN_ID)) {
      return {
        status: 'VERIFICATION_ERROR',
        confirmations: null,
        blockNumber: null,
        anchoredAt: null,
        fromAddress: null,
        failureReason: `The configured RPC endpoint is on chain ${network.chainId}, but this anchor targets chain ${anchor.chain_id}.`,
        transactionVisible: false,
        receiptVisible: false,
        event: null,
      };
    }
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return {
        status: 'TRANSACTION_SUBMITTED',
        confirmations: null,
        blockNumber: null,
        anchoredAt: null,
        fromAddress: null,
        failureReason: 'The transaction is not yet visible to the configured RPC endpoint. It may still be propagating.',
        transactionVisible: false,
        receiptVisible: false,
        event: null,
      };
    }
    if (tx.chainId !== undefined && Number(tx.chainId) !== Number(anchor.chain_id)) {
      return {
        status: 'VERIFICATION_ERROR',
        confirmations: null,
        blockNumber: null,
        anchoredAt: null,
        fromAddress: tx.from ?? null,
        failureReason: `The transaction is on chain ${tx.chainId}, not the configured chain ${anchor.chain_id}.`,
        transactionVisible: true,
        receiptVisible: false,
        event: null,
      };
    }
    const expectedContract = anchor.contract_address ? getAddress(anchor.contract_address) : null;
    if (!expectedContract) {
      return {
        status: 'VERIFICATION_ERROR',
        confirmations: null,
        blockNumber: null,
        anchoredAt: null,
        fromAddress: tx.from ?? null,
        failureReason: 'The anchor does not record a registry contract address.',
        transactionVisible: true,
        receiptVisible: false,
        event: null,
      };
    }
    if (!tx.to || getAddress(tx.to) !== expectedContract) {
      return {
        status: 'VERIFICATION_ERROR',
        confirmations: null,
        blockNumber: null,
        anchoredAt: null,
        fromAddress: tx.from ?? null,
        failureReason: 'The transaction was not sent to the configured registry contract.',
        transactionVisible: true,
        receiptVisible: false,
        event: null,
      };
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return {
        status: 'PENDING_CONFIRMATION',
        confirmations: 0,
        blockNumber: null,
        anchoredAt: null,
        fromAddress: tx.from ?? null,
        failureReason: 'The transaction is known to the network but is not yet mined.',
        transactionVisible: true,
        receiptVisible: false,
        event: null,
      };
    }
    if (receipt.status !== 1) {
      return {
        status: 'FAILED',
        confirmations: 0,
        blockNumber: receipt.blockNumber,
        anchoredAt: null,
        fromAddress: receipt.from ?? null,
        failureReason: 'The anchoring transaction reverted on-chain.',
        transactionVisible: true,
        receiptVisible: true,
        event: null,
      };
    }

    const expectedKey = computeRecordKey({
      projectId: anchor.project_id,
      recordType: anchor.record_type,
      recordId: anchor.record_id,
      recordVersion: Number(anchor.record_version),
    });
    const expectedPreviousKey = (() => {
      if (!anchor.previous_anchor_id) return ZERO_BYTES32;
      return ZERO_BYTES32; // resolved by caller if relevant; previous key is validated when serializing anchors
    })();

    let event: OnChainVerification['event'] = null;
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== expectedContract) continue;
      let parsed: ReturnType<Interface['parseLog']> | null = null;
      try {
        parsed = registryInterface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.name !== 'RecordAnchored') continue;
      const args = parsed.args;
      event = {
        key: String(args.key),
        commitment: String(args.commitment),
        contentDigest: String(args.contentDigest),
        recordVersion: Number(args.recordVersion),
        projectIdHash: String(args.projectId),
        recordIdHash: String(args.recordId),
        recordTypeCode: Number(args.recordType),
        previousKey: String(args.previousKey),
      };
      if (String(args.key).toLowerCase() === expectedKey.toLowerCase()) break;
    }

    if (!event) {
      return {
        status: 'VERIFICATION_ERROR',
        confirmations: 0,
        blockNumber: receipt.blockNumber,
        anchoredAt: null,
        fromAddress: receipt.from ?? null,
        failureReason: 'The transaction confirmed but did not emit the expected RecordAnchored event from the registry contract.',
        transactionVisible: true,
        receiptVisible: true,
        event: null,
      };
    }

    const mismatches: string[] = [];
    if (event.key.toLowerCase() !== expectedKey.toLowerCase()) mismatches.push('record key');
    if (event.projectIdHash.toLowerCase() !== idToBytes32(anchor.project_id).toLowerCase()) mismatches.push('project id');
    if (event.recordIdHash.toLowerCase() !== idToBytes32(anchor.record_id).toLowerCase()) mismatches.push('record id');
    if (event.recordTypeCode !== RECORD_TYPE_CODE[anchor.record_type]) mismatches.push('record type');
    if (event.recordVersion !== Number(anchor.record_version)) mismatches.push('record version');
    if (event.contentDigest.toLowerCase() !== anchor.content_digest.toLowerCase()) mismatches.push('content digest');
    if (event.commitment.toLowerCase() !== anchor.commitment.toLowerCase()) mismatches.push('commitment');
    if (anchor.previous_anchor_id) {
      const previous = await query<{ record_id: string; record_version: number }>(
        'SELECT record_id, record_version FROM blockchain_anchors WHERE id = $1',
        [anchor.previous_anchor_id],
      );
      const previousRow = previous.rows[0];
      const previousKey = previousRow
        ? computeRecordKey({
            projectId: anchor.project_id,
            recordType: anchor.record_type,
            recordId: previousRow.record_id,
            recordVersion: Number(previousRow.record_version),
          })
        : ZERO_BYTES32;
      if (event.previousKey.toLowerCase() !== previousKey.toLowerCase()) mismatches.push('previous key');
    } else if (event.previousKey !== expectedPreviousKey) {
      mismatches.push('previous key');
    }
    if (mismatches.length > 0) {
      return {
        status: 'VERIFICATION_ERROR',
        confirmations: 0,
        blockNumber: receipt.blockNumber,
        anchoredAt: null,
        fromAddress: receipt.from ?? null,
        failureReason: `The on-chain event does not match the prepared anchor (${mismatches.join(', ')}).`,
        transactionVisible: true,
        receiptVisible: true,
        event,
      };
    }

    const currentBlock = await provider.getBlockNumber();
    const confirmations = Math.max(0, currentBlock - receipt.blockNumber + 1);
    const block = await provider.getBlock(receipt.blockNumber);
    return {
      status: successStatus(confirmations),
      confirmations,
      blockNumber: receipt.blockNumber,
      anchoredAt: block ? new Date(Number(block.timestamp) * 1000) : null,
      fromAddress: receipt.from ?? null,
      failureReason: null,
      transactionVisible: true,
      receiptVisible: true,
      event,
    };
  } catch (error) {
    logger.warn({ err: error, anchorId: anchor.id, txHash }, 'Blockchain verification request failed');
    return {
      status: 'VERIFICATION_ERROR',
      confirmations: null,
      blockNumber: null,
      anchoredAt: null,
      fromAddress: null,
      failureReason: `The RPC verification request failed: ${(error as Error).message.slice(0, 300)}`,
      transactionVisible: false,
      receiptVisible: false,
      event: null,
    };
  }
}

async function applyVerification(anchor: AnchorRow, verification: OnChainVerification, txHash: string): Promise<void> {
  const status = verification.status ?? 'VERIFICATION_ERROR';
  const confirmed = status === 'CONFIRMED';
  await withTransaction(async (client) => {
    const previousStatus = anchor.status;
    await client.query(
      `UPDATE blockchain_anchors
          SET status = $1, tx_hash = COALESCE($2, tx_hash), block_number = $3, confirmations = $4,
              anchored_at = CASE WHEN $1 = 'CONFIRMED' THEN COALESCE($5, anchored_at, now()) ELSE anchored_at END,
              last_checked_at = now(), failure_reason = $6
        WHERE id = $7`,
      [
        status,
        txHash,
        verification.blockNumber,
        verification.confirmations,
        verification.anchoredAt,
        verification.failureReason,
        anchor.id,
      ],
    );
    const txStatus =
      status === 'TRANSACTION_SUBMITTED' || status === 'AWAITING_WALLET'
        ? 'SUBMITTED'
        : status === 'PENDING_CONFIRMATION'
          ? 'PENDING_CONFIRMATION'
          : status;
    await client.query(
      `INSERT INTO blockchain_transactions (anchor_id, tx_hash, from_address, status, checked_at, block_number, failure_reason, metadata)
       VALUES ($1,$2,$3,$4,now(),$5,$6,$7::jsonb)
       ON CONFLICT (tx_hash) DO UPDATE
         SET from_address = EXCLUDED.from_address, status = EXCLUDED.status, checked_at = now(),
             block_number = EXCLUDED.block_number, failure_reason = EXCLUDED.failure_reason, metadata = EXCLUDED.metadata`,
      [
        anchor.id,
        txHash,
        verification.fromAddress,
        txStatus,
        verification.blockNumber,
        verification.failureReason,
        JSON.stringify({ event: verification.event }),
      ],
    );

    if (confirmed && previousStatus !== 'CONFIRMED') {
      await appendAuditEvent(client, {
        projectId: anchor.project_id,
        actorId: null,
        actorRole: null,
        action: AUDIT_ACTIONS.ANCHOR_CONFIRMED,
        entityType: anchor.record_type,
        entityId: anchor.record_id,
        summary: `Blockchain anchor confirmed: ${String(anchor.payload?.recordLabel ?? anchor.record_type)}`,
        metadata: {
          anchorId: anchor.id,
          txHash,
          blockNumber: verification.blockNumber,
          confirmations: verification.confirmations,
          chainId: anchor.chain_id,
          contractAddress: anchor.contract_address,
          commitment: anchor.commitment,
          preparedBy: anchor.created_by,
        },
        recordVersion: Number(anchor.record_version),
      });
      const owner = await client.query<{ owner_id: string }>('SELECT owner_id FROM projects WHERE id = $1', [anchor.project_id]);
      const recipient = owner.rows[0]?.owner_id;
      if (recipient) {
        await createNotification(client, {
          userId: recipient,
          type: 'ANCHOR_CONFIRMED',
          title: 'Blockchain commitment confirmed',
          message: `${String(anchor.payload?.recordLabel ?? anchor.record_type)} is confirmed on-chain with ${verification.confirmations} confirmation(s).`,
          linkPath: `/blockchain?anchor=${anchor.id}`,
          dedupeKey: `ANCHOR_CONFIRMED:${anchor.id}`,
        });
      }
    } else if ((status === 'FAILED' || status === 'VERIFICATION_ERROR') && previousStatus !== status) {
      await appendAuditEvent(client, {
        projectId: anchor.project_id,
        actorId: null,
        actorRole: null,
        action: status === 'FAILED' ? AUDIT_ACTIONS.ANCHOR_FAILED : AUDIT_ACTIONS.ANCHOR_VERIFICATION_ERROR,
        entityType: anchor.record_type,
        entityId: anchor.record_id,
        summary: `Blockchain anchor ${status === 'FAILED' ? 'reverted' : 'could not be verified'}: ${String(anchor.payload?.recordLabel ?? anchor.record_type)}`,
        metadata: { anchorId: anchor.id, txHash, failureReason: verification.failureReason, preparedBy: anchor.created_by },
        recordVersion: Number(anchor.record_version),
      });
      const owner = await client.query<{ owner_id: string }>('SELECT owner_id FROM projects WHERE id = $1', [anchor.project_id]);
      const recipient = owner.rows[0]?.owner_id;
      if (recipient) {
        await createNotification(client, {
          userId: recipient,
          type: 'ANCHOR_FAILED',
          title: 'Blockchain anchoring needs attention',
          message: `${String(anchor.payload?.recordLabel ?? anchor.record_type)}: ${verification.failureReason ?? 'verification failed'}`,
          linkPath: `/blockchain?anchor=${anchor.id}`,
          dedupeKey: `ANCHOR_ISSUE:${anchor.id}:${status}`,
        });
      }
    }
  });
}

export async function submitAnchorTransaction(
  actor: SessionUser,
  anchorId: string,
  txHash: string,
): Promise<AnchorDetailView> {
  const anchor = await loadAnchorRow(anchorId);
  if (!anchor) throw notFound('Blockchain anchor not found');
  const access = await getProjectAccess(sessionActor(actor), anchor.project_id);
  assertCanAnchor(access);
  if (anchor.status === 'CONFIRMED') {
    if (anchor.tx_hash?.toLowerCase() === txHash.toLowerCase()) return getAnchorDetail(actor, anchorId);
    throw conflict('This anchor is already confirmed by another transaction');
  }
  const duplicate = await query<{ id: string; anchor_id: string }>(
    'SELECT id, anchor_id FROM blockchain_transactions WHERE tx_hash = $1',
    [txHash],
  );
  if (duplicate.rows[0] && duplicate.rows[0].anchor_id !== anchorId) {
    throw conflict('This transaction hash is already associated with another anchor');
  }
  if (
    anchor.tx_hash &&
    anchor.tx_hash.toLowerCase() !== txHash.toLowerCase() &&
    !['FAILED', 'VERIFICATION_ERROR'].includes(anchor.status)
  ) {
    throw conflict('A different transaction has already been recorded for this anchor');
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE blockchain_anchors SET tx_hash = $1, status = 'TRANSACTION_SUBMITTED', failure_reason = NULL, last_checked_at = now()
        WHERE id = $2`,
      [txHash, anchorId],
    );
    await client.query(
      `INSERT INTO blockchain_transactions (anchor_id, tx_hash, status, metadata)
       VALUES ($1,$2,'SUBMITTED','{}'::jsonb)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [anchorId, txHash],
    );
    await appendAuditEvent(client, {
      projectId: anchor.project_id,
      actorId: actor.id,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.ANCHOR_PREPARED,
      entityType: anchor.record_type,
      entityId: anchor.record_id,
      summary: `Wallet transaction submitted for ${String(anchor.payload?.recordLabel ?? anchor.record_type)}`,
      metadata: { anchorId, txHash, note: 'Submitted does not mean confirmed' },
      recordVersion: Number(anchor.record_version),
    });
  });

  const fresh = await loadAnchorRow(anchorId);
  if (!fresh) throw notFound('Blockchain anchor not found after submission');
  const verification = await inspectTransaction(fresh, txHash);
  await applyVerification(fresh, verification, txHash);
  return getAnchorDetail(actor, anchorId);
}

export async function reconcileAnchor(anchorId: string): Promise<AnchorStatus | null> {
  const anchor = await loadAnchorRow(anchorId);
  if (!anchor) return null;
  if (anchor.status === 'CONFIRMED') return 'CONFIRMED';
  if (!anchor.tx_hash) return anchor.status;
  const verification = await inspectTransaction(anchor, anchor.tx_hash);
  await applyVerification(anchor, verification, anchor.tx_hash);
  return verification.status;
}

let reconciling = false;

export async function reconcilePendingAnchors(): Promise<{ checked: number; errors: number }> {
  if (reconciling) return { checked: 0, errors: 0 };
  reconciling = true;
  try {
    const env = getEnv();
    if (!env.RPC_URL) return { checked: 0, errors: 0 };
    const result = await query<{ id: string }>(
      `SELECT id FROM blockchain_anchors
        WHERE status IN ('TRANSACTION_SUBMITTED','PENDING_CONFIRMATION','VERIFICATION_ERROR')
          AND tx_hash IS NOT NULL
        ORDER BY last_checked_at NULLS FIRST
        LIMIT 20`,
    );
    let errors = 0;
    for (const row of result.rows) {
      try {
        await reconcileAnchor(row.id);
      } catch (error) {
        errors += 1;
        logger.warn({ err: error, anchorId: row.id }, 'Anchor reconciliation failed');
      }
    }
    return { checked: result.rows.length, errors };
  } finally {
    reconciling = false;
  }
}

interface VerificationAnchor {
  anchor: AnchorRow | null;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  payloadVisible: boolean;
}

async function findAnchorForVerification(
  actor: SessionUser | null,
  input: { anchorId?: string; projectCode?: string; recordType?: AnchorRecordType; recordVersion?: number },
): Promise<VerificationAnchor> {
  if (input.anchorId) {
    const anchor = await loadAnchorRow(input.anchorId);
    if (!anchor) throw notFound('Blockchain anchor not found');
    const access = await getProjectAccess(sessionActor(actor), anchor.project_id);
    const publicViewer = !actor || actor.role === 'OBSERVER';
    if (publicViewer && !(access.isPubliclyVisible && anchor.project_visibility === 'PUBLIC')) {
      throw notFound('Blockchain anchor not found');
    }
    return {
      anchor,
      projectId: anchor.project_id,
      projectCode: anchor.project_code,
      projectTitle: anchor.project_title,
      payloadVisible: access.canSeeRestrictedData || access.isPubliclyVisible,
    };
  }

  if (!input.projectCode || !input.recordType) {
    throw badRequest('Provide an anchor id, or a project code and record type');
  }
  const projectResult = await query<{ id: string; code: string; title: string }>(
    'SELECT id, code, title FROM projects WHERE lower(code) = lower($1)',
    [input.projectCode],
  );
  const project = projectResult.rows[0];
  if (!project) throw notFound('Project not found');
  const access = await getProjectAccess(sessionActor(actor), project.id);
  const publicViewer = !actor || actor.role === 'OBSERVER';
  if (publicViewer && !access.isPubliclyVisible) throw notFound('Project not found');

  const params: unknown[] = [project.id, input.recordType];
  let versionCondition = '';
  if (input.recordVersion) {
    params.push(input.recordVersion);
    versionCondition = `AND a.record_version = $${params.length}`;
  }
  const result = await query<AnchorRow>(
    `${ANCHOR_SELECT}
      WHERE a.project_id = $1 AND a.record_type = $2 ${versionCondition}
      ORDER BY a.record_version DESC, a.created_at DESC
      LIMIT 1`,
    params,
  );
  const anchor = result.rows[0] ?? null;
  return {
    anchor,
    projectId: project.id,
    projectCode: project.code,
    projectTitle: project.title,
    payloadVisible: access.canSeeRestrictedData || access.isPubliclyVisible,
  };
}

interface OnChainRecord {
  projectId: string;
  recordType: number;
  recordId: string;
  recordVersion: number;
  contentDigest: string;
  commitment: string;
  previousKey: string;
  anchorer: string;
  anchoredAt: number;
  superseded: boolean;
}

export async function verifyRecord(
  actor: SessionUser | null,
  input: { anchorId?: string; projectCode?: string; recordType?: AnchorRecordType; recordId?: string; recordVersion?: number },
): Promise<VerificationResult> {
  const found = await findAnchorForVerification(actor, input);
  const checkedAt = new Date().toISOString();
  const makeResult = (partial: Partial<VerificationResult> & { status: VerificationStatus; explanation: string }): VerificationResult => ({
    recordType: found.anchor?.record_type ?? input.recordType ?? 'PROJECT',
    recordId: found.anchor?.record_id ?? input.recordId ?? '',
    recordVersion: found.anchor?.record_version ?? input.recordVersion ?? null,
    projectId: found.projectId,
    projectCode: found.projectCode,
    projectTitle: found.projectTitle,
    commitment: found.anchor?.commitment ?? null,
    contentDigest: found.anchor?.content_digest ?? null,
    recomputedContentDigest: null,
    onChainContentDigest: null,
    onChainCommitment: null,
    digestMatches: null,
    commitmentMatches: null,
    anchorStatus: found.anchor?.status ?? null,
    txHash: found.anchor?.tx_hash ?? null,
    blockNumber: found.anchor?.block_number ?? null,
    chainId: found.anchor?.chain_id ?? null,
    explorerUrl: explorerTxUrl(found.anchor?.tx_hash ?? null),
    payload: found.payloadVisible && found.anchor ? found.anchor.payload : null,
    checkedAt,
    ...partial,
  });

  if (!found.anchor) {
    return makeResult({
      status: 'NOT_FOUND',
      explanation:
        'No anchored commitment exists for this project and record type in the platform database. Nothing can be verified on-chain yet.',
    });
  }
  const anchor = found.anchor;

  if (!found.payloadVisible) {
    return makeResult({
      status: 'NOT_FOUND',
      explanation: 'This project is not publicly visible, so its commitment cannot be verified through the public endpoint.',
    });
  }

  let recomputedDigest: string | null = null;
  try {
    recomputedDigest = computeContentDigest(anchor.payload);
  } catch {
    recomputedDigest = null;
  }
  const localDigestMatch = recomputedDigest === anchor.content_digest;
  let recomputedCommitment: string | null = null;
  try {
    if (anchor.chain_id && anchor.contract_address && recomputedDigest) {
      recomputedCommitment = computeCommitment({
        chainId: Number(anchor.chain_id),
        registryAddress: anchor.contract_address,
        projectId: anchor.project_id,
        recordType: anchor.record_type,
        recordId: anchor.record_id,
        recordVersion: Number(anchor.record_version),
        contentDigest: recomputedDigest,
      });
    }
  } catch {
    recomputedCommitment = null;
  }
  const localCommitmentMatch = recomputedCommitment === anchor.commitment;
  const base = {
    recomputedContentDigest: recomputedDigest,
    digestMatches: localDigestMatch,
    commitmentMatches: false,
  };

  if (!localDigestMatch || !localCommitmentMatch) {
    return makeResult({
      ...base,
      status: 'MISMATCH',
      explanation:
        'The stored record payload no longer matches the digest or commitment that was recorded. The database record may have been altered outside the audited workflow.',
    });
  }

  const env = getEnv();
  if (!env.RPC_URL) {
    return makeResult({
      ...base,
      status: 'VERIFICATION_ERROR',
      explanation:
        'The stored payload matches its offline digest, but no RPC endpoint is configured, so the on-chain commitment could not be checked.',
    });
  }
  if (!anchor.chain_id || !anchor.contract_address) {
    return makeResult({
      ...base,
      status: 'VERIFICATION_ERROR',
      explanation: 'This anchor does not record a chain id or registry contract address, so it cannot be verified on-chain.',
    });
  }

  try {
    const provider = getProvider();
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== Number(anchor.chain_id)) {
      return makeResult({
        ...base,
        status: 'VERIFICATION_ERROR',
        explanation: `The configured RPC endpoint is on chain ${network.chainId}, but this commitment targets chain ${anchor.chain_id}.`,
      });
    }
    const contract = new Contract(anchor.contract_address, [...REGISTRY_ABI], provider) as unknown as {
      recordExists(key: string): Promise<boolean>;
      getRecord(key: string): Promise<OnChainRecord>;
    };
    const key = computeRecordKey({
      projectId: anchor.project_id,
      recordType: anchor.record_type,
      recordId: anchor.record_id,
      recordVersion: Number(anchor.record_version),
    });
    const exists = await contract.recordExists(key);
    if (!exists) {
      return makeResult({
        ...base,
        status: anchor.status === 'CONFIRMED' ? 'MISMATCH' : 'NOT_FOUND',
        explanation:
          anchor.status === 'CONFIRMED'
            ? 'The platform marked this anchor confirmed, but the registry contract does not contain the record. Treat the local confirmation as unreliable.'
            : 'The commitment has not been confirmed on-chain. No registry record exists for this key.',
      });
    }
    const record = await contract.getRecord(key);
    const onChainDigest = String(record.contentDigest);
    const onChainCommitment = String(record.commitment);
    const onChainVersion = Number(record.recordVersion);
    const onChainType = Number(record.recordType);
    const onChainProject = String(record.projectId);
    const onChainRecordId = String(record.recordId);
    const matches =
      onChainDigest.toLowerCase() === anchor.content_digest.toLowerCase() &&
      onChainCommitment.toLowerCase() === anchor.commitment.toLowerCase() &&
      onChainVersion === Number(anchor.record_version) &&
      onChainType === RECORD_TYPE_CODE[anchor.record_type] &&
      onChainProject.toLowerCase() === idToBytes32(anchor.project_id).toLowerCase() &&
      onChainRecordId.toLowerCase() === idToBytes32(anchor.record_id).toLowerCase();

    return makeResult({
      ...base,
      commitmentMatches: matches,
      status: matches ? 'MATCH' : 'MISMATCH',
      onChainContentDigest: onChainDigest,
      onChainCommitment,
      explanation: matches
        ? `The registry contract on ${getChainInfo().chainName} contains a record whose project, record type, record id, version, content digest and commitment all match this record. This proves the commitment existed on-chain; it does not prove the underlying claim is true.`
        : 'The registry contract contains a record for this key, but one or more fields differ from the platform record. The commitment should be investigated.',
    });
  } catch (error) {
    return makeResult({
      ...base,
      commitmentMatches: false,
      status: 'VERIFICATION_ERROR',
      explanation: `The on-chain verification request failed: ${(error as Error).message.slice(0, 300)}`,
    });
  }
}

export function anchorSummaryFromRow(row: AnchorSummaryRow): AnchorSummary {
  return mapAnchorSummary(row);
}
