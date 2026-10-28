import { evidenceMetadataSchema } from '@poi/shared';
import { Router } from 'express';
import multer from 'multer';
import { getEnv } from '../../config/env.js';
import { badRequest } from '../../lib/errors.js';
import { sendData } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { validateBody } from '../../middleware/validate.js';
import { getEvidenceForDownload, uploadEvidence } from './evidence.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getEnv().MAX_UPLOAD_BYTES, files: 1, fields: 12 },
});

export const projectEvidenceRouter = Router({ mergeParams: true });

projectEvidenceRouter.post(
  '/',
  requireAuth,
  uploadLimiter,
  upload.single('file'),
  validateBody(evidenceMetadataSchema),
  async (req, res) => {
    if (!req.file) throw badRequest('Attach a PDF, PNG, JPEG or WebP file');
    const evidence = await uploadEvidence(
      req.auth!.user,
      String(req.params.projectId),
      req.body,
      { buffer: req.file.buffer, originalname: req.file.originalname, size: req.file.size },
    );
    sendData(res, evidence, undefined, 201);
  },
);

export const evidenceRouter = Router();

evidenceRouter.get('/:evidenceId/download', async (req, res) => {
  const { row, absolutePath } = await getEvidenceForDownload(
    req.auth?.user ?? null,
    String(req.params.evidenceId),
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', row.mime_type);
  res.download(absolutePath, row.original_name, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'The stored file could not be sent', requestId: req.requestId },
      });
    }
  });
});
