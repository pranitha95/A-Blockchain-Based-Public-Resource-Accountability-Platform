import type { EvidenceMetadataInput, EvidenceView, SessionUser } from '@poi/shared';
import { query, withTransaction } from '../../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { appendAuditEvent, AUDIT_ACTIONS } from '../audit/audit.service.js';
import { getProjectAccess, projectScopeCondition, sessionActor } from '../projects/project-access.js';
import {
  removeStoredFile,
  resolveStoredFile,
  validateUpload,
  writeStoredFile,
  type ValidatedUpload,
} from './file-storage.js';

interface EvidenceRow {
  id: string;
  project_id: string;
  milestone_id: string | null;
  expenditure_claim_id: string | null;
  file_id: string;
  title: string;
  description: string | null;
  visibility: 'PUBLIC' | 'RESTRICTED';
  created_at: Date;
  uploader_name: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  sha256: string;
  storage_name: string;
}

const EVIDENCE_SELECT = `
  SELECT e.id, e.project_id, e.milestone_id, e.expenditure_claim_id, e.file_id, e.title, e.description,
         e.visibility, e.created_at, u.full_name AS uploader_name,
         f.original_name, f.mime_type, f.size_bytes, f.sha256, f.storage_name
    FROM evidence e
    JOIN stored_files f ON f.id = e.file_id
    LEFT JOIN users u ON u.id = e.uploaded_by
`;

export function mapEvidence(row: EvidenceRow, options: { includeUploaderName: boolean; redactFile?: boolean }): EvidenceView {
  return {
    id: row.id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    claimId: row.expenditure_claim_id,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    createdAt: new Date(row.created_at).toISOString(),
    uploaderName: options.includeUploaderName ? row.uploader_name : null,
    file: {
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      sha256: row.sha256,
    },
    downloadUrl: `/api/v1/evidence/${row.id}/download`,
  };
}

async function evidenceRowsForSubmission(submissionId: string): Promise<EvidenceRow[]> {
  const result = await query<EvidenceRow>(
    `${EVIDENCE_SELECT}
      JOIN milestone_submission_evidence se ON se.evidence_id = e.id
     WHERE se.submission_id = $1
     ORDER BY e.created_at ASC`,
    [submissionId],
  );
  return result.rows;
}

async function evidenceRowsForClaim(claimId: string): Promise<EvidenceRow[]> {
  const result = await query<EvidenceRow>(
    `${EVIDENCE_SELECT}
      JOIN expenditure_claim_evidence ce ON ce.evidence_id = e.id
     WHERE ce.claim_id = $1
     ORDER BY e.created_at ASC`,
    [claimId],
  );
  return result.rows;
}

export async function loadSubmissionEvidence(
  submissionId: string,
  options: { includeUploaderName: boolean; includeRestricted: boolean },
): Promise<EvidenceView[]> {
  const rows = await evidenceRowsForSubmission(submissionId);
  return rows
    .filter((row) => options.includeRestricted || row.visibility === 'PUBLIC')
    .map((row) => mapEvidence(row, { includeUploaderName: options.includeUploaderName }));
}

export async function loadClaimEvidence(
  claimId: string,
  options: { includeUploaderName: boolean; includeRestricted: boolean },
): Promise<EvidenceView[]> {
  const rows = await evidenceRowsForClaim(claimId);
  return rows
    .filter((row) => options.includeRestricted || row.visibility === 'PUBLIC')
    .map((row) => mapEvidence(row, { includeUploaderName: options.includeUploaderName }));
}

export async function listProjectEvidence(actor: SessionUser | null, projectId: string): Promise<EvidenceView[]> {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  const visibilityCondition = access.canSeeRestrictedData ? '' : `AND e.visibility = 'PUBLIC'`;
  const result = await query<EvidenceRow>(
    `${EVIDENCE_SELECT}
      WHERE e.project_id = $1 AND e.archived_at IS NULL ${visibilityCondition}
      ORDER BY e.created_at DESC`,
    [projectId],
  );
  return result.rows.map((row) =>
    mapEvidence(row, {
      includeUploaderName: access.canSeeRestrictedData,
    }),
  );
}

