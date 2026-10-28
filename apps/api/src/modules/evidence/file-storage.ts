import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { getEnv } from '../../config/env.js';
import { findRepoRoot } from '../../db/repo-root.js';
import { badRequest } from '../../lib/errors.js';

export const ALLOWED_EVIDENCE_TYPES = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);

export interface ValidatedUpload {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
}

export function storageRoot(): string {
  const configured = getEnv().FILE_STORAGE_DIR;
  if (path.isAbsolute(configured)) return configured;
  return path.resolve(findRepoRoot(), configured.replace(/^\.\//, ''));
}

export function sanitizeOriginalName(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const cleaned = base.replace(/[^\w .\-()[\]]/g, '_');
  return cleaned.slice(0, 180) || 'evidence-file';
}

export async function validateUpload(file: { buffer: Buffer; originalname: string; size: number }): Promise<ValidatedUpload> {
  if (!file.buffer || file.size === 0) throw badRequest('The uploaded file is empty');
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected) {
    throw badRequest('The file type could not be determined. Upload a PDF, PNG, JPEG or WebP file.');
  }
  const extension = ALLOWED_EVIDENCE_TYPES.get(detected.mime);
  if (!extension) {
    throw badRequest(`Files of type ${detected.mime} are not accepted. Upload a PDF, PNG, JPEG or WebP file.`);
  }
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  return {
    buffer: file.buffer,
    originalName: sanitizeOriginalName(file.originalname),
    mimeType: detected.mime,
    extension,
    sizeBytes: file.size,
    sha256,
  };
}

export interface StoredBytes {
  storageName: string;
  absolutePath: string;
}

export async function writeStoredFile(upload: ValidatedUpload): Promise<StoredBytes> {
  const now = new Date();
  const shard = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const directory = path.join(storageRoot(), shard);
  await fs.mkdir(directory, { recursive: true });
  const storageName = `${shard}/${randomUUID()}.${upload.extension}`;
  const absolutePath = path.join(storageRoot(), storageName);
  await fs.writeFile(absolutePath, upload.buffer, { flag: 'wx', mode: 0o600 });
  return { storageName, absolutePath };
}

export async function removeStoredFile(storageName: string): Promise<void> {
  const absolutePath = path.join(storageRoot(), storageName);
  try {
    await fs.unlink(absolutePath);
  } catch {
    // Cleanup is best effort; a failed upload must not mask the original error.
  }
}

export async function resolveStoredFile(storageName: string): Promise<{ absolutePath: string; sizeBytes: number } | null> {
  if (storageName.includes('..') || path.isAbsolute(storageName)) return null;
  const absolutePath = path.join(storageRoot(), storageName);
  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) return null;
    return { absolutePath, sizeBytes: stats.size };
  } catch {
    return null;
  }
}
