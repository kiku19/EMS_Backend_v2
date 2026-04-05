import express from 'express';
import { z } from 'zod';
import NpsSurvey from '../models/NpsSurvey.js';
import SchoolSettings from '../models/SchoolSettings.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

const submitSchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().max(500).optional(),
  source: z.enum(['dashboard', 'mobile']).default('dashboard'),
});

const configSchema = z.object({
  enabled: z.boolean(),
  cooldownDays: z.number().int().min(7).max(365),
});

const analyticsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).optional();

// Helper: get NPS config for school
async function getNpsConfig(schoolId) {
  const settings = await SchoolSettings.findOne({ schoolId }).select('nps').lean();
  return {
    enabled: settings?.nps?.enabled ?? true,
    cooldownDays: settings?.nps?.cooldownDays ?? 90,
  };
}

// GET /nps/config — read NPS configuration
router.get('/config', async (req, res) => {
  try {
    const config = await getNpsConfig(req.user.schoolId);
    res.json(config);
  } catch (err) {
    console.error('NPS config read error:', err);
    res.status(500).json({ error: 'Failed to load NPS config' });
  }
});

// PUT /nps/config — update NPS configuration
router.put('/config', async (req, res) => {
  try {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    await SchoolSettings.findOneAndUpdate(
      { schoolId: req.user.schoolId },
      { $set: { 'nps.enabled': parsed.data.enabled, 'nps.cooldownDays': parsed.data.cooldownDays } },
      { upsert: true }
    );

    res.json({ success: true, ...parsed.data });
  } catch (err) {
    console.error('NPS config update error:', err);
    res.status(500).json({ error: 'Failed to update NPS config' });
  }
});

// GET /nps/status — check if the current user should see the survey
router.get('/status', async (req, res) => {
  try {
    const config = await getNpsConfig(req.user.schoolId);

    if (!config.enabled) {
      return res.json({ shouldShow: false });
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.cooldownDays);

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
    // Optional date range filtering
    const dateFilter = {};
    if (req.query.from) dateFilter.$gte = new Date(req.query.from);
    if (req.query.to) dateFilter.$lte = new Date(req.query.to);

    const query = {
      schoolId: req.user.schoolId,
      dismissed: false,
      score: { $exists: true, $ne: null },
    };
    if (Object.keys(dateFilter).length > 0) query.createdAt = dateFilter;

    const responses = await NpsSurvey.find(query).lean();

    if (responses.length === 0) {
      return res.json({
        npsScore: null,
        total: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        distribution: {},
        comments: [],
        trend: [],
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

    // Monthly trend (last 6 months)
    const trendMap = {};
    responses.forEach((r) => {
      const d = new Date(r.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!trendMap[key]) trendMap[key] = { promoters: 0, detractors: 0, total: 0 };
      trendMap[key].total++;
      if (r.category === 'promoter') trendMap[key].promoters++;
      if (r.category === 'detractor') trendMap[key].detractors++;
    });

    const trend = Object.entries(trendMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, d]) => ({
        month,
        score: d.total > 0 ? Math.round(((d.promoters - d.detractors) / d.total) * 100) : 0,
        responses: d.total,
      }));

    res.json({ npsScore, total, promoters, passives, detractors, distribution, comments, trend });
  } catch (err) {
    console.error('NPS analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch NPS analytics' });
  }
});

export default router;
