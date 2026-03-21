import express from 'express';
import { z } from 'zod';
import NpsSurvey from '../models/NpsSurvey.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// How many days before showing the survey again
const NPS_COOLDOWN_DAYS = 90;

const submitSchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().max(500).optional(),
  source: z.enum(['dashboard', 'mobile']).default('dashboard'),
});

// GET /nps/status — check if the current user should see the survey
router.get('/status', async (req, res) => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - NPS_COOLDOWN_DAYS);

    const recent = await NpsSurvey.findOne({
      userId: req.user.id,
      schoolId: req.user.schoolId,
      createdAt: { $gte: cutoff },
    }).lean();

    res.json({ shouldShow: !recent });
  } catch (err) {
    console.error('NPS status error:', err);
    res.status(500).json({ error: 'Failed to check NPS status' });
  }
});

// POST /nps/submit — save a completed NPS response
router.post('/submit', async (req, res) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { score, comment, source } = parsed.data;
    const category = score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor';

    const survey = await NpsSurvey.create({
      schoolId: req.user.schoolId,
      userId: req.user.id,
      userModel: 'Staff',
      score,
      comment,
      category,
      dismissed: false,
      source,
    });

    res.status(201).json({ success: true, survey });
  } catch (err) {
    console.error('NPS submit error:', err);
    res.status(500).json({ error: 'Failed to submit NPS response' });
  }
});

// POST /nps/dismiss — record a dismissal (no score)
router.post('/dismiss', async (req, res) => {
  try {
    await NpsSurvey.create({
      schoolId: req.user.schoolId,
      userId: req.user.id,
      userModel: 'Staff',
      dismissed: true,
      source: 'dashboard',
    });

    res.json({ success: true });
  } catch (err) {
    console.error('NPS dismiss error:', err);
    res.status(500).json({ error: 'Failed to dismiss NPS survey' });
  }
});

// GET /nps/analytics — school-level NPS analytics (admin use)
router.get('/analytics', async (req, res) => {
  try {
    const responses = await NpsSurvey.find({
      schoolId: req.user.schoolId,
      dismissed: false,
      score: { $exists: true, $ne: null },
    }).lean();

    if (responses.length === 0) {
      return res.json({
        npsScore: null,
        total: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        distribution: {},
        comments: [],
      });
    }

    const total = responses.length;
    const promoters = responses.filter((r) => r.category === 'promoter').length;
    const detractors = responses.filter((r) => r.category === 'detractor').length;
    const passives = total - promoters - detractors;
    const npsScore = Math.round(((promoters - detractors) / total) * 100);

    const distribution = responses.reduce((acc, r) => {
      acc[r.score] = (acc[r.score] || 0) + 1;
      return acc;
    }, {});

    const comments = responses
      .filter((r) => r.comment)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20)
      .map((r) => ({
        score: r.score,
        comment: r.comment,
        category: r.category,
        createdAt: r.createdAt,
      }));

    res.json({ npsScore, total, promoters, passives, detractors, distribution, comments });
  } catch (err) {
    console.error('NPS analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch NPS analytics' });
  }
});

export default router;
