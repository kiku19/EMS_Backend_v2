import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { listCurricula, getCurriculum, getSubjectsForGrade } from '../utils/curricula.js';

const router = express.Router();

// Curricula are read-only global reference data — any authenticated user can
// read them (school-scoped permissions don't apply since they're not tenant
// data). The import/apply action lives under /settings and is permission-gated
// there.
router.use(authenticate);

/**
 * GET /api/v1/curricula
 * Lightweight list of available curricula (id + name + description + grade count).
 */
router.get('/', (req, res) => {
  res.json({ curricula: listCurricula() });
});

/**
 * GET /api/v1/curricula/:id
 * Full curriculum including the per-grade subject map.
 */
router.get('/:id', (req, res) => {
  const curriculum = getCurriculum(req.params.id);
  if (!curriculum) {
    return res.status(404).json({ error: 'Curriculum not found' });
  }
  res.json(curriculum);
});

/**
 * GET /api/v1/curricula/:id/grades/:grade/subjects
 * Subjects for a single grade. Returns [] for unknown curriculum, non-numeric
 * grades (e.g. "Nursery"), or grades outside 1-12.
 */
router.get('/:id/grades/:grade/subjects', (req, res) => {
  const curriculum = getCurriculum(req.params.id);
  if (!curriculum) {
    return res.status(404).json({ error: 'Curriculum not found' });
  }
  res.json({ subjects: getSubjectsForGrade(req.params.id, req.params.grade) });
});

export default router;