export async function getEvidenceForDownload(
  actor: SessionUser | null,
  evidenceId: string,
): Promise<{ row: EvidenceRow; absolutePath: string; sizeBytes: number }> {
  const result = await query<EvidenceRow>(`${EVIDENCE_SELECT} WHERE e.id = $1 AND e.archived_at IS NULL`, [evidenceId]);
  const row = result.rows[0];
  if (!row) throw notFound('Evidence not found');
  const access = await getProjectAccess(sessionActor(actor), row.project_id);
  if (row.visibility === 'RESTRICTED' && !access.canSeeRestrictedData) {
    throw notFound('Evidence not found');
  }
  if (!access.isPubliclyVisible && !access.canSeeRestrictedData) {
    throw notFound('Evidence not found');
  }
  const stored = await resolveStoredFile(row.storage_name);
  if (!stored) throw notFound('The stored file is no longer available');
  if (stored.sizeBytes !== Number(row.size_bytes)) {
    throw conflict('The stored file size does not match its recorded metadata; the file was withheld');
  }
  return { row, absolutePath: stored.absolutePath, sizeBytes: stored.sizeBytes };
}

export async function uploadEvidence(
  actor: SessionUser,
  projectId: string,
  input: EvidenceMetadataInput,
  file: { buffer: Buffer; originalname: string; size: number },
): Promise<EvidenceView> {
  const access = await getProjectAccess(sessionActor(actor), projectId);
  if (!access.canUploadEvidence) {
    throw forbidden(
      access.isOwner
        ? 'Evidence can only be uploaded while the project is active'
        : 'Only the project owner can upload evidence for this project',
    );
  }
  if (input.milestoneId && input.claimId) {
    throw badRequest('Evidence can belong to a milestone or an expenditure claim, not both');
  }
  if (input.milestoneId) {
    const milestone = await query('SELECT 1 FROM milestones WHERE id = $1 AND project_id = $2', [
      input.milestoneId,
      projectId,
    ]);
    if (milestone.rowCount === 0) throw badRequest('The selected milestone does not belong to this project');
  }
  if (input.claimId) {
    const claim = await query('SELECT 1 FROM expenditure_claims WHERE id = $1 AND project_id = $2', [input.claimId, projectId]);
    if (claim.rowCount === 0) throw badRequest('The selected expenditure claim does not belong to this project');
  }

  const upload: ValidatedUpload = await validateUpload(file);
  const stored = await writeStoredFile(upload);

  let evidenceId: string;
  try {
    evidenceId = await withTransaction(async (client) => {
      const fileRow = await client.query<{ id: string }>(
        `INSERT INTO stored_files (storage_name, original_name, mime_type, size_bytes, sha256, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [stored.storageName, upload.originalName, upload.mimeType, upload.sizeBytes, upload.sha256, actor.id],
      );
      const fileId = fileRow.rows[0]!.id;
      const evidence = await client.query<{ id: string }>(
        `INSERT INTO evidence (project_id, milestone_id, expenditure_claim_id, file_id, title, description, visibility, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          projectId,
          input.milestoneId ?? null,
          input.claimId ?? null,
          fileId,
          input.title,
          input.description ?? null,
          input.visibility,
          actor.id,
        ],
      );
      const evidenceId = evidence.rows[0]!.id;
      await appendAuditEvent(client, {
        projectId,
        actorId: actor.id,
        actorRole: actor.role,
        action: AUDIT_ACTIONS.EVIDENCE_UPLOADED,
        entityType: 'EVIDENCE',
        entityId: evidenceId,
        summary: `Evidence uploaded: ${input.title}`,
        metadata: {
          fileId,
          sha256: upload.sha256,
          sizeBytes: upload.sizeBytes,
          mimeType: upload.mimeType,
          visibility: input.visibility,
          originalName: upload.originalName,
        },
      });
      return evidenceId;
    });
  } catch (error) {
    await removeStoredFile(stored.storageName);
    throw error;
  }

  const rows = await query<EvidenceRow>(`${EVIDENCE_SELECT} WHERE e.id = $1`, [evidenceId]);
  const row = rows.rows[0];
  if (!row) throw notFound('Evidence upload could not be loaded');
  return mapEvidence(row, { includeUploaderName: true });
}

export async function countProjectEvidence(actor: SessionUser | null, projectId: string): Promise<{ total: number; publicCount: number }> {
  const params: unknown[] = [projectId];
  const scope = await projectScopeCondition(sessionActor(actor), params, 'p');
  const result = await query<{ total: string; public_count: string }>(
    `SELECT COUNT(*)::text AS total, COUNT(*) FILTER (WHERE e.visibility = 'PUBLIC')::text AS public_count
       FROM evidence e JOIN projects p ON p.id = e.project_id
      WHERE e.project_id = $1 AND e.archived_at IS NULL AND ${scope}`,
    params,
  );
  return { total: Number(result.rows[0]?.total ?? 0), publicCount: Number(result.rows[0]?.public_count ?? 0) };
}
