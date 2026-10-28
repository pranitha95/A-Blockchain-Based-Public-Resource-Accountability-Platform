import type { RequestHandler } from 'express';
import { allowedWebOrigins } from '../config/env.js';
import { sha256Hex, safeCompareHexOrToken } from '../lib/crypto.js';
import { AppError, forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (origin) {
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const allowed = new Set([...allowedWebOrigins(), requestOrigin]);
    if (!allowed.has(origin)) {
      next(new AppError(403, 'ORIGIN_REJECTED', 'The request origin is not permitted'));
      return;
    }
  }

  if (!req.auth) {
    // Login and registration are protected by rate limits and the origin check.
    next();
    return;
  }

  const header = req.get('x-csrf-token');
  if (!header) {
    next(forbidden('A CSRF token is required for this action'));
    return;
  }
  const matches = safeCompareHexOrToken(sha256Hex(header), req.auth.csrfTokenHash);
  if (!matches) {
    next(new AppError(403, 'CSRF_INVALID', 'Your security token is invalid or expired. Refresh the page and try again.'));
    return;
  }
  next();
};
