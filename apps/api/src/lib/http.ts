import type { Response } from 'express';
import type { ApiMeta, PaginatedResult } from '@poi/shared';

export function sendData<T>(res: Response, data: T, meta?: ApiMeta, statusCode = 200): void {
  res.status(statusCode).json(meta ? { data, meta } : { data });
}

export function sendPaginated<T>(res: Response, result: PaginatedResult<T>, extraMeta: ApiMeta = {}): void {
  res.status(200).json({
    data: result.items,
    meta: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      ...extraMeta,
    },
  });
}

export interface PaginationInput {
  page: number;
  pageSize: number;
  offset: number;
}

export function paginationFromQuery(query: Record<string, unknown>, defaultPageSize = 12): PaginationInput {
  const rawPage = Number(query.page ?? 1);
  const rawPageSize = Number(query.pageSize ?? defaultPageSize);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(Math.floor(rawPageSize), 100) : defaultPageSize;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function orderedQueryValue(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return undefined;
}

export function orderedQueryList(query: Record<string, unknown>, key: string): string[] {
  const value = query[key];
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function totalPages(total: number, pageSize: number): number {
  return total === 0 ? 0 : Math.ceil(total / pageSize);
}
