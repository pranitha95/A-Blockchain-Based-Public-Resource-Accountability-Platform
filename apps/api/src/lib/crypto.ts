import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '@poi/shared';

export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeCompareHexOrToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hashAuditEvent(prevHash: string | null, body: Record<string, unknown>): string {
  return sha256Hex(`${prevHash ?? '0'.repeat(64)}:${canonicalJson(body)}`);
}
