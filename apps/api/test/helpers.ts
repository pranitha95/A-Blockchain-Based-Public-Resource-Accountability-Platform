import { hash } from '@node-rs/argon2';
import type { UserRole } from '@poi/shared';
import type { Express } from 'express';
import request from 'supertest';
import { query } from '../src/db/pool.js';

export const TEST_PASSWORD = 'Integration-test-2026';
export const CHANGED_TEST_PASSWORD = 'Integration-test-2026-changed';

const ARGON_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export interface SeededUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export async function seedUser(input: {
  email: string;
  fullName: string;
  role: UserRole;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  password?: string;
}): Promise<SeededUser> {
  const passwordHash = await hash(input.password ?? TEST_PASSWORD, ARGON_OPTIONS);
  const result = await query<{ id: string }>(
    `INSERT INTO users (email, full_name, password_hash, role, status, is_demo)
     VALUES ($1,$2,$3,$4,$5,false)
     RETURNING id`,
    [input.email, input.fullName, passwordHash, input.role, input.status ?? 'ACTIVE'],
  );
  return {
    id: result.rows[0]!.id,
    email: input.email,
    fullName: input.fullName,
    role: input.role,
  };
}

interface RequestOptions {
  csrf?: boolean;
  origin?: string;
}

function readCookie(response: request.Response, name: string): string | null {
  const raw = response.headers['set-cookie'] as unknown;
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const prefix = `${name}=`;
  const match = values.find((value) => value.startsWith(prefix));
  if (!match) return null;
  return decodeURIComponent(match.slice(prefix.length).split(';')[0] ?? '');
}

export class ApiClient {
  readonly agent: ReturnType<typeof request.agent>;
  csrfToken = '';

  constructor(app: Express) {
    this.agent = request.agent(app);
  }

  private captureCsrf(response: request.Response): void {
    const token = readCookie(response, 'poi_csrf');
    if (token) this.csrfToken = token;
  }

  async login(email: string, password = TEST_PASSWORD): Promise<request.Response> {
    const response = await this.agent.post('/api/v1/auth/login').send({ email, password });
    this.captureCsrf(response);
    return response;
  }

  async register(input: Record<string, unknown>): Promise<request.Response> {
    const response = await this.agent.post('/api/v1/auth/register').send(input);
    this.captureCsrf(response);
    return response;
  }

  get(url: string): request.Test {
    return this.agent.get(url);
  }

  post(url: string, body?: object, options: RequestOptions = {}): request.Test {
    let pending = this.agent.post(url);
    if (options.origin) pending = pending.set('Origin', options.origin);
    if (options.csrf !== false && this.csrfToken) pending = pending.set('X-CSRF-Token', this.csrfToken);
    return body === undefined ? pending : pending.send(body);
  }

  patch(url: string, body: object, options: RequestOptions = {}): request.Test {
    let pending = this.agent.patch(url);
    if (options.origin) pending = pending.set('Origin', options.origin);
    if (options.csrf !== false && this.csrfToken) pending = pending.set('X-CSRF-Token', this.csrfToken);
    return pending.send(body);
  }

  delete(url: string, options: RequestOptions = {}): request.Test {
    let pending = this.agent.delete(url);
    if (options.origin) pending = pending.set('Origin', options.origin);
    if (options.csrf !== false && this.csrfToken) pending = pending.set('X-CSRF-Token', this.csrfToken);
    return pending;
  }

  upload(
    url: string,
    fields: Record<string, string>,
    file: { buffer: Buffer; filename: string; contentType: string },
  ): request.Test {
    let pending = this.agent.post(url).set('X-CSRF-Token', this.csrfToken);
    for (const [key, value] of Object.entries(fields)) {
      pending = pending.field(key, value);
    }
    return pending.attach('file', file.buffer, { filename: file.filename, contentType: file.contentType });
  }
}

export const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
