import express from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { v2 as cloudinary } from 'cloudinary';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: 'Too many file uploads, please try again later.',
});

router.post('/', authenticate, uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }

    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;

    try {
      let resourceType = 'auto';
      if (req.file.mimetype === 'application/pdf') {
        resourceType = 'raw';
      } else if (req.file.mimetype.startsWith('image/')) {
        resourceType = 'image';
      } else if (req.file.mimetype.startsWith('video/')) {
        resourceType = 'video';
      } else if (req.file.mimetype.startsWith('audio/')) {
        resourceType = 'video';
      } else {
        resourceType = 'raw';
      }

      const result = await cloudinary.uploader.upload(dataURI, {
        resource_type: resourceType,
        folder: 'school_documents',
        public_id: `doc_${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9]/g, '_')}`,
        timeout: 60000,
        type: 'upload',
        access_mode: 'public'
      });

      res.json({
        url: result.secure_url,
        public_id: result.public_id,
        name: req.file.originalname,
        size: `${(result.bytes / 1024).toFixed(1)} KB`,
        format: result.format,
        resource_type: result.resource_type
      });
    } catch (cloudinaryError) {
      console.warn('Cloudinary upload failed, using base64 fallback:', cloudinaryError.message);
      console.error('Cloudinary error details:', cloudinaryError);

      res.json({
        url: dataURI,
        public_id: `local_${Date.now()}`,
        name: req.file.originalname,
        size: `${(req.file.size / 1024).toFixed(1)} KB`,
        format: req.file.mimetype,
        warning: 'File uploaded locally. Cloud storage failed.',
        cloudinaryError: cloudinaryError.message
      });
    }
  } catch (error) {
    console.error('Upload Error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: `Upload failed: ${error.message || 'Unknown error'}`,
      details: error.message
    });
  }
});

export default router;
