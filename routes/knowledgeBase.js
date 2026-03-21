import express from 'express';
import { z } from 'zod';
import KnowledgeBase from '../models/KnowledgeBase.js';
import { authenticate } from '../middleware/auth.js';
import { isSuperAdminUser } from '../utils/superAdmin.js';

const router = express.Router();
router.use(authenticate);

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  'getting_started',
  'students',
  'staff',
  'fees',
  'attendance',
  'academics',
  'messaging',
  'reports',
  'settings',
  'other',
];

const createArticleSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  content: z.string().min(1, 'Content is required').max(20000),
  type: z.enum(['article', 'faq']),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string().max(50)).max(20).default([]),
  isPublished: z.boolean().default(false),
  order: z.number().int().min(0).default(0),
});

const updateArticleSchema = createArticleSchema.partial();

const searchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.enum([...CATEGORIES, '']).optional(),
  type: z.enum(['article', 'faq', '']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function requireSuperAdmin(req, res) {
  if (!isSuperAdminUser(req.user)) {
    res.status(403).json({ error: 'Super admin access required' });
    return false;
  }
  return true;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /knowledge-base — list/search published articles
router.get('/', async (req, res) => {
  try {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid query', details: parsed.error.issues });
    }
    const { q, category, type, page, limit } = parsed.data;

    const filter = { isPublished: true };
    if (category) filter.category = category;
    if (type) filter.type = type;

    let query;
    if (q && q.trim()) {
      // Text search when a query is provided
      query = KnowledgeBase.find(
        { ...filter, $text: { $search: q } },
        { score: { $meta: 'textScore' } }
      ).sort({ score: { $meta: 'textScore' } });
    } else {
      query = KnowledgeBase.find(filter).sort({ category: 1, order: 1, createdAt: -1 });
    }

    const skip = (page - 1) * limit;
    const [articles, total] = await Promise.all([
      query.skip(skip).limit(limit).lean(),
      KnowledgeBase.countDocuments(filter),
    ]);

    res.json({ articles, total, page, limit });
  } catch (error) {
    console.error('Error fetching knowledge base:', error);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// GET /knowledge-base/categories — count per category
router.get('/categories', async (req, res) => {
  try {
    const counts = await KnowledgeBase.aggregate([
      { $match: { isPublished: true } },
      { $group: { _id: { category: '$category', type: '$type' }, count: { $sum: 1 } } },
    ]);

    const result = {};
    for (const { _id, count } of counts) {
      if (!result[_id.category]) result[_id.category] = { total: 0, article: 0, faq: 0 };
      result[_id.category][_id.type] = count;
      result[_id.category].total += count;
    }

    res.json({ categories: result });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET /knowledge-base/:id — single article (increments viewCount)
router.get('/:id', async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    // Non-super-admins can only see published articles
    if (!isSuperAdminUser(req.user)) {
      filter.isPublished = true;
    }

    const article = await KnowledgeBase.findOneAndUpdate(
      filter,
      { $inc: { viewCount: 1 } },
      { new: true }
    ).lean();

    if (!article) return res.status(404).json({ error: 'Article not found' });

    res.json({ article });
  } catch (error) {
    console.error('Error fetching article:', error);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
});

// POST /knowledge-base/:id/feedback — helpful/not-helpful vote
router.post('/:id/feedback', async (req, res) => {
  try {
    const { helpful } = req.body;
    if (typeof helpful !== 'boolean') {
      return res.status(400).json({ error: '"helpful" must be a boolean' });
    }

    const update = helpful ? { $inc: { helpfulCount: 1 } } : { $inc: { notHelpfulCount: 1 } };

    const article = await KnowledgeBase.findOneAndUpdate(
      { _id: req.params.id, isPublished: true },
      update,
      { new: true }
    ).lean();

    if (!article) return res.status(404).json({ error: 'Article not found' });

    res.json({ helpfulCount: article.helpfulCount, notHelpfulCount: article.notHelpfulCount });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// ─── Super-Admin Management Routes ───────────────────────────────────────────

// GET /knowledge-base/admin/all — list all (including unpublished)
router.get('/admin/all', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const { category, type, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (type) filter.type = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [articles, total] = await Promise.all([
      KnowledgeBase.find(filter)
        .sort({ category: 1, order: 1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      KnowledgeBase.countDocuments(filter),
    ]);

    res.json({ articles, total });
  } catch (error) {
    console.error('Error fetching all articles:', error);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
});

// POST /knowledge-base/admin — create article/faq
router.post('/admin', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const parsed = createArticleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const article = await KnowledgeBase.create(parsed.data);
    res.status(201).json({ article });
  } catch (error) {
    console.error('Error creating article:', error);
    res.status(500).json({ error: 'Failed to create article' });
  }
});

// PUT /knowledge-base/admin/:id — update article/faq
router.put('/admin/:id', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const parsed = updateArticleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }

    const article = await KnowledgeBase.findByIdAndUpdate(
      req.params.id,
      { $set: parsed.data },
      { new: true }
    ).lean();

    if (!article) return res.status(404).json({ error: 'Article not found' });

    res.json({ article });
  } catch (error) {
    console.error('Error updating article:', error);
    res.status(500).json({ error: 'Failed to update article' });
  }
});

// DELETE /knowledge-base/admin/:id — delete article
router.delete('/admin/:id', async (req, res) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const article = await KnowledgeBase.findByIdAndDelete(req.params.id).lean();
    if (!article) return res.status(404).json({ error: 'Article not found' });

    res.json({ message: 'Article deleted' });
  } catch (error) {
    console.error('Error deleting article:', error);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

export default router;
