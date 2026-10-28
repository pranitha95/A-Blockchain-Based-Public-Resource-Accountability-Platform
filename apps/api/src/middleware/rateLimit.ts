import { rateLimit } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { getEnv } from '../config/env.js';

const disabled = () => !getEnv().RATE_LIMIT_ENABLED;

function jsonLimiterHandler(message: string) {
  return (req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message,
        requestId: req.requestId,
      },
    });
  };
}

export const generalApiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: disabled,
  handler: jsonLimiterHandler('Too many requests. Please wait a moment and try again.'),
});

export const authenticationLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: disabled,
  handler: jsonLimiterHandler('Too many authentication attempts. Wait 15 minutes or restart the API in development.'),
});

export const uploadLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: disabled,
  handler: jsonLimiterHandler('Too many uploads. Please wait before trying again.'),
});
