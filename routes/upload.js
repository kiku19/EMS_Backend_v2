import express from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { v2 as cloudinary } from 'cloudinary';
import { authenticate } from '../middleware/auth.js';
import { createLogger } from '../utils/logger.js';
import { incrementUsageMetric } from '../services/billingService.js';
import { planLimitGate } from '../middleware/auth/planLimitGate.js';

const router = express.Router();
router.use(authenticate);
const logger = createLogger('Upload');

// Strict MIME type whitelist — only allow known safe document/image/audio/video types.
// image/svg+xml is intentionally excluded: SVG can contain <script> tags and execute
// JavaScript in the browser, making it functionally equivalent to an HTML file.
const ALLOWED_MIME_TYPES = new Set([
  // Images (raster only — no SVG)
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
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

// Magic byte signatures to verify actual file content matches declared MIME type.
// This prevents MIME spoofing (e.g., uploading an HTML file with Content-Type: image/jpeg).
const MAGIC_BYTES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, extra: { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 } },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

// Patterns in the first 512 bytes that indicate executable/HTML content regardless of MIME type.
const DANGEROUS_PATTERNS = [
  /^\s*<!DOCTYPE\s+html/i,
  /^\s*<html[\s>]/i,
  /^\s*<script[\s>]/i,
  /^\s*<\?xml.*<\s*script/i, // SVG-with-script disguised as XML
  /^\s*<svg[\s>]/i,
];

/**
 * Validates the actual file buffer against its declared MIME type.
 * Returns an error string if the content looks dangerous or mismatched, null otherwise.
 */
function validateFileContent(buffer, mimetype) {
  const head = buffer.slice(0, 512);
  // latin1 is byte-accurate for regex matching against ASCII patterns
  const headStr = head.toString('latin1');

  // Block any file whose content looks like HTML/SVG/script regardless of stated MIME type
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(headStr)) {
      return `File content appears to be HTML or script, which is not allowed`;
    }
  }

  // For MIME types with known magic bytes, verify the actual bytes match
  const sig = MAGIC_BYTES.find((s) => s.mime === mimetype);
  if (sig) {
    const matches = sig.bytes.every((b, i) => buffer[i] === b);
    if (!matches) {
      return `File content does not match declared type '${mimetype}'`;
    }
    if (sig.extra) {
      const extraMatches = sig.extra.bytes.every((b, i) => buffer[sig.extra.offset + i] === b);
      if (!extraMatches) {
        return `File content does not match declared type '${mimetype}'`;
      }
    }
  }

  // text/plain and text/csv: block if content contains HTML tags
  if (mimetype === 'text/plain' || mimetype === 'text/csv') {
    if (/<[a-z][\s\S]*>/i.test(headStr)) {
      return `File content contains HTML markup, which is not allowed in text files`;
    }
  }

  return null;
}

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
  message: (req) =>
    req.t
      ? req.t('common:routes.tooManyFileUploadsPleaseTryAgainLater')
      : 'Too many file uploads. Please try again later.',
});

router.post(
  '/',
  uploadLimiter,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'File too large. Maximum allowed size is 10 MB.' });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) return next(err);
      next();
    });
  },
  planLimitGate('storageMb', (req) => (req.file ? req.file.size / (1024 * 1024) : 0)),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: req.t('common:routes.noFileUploaded') });
      }

      // Validate actual file content against declared MIME type to prevent spoofing
      const contentError = validateFileContent(req.file.buffer, req.file.mimetype);
      if (contentError) {
        return res.status(400).json({ error: contentError });
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
        return res
          .status(503)
          .json({ error: req.t('common:routes.fileStorageIsNotConfiguredContactSupport') });
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
      res.status(500).json({ error: req.t('common:routes.uploadFailed') });
    }
  }
);

export default router;
