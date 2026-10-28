import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export const attachRequestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};
