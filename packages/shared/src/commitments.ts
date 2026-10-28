import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from 'ethers';
import type { AnchorRecordType } from './domain.js';

/**
 * Versioned commitment scheme shared by the API, the web client and the contract.
 *
 * contentDigest = keccak256(utf8(canonicalJson(payload)))
 * commitment    = keccak256(abi.encode(
 *                   DOMAIN, chainId, registry, projectIdHash, recordType, recordIdHash,
 *                   recordVersion, contentDigest))
 *
 * projectIdHash / recordIdHash = keccak256(utf8(identifier)), where identifier is the
 * canonical UUID string used by the application database.
 */
export const COMMITMENT_DOMAIN_LABEL = 'PROOF_OF_IMPACT_RECORD_V1';
export const COMMITMENT_SCHEMA_VERSION = 1;
export const COMMITMENT_DOMAIN: string = keccak256(toUtf8Bytes(COMMITMENT_DOMAIN_LABEL));

export const RECORD_TYPE_CODE: Record<AnchorRecordType, number> = {
  PROJECT: 0,
  MILESTONE_SUBMISSION: 1,
  REVIEW: 2,
  EXPENDITURE_CLAIM: 3,
  AUDIT_BATCH: 4,
};

export const RECORD_TYPE_LABEL: Record<AnchorRecordType, string> = {
  PROJECT: 'Project record',
  MILESTONE_SUBMISSION: 'Milestone submission',
  REVIEW: 'Review decision',
  EXPENDITURE_CLAIM: 'Expenditure claim',
  AUDIT_BATCH: 'Audit history batch',
};

export function recordTypeFromCode(code: number): AnchorRecordType | null {
  const entry = Object.entries(RECORD_TYPE_CODE).find(([, value]) => value === code);
  return entry ? (entry[0] as AnchorRecordType) : null;
}

function normalizeForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForCanonicalJson);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        ordered[key] = normalizeForCanonicalJson(entry);
      }
    }
    return ordered;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Canonical JSON cannot encode a non-finite number');
  }
  return value;
}

/** Deterministic JSON: object keys are sorted recursively and undefined values are omitted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeForCanonicalJson(value));
}

export function idToBytes32(identifier: string): string {
  if (!identifier || identifier.trim().length === 0) {
    throw new Error('Cannot hash an empty identifier');
  }
  return keccak256(toUtf8Bytes(identifier));
}

export function computeContentDigest(payload: Record<string, unknown>): string {
  return keccak256(toUtf8Bytes(canonicalJson(payload)));
}

export interface CommitmentInput {
  chainId: number;
  registryAddress: string;
  projectId: string;
  recordType: AnchorRecordType;
  recordId: string;
  recordVersion: number;
  contentDigest: string;
}

export function computeCommitment(input: CommitmentInput): string {
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) {
    throw new Error('A valid chain id is required to compute a commitment');
  }
  if (!Number.isInteger(input.recordVersion) || input.recordVersion <= 0) {
    throw new Error('A positive record version is required to compute a commitment');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.contentDigest)) {
    throw new Error('The content digest must be a 32-byte hex string');
  }
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'uint256', 'address', 'bytes32', 'uint8', 'bytes32', 'uint64', 'bytes32'],
    [
      COMMITMENT_DOMAIN,
      input.chainId,
      getAddress(input.registryAddress),
      idToBytes32(input.projectId),
      RECORD_TYPE_CODE[input.recordType],
      idToBytes32(input.recordId),
      input.recordVersion,
      input.contentDigest,
    ],
  );
  return keccak256(encoded);
}

export interface RecordKeyInput {
  projectId: string;
  recordType: AnchorRecordType;
  recordId: string;
  recordVersion: number;
}

export function computeRecordKey(input: RecordKeyInput): string {
  if (!Number.isInteger(input.recordVersion) || input.recordVersion <= 0) {
    throw new Error('A positive record version is required to compute a record key');
  }
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint8', 'bytes32', 'uint64'],
      [
        idToBytes32(input.projectId),
        RECORD_TYPE_CODE[input.recordType],
        idToBytes32(input.recordId),
        input.recordVersion,
      ],
    ),
  );
}

export const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

export function isBytes32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
