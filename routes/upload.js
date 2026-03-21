import express from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { v2 as cloudinary } from 'cloudinary';
import { authenticate } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import { incrementUsageMetric } from '../services/billingService.js';
import { planLimitGate } from '../middleware/auth/planLimitGate.js';

const router = express.Router();
const logger = createLogger('Upload');

// Strict MIME type whitelist — only allow known safe document/image/audio/video types
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  // Audio
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  // Video
  'video/mp4',
  'video/webm',
  'video/ogg',
]);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type '${file.mimetype}' is not allowed`));
    }
  },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: 'Too many file uploads, please try again later.',
});

router.post(
  '/',
  authenticate,
  uploadLimiter,
  upload.single('file'),
  planLimitGate('storageMb', (req) => (req.file ? req.file.size / (1024 * 1024) : 0)),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Determine Cloudinary resource type from MIME
      let resourceType = 'raw';
      if (req.file.mimetype.startsWith('image/')) {
        resourceType = 'image';
      } else if (req.file.mimetype.startsWith('video/')) {
        resourceType = 'video';
      } else if (req.file.mimetype.startsWith('audio/')) {
        resourceType = 'video'; // Cloudinary stores audio under the video resource type
      }

      // Require Cloudinary — no base64 fallback
      const isCloudinaryConfigured = !!(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
      );

      if (!isCloudinaryConfigured) {
        return res.status(503).json({ error: 'File storage is not configured. Contact support.' });
      }

      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;

      const uploadOptions = {
        resource_type: resourceType,
        folder: 'school_documents',
        public_id: `doc_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9]/g, '_')}`,
        timeout: 60000,
        type: 'upload',
        access_mode: 'public',
      };

      // Retry Cloudinary upload up to 2 times on transient failures
      const MAX_RETRIES = 2;
      let result;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          result = await cloudinary.uploader.upload(dataURI, uploadOptions);
          break;
        } catch (uploadErr) {
          const isLastAttempt = attempt === MAX_RETRIES;
          const isRetryable =
            uploadErr.http_code >= 500 ||
            uploadErr.error?.http_code >= 500 ||
            ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(uploadErr.code);

          if (isLastAttempt || !isRetryable) {
            throw uploadErr;
          }
          const delay = 1000 * Math.pow(2, attempt); // 1s, 2s
          logger.warn({ attempt: attempt + 1, delay }, 'Cloudinary upload failed, retrying');
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      // Track storage usage after successful upload (fire-and-forget)
      if (req.user?.schoolId) {
        const uploadedMb = result.bytes / (1024 * 1024);
        incrementUsageMetric(req.user.schoolId, 'storageMb', uploadedMb).catch(() => {});
      }

      res.json({
        url: result.secure_url,
        public_id: result.public_id,
        name: req.file.originalname,
        size: `${(result.bytes / 1024).toFixed(1)} KB`,
        format: result.format,
        resource_type: result.resource_type,
      });
    } catch (error) {
      // Multer fileFilter error
      if (error.message && error.message.includes('not allowed')) {
        return res.status(400).json({ error: error.message });
      }
      logger.error({ err: error }, 'Upload error');
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

export default router;
