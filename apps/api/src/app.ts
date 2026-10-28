import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage } from 'node:http';
import { getAbsoluteFSPath } from 'swagger-ui-dist';
import { allowedWebOrigins, getEnv } from './config/env.js';
import { findRepoRoot } from './db/repo-root.js';
import { openApiDocument } from './docs/openapi.js';
import { AppError } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { loadSession } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { apiNotFound, errorHandler } from './middleware/error.js';
import { generalApiLimiter } from './middleware/rateLimit.js';
import { attachRequestId } from './middleware/requestId.js';
import { anchorsRouter, verificationRouter } from './modules/blockchain/blockchain.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { claimsRouter } from './modules/claims/claims.routes.js';
import { evidenceRouter, projectEvidenceRouter } from './modules/evidence/evidence.routes.js';
import { healthRouter, metaRouter } from './modules/meta/meta.routes.js';
import { milestonesRouter } from './modules/milestones/milestones.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { organizationsRouter } from './modules/organizations/organizations.routes.js';
import { projectClaimsRouter } from './modules/claims/claims.routes.js';
import { projectsRouter } from './modules/projects/projects.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { reviewsRouter } from './modules/reviews/reviews.routes.js';
import { adminSettingsRouter, settingsRouter } from './modules/settings/settings.routes.js';
import { statsRouter } from './modules/stats/stats.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

const SWAGGER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Proof of Impact API</title>
    <link rel="stylesheet" href="/api/docs/assets/swagger-ui.css" />
    <style>body{margin:0;background:#f7f9fc}.swagger-ui .topbar{display:none}</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/api/docs/assets/swagger-ui-bundle.js"></script>
    <script>
      window.UI = SwaggerUIBundle({
        url: '/api/v1/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        displayRequestDuration: true,
        withCredentials: true,
        tryItOutEnabled: true,
      });
    </script>
  </body>
</html>`;

function buildCorsOptions(): CorsOptions {
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedWebOrigins().includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new AppError(403, 'ORIGIN_REJECTED', 'The request origin is not permitted'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  };
}

export function createApp(): express.Express {
  const env = getEnv();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);

  app.use(attachRequestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req: IncomingMessage) =>
        (req as IncomingMessage & { requestId?: string }).requestId ?? 'unassigned',
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        ignore: (req) => req.url === '/api/health' || req.url === '/api/v1/health',
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", ...allowedWebOrigins()],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', generalApiLimiter);
  app.use('/api', loadSession, csrfProtection);

  app.get('/api/health', (req, res) => res.redirect(307, '/api/v1/health'));

  const api = express.Router();
  api.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  api.use('/health', healthRouter);
  api.use('/meta', metaRouter);
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/organizations', organizationsRouter);
  api.use('/categories', categoriesRouter);
  api.use('/projects/:projectId/claims', projectClaimsRouter);
  api.use('/projects/:projectId/evidence', projectEvidenceRouter);
  api.use('/projects', projectsRouter);
  api.use('/milestones', milestonesRouter);
  api.use('/claims', claimsRouter);
  api.use('/evidence', evidenceRouter);
  api.use('/reviews', reviewsRouter);
  api.use('/anchors', anchorsRouter);
  api.use('/verify', verificationRouter);
  api.use('/stats', statsRouter);
  api.use('/reports', reportsRouter);
  api.use('/settings', settingsRouter);
  api.use('/admin/settings', adminSettingsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/audit', auditRouter);

  app.use('/api/v1', api);

  const swaggerAssets = getAbsoluteFSPath();
  app.use('/api/docs/assets', express.static(swaggerAssets, { index: false, maxAge: '1h' }));
  app.get('/api/docs', (_req, res) => {
    res.type('html').send(SWAGGER_HTML);
  });

  app.use('/api', apiNotFound);

  if (env.SERVE_WEB) {
    const distPath = env.WEB_DIST_PATH
      ? path.resolve(env.WEB_DIST_PATH)
      : path.join(findRepoRoot(), 'apps', 'web', 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath, { index: false, maxAge: '1h' }));
      app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) {
          next();
          return;
        }
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      logger.warn({ distPath }, 'SERVE_WEB is enabled but the web build directory does not exist');
    }
  }

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found',
        requestId: req.requestId,
      },
    });
  });

  app.use(errorHandler);
  return app;
}
