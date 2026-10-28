import { keccak256, toUtf8Bytes } from 'ethers';
import { describe, expect, test } from 'vitest';
import {
  COMMITMENT_DOMAIN,
  COMMITMENT_DOMAIN_LABEL,
  RECORD_TYPE_CODE,
  ZERO_BYTES32,
  canonicalJson,
  computeCommitment,
  computeContentDigest,
  computeRecordKey,
  isBytes32,
  recordTypeFromCode,
} from '../src/index.js';

const REGISTRY = '0x1234567890AbcdEF1234567890aBcdef12345678';
const PROJECT_ID = '5b0f7f52-9a3d-4d3e-8f31-2f6a4f2f9d10';
const RECORD_ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const CONTENT_DIGEST = `0x${'ab'.repeat(32)}`;

function baseCommitment(overrides: Partial<Parameters<typeof computeCommitment>[0]> = {}) {
  return computeCommitment({
    chainId: 11155111,
    registryAddress: REGISTRY,
    projectId: PROJECT_ID,
    recordType: 'PROJECT',
    recordId: RECORD_ID,
    recordVersion: 1,
    contentDigest: CONTENT_DIGEST,
    ...overrides,
  });
}

describe('canonical JSON', () => {
  test('sorts object keys recursively and omits undefined values', () => {
    const value = {
      zeta: 1,
      alpha: { second: [3, 2, 1], first: 'value', skipped: undefined },
      escaped: 'quote " and newline \n',
    };
    expect(canonicalJson(value)).toBe(
      '{"alpha":{"first":"value","second":[3,2,1]},"escaped":"quote \\" and newline \\n","zeta":1}',
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson(null)).toBe('null');
  });

  test('rejects values that cannot be represented deterministically', () => {
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow(/non-finite/i);
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/i);
  });
});

describe('content digests', () => {
  test('are deterministic and independent of object key insertion order', () => {
    const left = computeContentDigest({ title: 'Borehole', amount: '100.00', meta: { b: 1, a: 2 } });
    const right = computeContentDigest({ meta: { a: 2, b: 1 }, amount: '100.00', title: 'Borehole' });
    expect(left).toBe(right);
    expect(left).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test('change when the committed payload changes', () => {
    expect(computeContentDigest({ amount: '100.00' })).not.toBe(computeContentDigest({ amount: '100.01' }));
  });
});

describe('versioned commitments', () => {
  test('use a domain separator derived from the published label', () => {
    expect(COMMITMENT_DOMAIN).toBe(keccak256(toUtf8Bytes(COMMITMENT_DOMAIN_LABEL)));
    expect(COMMITMENT_DOMAIN_LABEL).toBe('PROOF_OF_IMPACT_RECORD_V1');
  });

  test('are deterministic 32-byte values and normalize registry address casing', () => {
    const commitment = baseCommitment();
    expect(commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(baseCommitment()).toBe(commitment);
    expect(baseCommitment({ registryAddress: REGISTRY.toLowerCase() })).toBe(commitment);
  });

  test('bind chain, registry, project, record type, record id, version and digest', () => {
    const commitment = baseCommitment();
    expect(baseCommitment({ chainId: 1 })).not.toBe(commitment);
    expect(baseCommitment({ registryAddress: '0x0000000000000000000000000000000000000001' })).not.toBe(commitment);
    expect(baseCommitment({ projectId: RECORD_ID })).not.toBe(commitment);
    expect(baseCommitment({ recordType: 'REVIEW' })).not.toBe(commitment);
    expect(baseCommitment({ recordId: PROJECT_ID })).not.toBe(commitment);
    expect(baseCommitment({ recordVersion: 2 })).not.toBe(commitment);
    expect(baseCommitment({ contentDigest: `0x${'cd'.repeat(32)}` })).not.toBe(commitment);
  });

  test('reject malformed inputs instead of producing a misleading commitment', () => {
    expect(() => baseCommitment({ chainId: 0 })).toThrow(/chain id/i);
    expect(() => baseCommitment({ chainId: 1.5 })).toThrow(/chain id/i);
    expect(() => baseCommitment({ recordVersion: 0 })).toThrow(/record version/i);
    expect(() => baseCommitment({ contentDigest: '0x1234' })).toThrow(/content digest/i);
    expect(() => baseCommitment({ registryAddress: 'not-an-address' })).toThrow();
  });
});

describe('record keys', () => {
  test('are deterministic and version-specific', () => {
    const key = computeRecordKey({
      projectId: PROJECT_ID,
      recordType: 'EXPENDITURE_CLAIM',
      recordId: RECORD_ID,
      recordVersion: 3,
    });
    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      computeRecordKey({ projectId: PROJECT_ID, recordType: 'EXPENDITURE_CLAIM', recordId: RECORD_ID, recordVersion: 3 }),
    ).toBe(key);
    expect(
      computeRecordKey({ projectId: PROJECT_ID, recordType: 'EXPENDITURE_CLAIM', recordId: RECORD_ID, recordVersion: 4 }),
    ).not.toBe(key);
    expect(
      computeRecordKey({ projectId: PROJECT_ID, recordType: 'REVIEW', recordId: RECORD_ID, recordVersion: 3 }),
    ).not.toBe(key);
    expect(() =>
      computeRecordKey({ projectId: PROJECT_ID, recordType: 'PROJECT', recordId: RECORD_ID, recordVersion: 0 }),
    ).toThrow(/record version/i);
  });

  test('record type codes round-trip and unknown codes are rejected', () => {
    for (const [type, code] of Object.entries(RECORD_TYPE_CODE)) {
      expect(recordTypeFromCode(code)).toBe(type);
    }
    expect(recordTypeFromCode(99)).toBeNull();
    expect(isBytes32(ZERO_BYTES32)).toBe(true);
    expect(isBytes32('0x1234')).toBe(false);
  });
});
