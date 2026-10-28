import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { badRequest } from '../lib/errors.js';

export interface ValidationIssue {
  field: string;
  message: string;
}

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): ValidationIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.') || 'request',
    message: issue.message,
  }));
}

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(badRequest('Some fields need attention', formatIssues(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(badRequest('Invalid query parameters', formatIssues(result.error)));
      return;
    }
    Object.assign(req.query, result.data);
    next();
  };
}

export { formatIssues };
