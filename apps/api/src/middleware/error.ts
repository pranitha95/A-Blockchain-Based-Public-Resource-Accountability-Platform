import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { getEnv } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

function translatePostgresError(error: PgError): AppError | null {
  switch (error.code) {
    case '23505':
      return new AppError(409, 'DUPLICATE_RECORD', 'That record already exists. Check the values and try again.');
    case '23503':
      return new AppError(409, 'REFERENCE_CONFLICT', 'This action conflicts with a related record.');
    case '23514':
      return new AppError(400, 'CONSTRAINT_VIOLATION', 'The submitted values do not satisfy a data integrity rule.');
    case '22P02':
      return new AppError(400, 'INVALID_VALUE', 'A supplied identifier or value has an invalid format.');
    case '40001':
    case '40P01':
      return new AppError(409, 'CONCURRENT_UPDATE', 'Another update happened at the same time. Reload and try again.');
    case '57014':
      return new AppError(504, 'DATABASE_TIMEOUT', 'The database operation took too long. Try again.');
    default:
      return null;
  }
}

export const apiNotFound: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No API route matches ${req.method} ${req.originalUrl}`,
      requestId: req.requestId,
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (res.headersSent) return;

  let appError: AppError;
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError(400, 'VALIDATION_FAILED', 'Some fields need attention', error.issues);
  } else if (error instanceof multer.MulterError) {
    appError =
      error.code === 'LIMIT_FILE_SIZE'
        ? new AppError(413, 'FILE_TOO_LARGE', `The file exceeds the ${Math.round(getEnv().MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`)
        : new AppError(400, 'UPLOAD_ERROR', 'The upload could not be processed');
  } else if (error instanceof SyntaxError && 'body' in error) {
    appError = new AppError(400, 'INVALID_JSON', 'The request body is not valid JSON');
  } else {
    const translated = translatePostgresError(error as PgError);
    if (translated) {
      appError = translated;
    } else {
      appError = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
      logger.error({ err: error, requestId: req.requestId }, 'Unhandled request error');
    }
  }

  if (appError.statusCode >= 500) {
    logger.error({ err: error, requestId: req.requestId, code: appError.code }, 'Request failed');
  } else if (appError.statusCode !== 401 && appError.statusCode !== 403 && appError.statusCode !== 404) {
    logger.warn(
      { requestId: req.requestId, code: appError.code, status: appError.statusCode },
      appError.message,
    );
  }

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && appError.statusCode < 500 ? { details: appError.details } : {}),
      requestId: req.requestId,
    },
  });
};
