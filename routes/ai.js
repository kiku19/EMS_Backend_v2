import express from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../middleware/auth.js';
import { featureGate } from '../middleware/featureGate.js';
import {
  AiRequestError,
  getAiModelsPayload,
  processAiChat,
  transcribeAiAudio,
} from '../services/aiService.js';

const router = express.Router();
router.use(authenticate);

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({
      error: 'Too many AI requests. Please try again later.',
    });
  },
});

const transcriptionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.status(429).json({
      error: 'Too many audio transcription requests. Please try again later.',
    });
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

router.get('/models', authenticate, (_req, res) => {
  res.json(getAiModelsPayload());
});

router.post('/chat', chatLimiter, authenticate, featureGate('aiAssistant'), async (req, res) => {
  try {
    const { messages = [], selectedModel } = req.body || {};
    const result = await processAiChat({
      messages,
      selectedModel,
      user: req.user,
    });

    res.json(result);
  } catch (error) {
    console.error('AI chat route error:', error);

    if (error instanceof AiRequestError) {
      return res.status(error.status || 400).json({ error: error.message });
    }

    return res.status(500).json({
      error: error.message || 'Failed to process AI request.',
    });
  }
});

router.post(
  '/transcribe',
  transcriptionLimiter,
  authenticate,
  featureGate('aiAssistant'),
  upload.single('audio'),
  async (req, res) => {
    try {
      if (!req.file) {
        throw new AiRequestError('No audio file uploaded.');
      }

      const result = await transcribeAiAudio(req.file);
      res.json(result);
    } catch (error) {
      console.error('AI transcription route error:', error);

      if (error instanceof AiRequestError) {
        return res.status(error.status || 400).json({ error: error.message });
      }

      return res.status(500).json({
        error: error.message || 'Failed to transcribe audio.',
      });
    }
  }
);

export default router;
