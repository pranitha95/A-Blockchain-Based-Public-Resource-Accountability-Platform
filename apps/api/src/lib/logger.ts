import pino from 'pino';
import { getEnv } from '../config/env.js';

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  base: { service: 'proof-of-impact-api' },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'privateKey',
    ],
    censor: '[redacted]',
  },
});
