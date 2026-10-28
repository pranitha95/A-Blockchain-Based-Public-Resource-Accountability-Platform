const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api/v1';

export interface ApiMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  unreadCount?: number;
  [key: string]: unknown;
}

interface Envelope<T> {
  data: T;
  meta?: ApiMeta;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface ValidationIssue {
  field?: string;
  message?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { status: number; code?: string; details?: unknown; requestId?: string },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code ?? 'UNKNOWN_ERROR';
    this.details = options.details;
    this.requestId = options.requestId;
  }

  get validationIssues(): ValidationIssue[] {
    if (!Array.isArray(this.details)) return [];
    return this.details
      .filter((issue): issue is Record<string, unknown> => Boolean(issue && typeof issue === 'object'))
      .map((issue) => ({
        field: typeof issue.field === 'string' ? issue.field : undefined,
        message: typeof issue.message === 'string' ? issue.message : undefined,
      }));
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) return decodeURIComponent(cookie.slice(prefix.length));
  }
  return null;
}

export function buildQuery(values: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  formData?: FormData;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };

  if (method !== 'GET') {
    const csrf = readCookie('poi_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'The API could not be reached. Check that the server is running, then try again.',
      { status: 0, code: 'NETWORK_ERROR' },
    );
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  let payload: unknown = null;
  if (isJson) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorPayload = (payload ?? {}) as ErrorEnvelope;
    throw new ApiError(
      errorPayload.error?.message || `The request failed with status ${response.status}.`,
      {
        status: response.status,
        code: errorPayload.error?.code,
        details: errorPayload.error?.details,
        requestId: errorPayload.error?.requestId,
      },
    );
  }

  if (!isJson) {
    throw new ApiError('The server returned an unexpected response format.', {
      status: response.status,
      code: 'INVALID_RESPONSE',
    });
  }

  return payload as Envelope<T>;
}

export interface Paginated<T> {
  data: T[];
  meta: ApiMeta;
}

export const api = {
  base: API_BASE,

  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return (await request<T>(path, { signal })).data;
  },

  async getPage<T>(
    path: string,
    values: Record<string, string | number | boolean | null | undefined> = {},
  ): Promise<Paginated<T>> {
    const envelope = await request<T[]>(`${path}${buildQuery(values)}`);
    return { data: envelope.data, meta: envelope.meta ?? {} };
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>(path, { method: 'POST', body })).data;
  },

  async postForm<T>(path: string, formData: FormData): Promise<T> {
    return (await request<T>(path, { method: 'POST', formData })).data;
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>(path, { method: 'PATCH', body })).data;
  },

  async delete<T>(path: string, body?: unknown): Promise<T> {
    return (await request<T>(path, { method: 'DELETE', body })).data;
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return error.message;
    if (error.status === 401) return 'Your session has ended. Sign in again to continue.';
    if (error.status === 403 && error.code === 'CSRF_INVALID') {
      return 'Your security token has expired. Refresh the page and try again.';
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
