import express from 'express';
const router = express.Router();
import { authenticate } from '../middleware/auth.js';
import { validateZod } from '../validators/zodHelpers.js';
import {
  createExpenseSchema,
  updateExpenseSchema,
  rejectExpenseSchema,
} from '../validators/expenseSchema.js';
import Expense from '../models/Expense.js';
import mongoose from 'mongoose';

router.use(authenticate);

// GET /expenses — list with optional filters
router.get('/', async (req, res) => {
  try {
    const { q, category, status, academicYear, from, to, page = 1, limit = 50 } = req.query;
    const query = { schoolId: req.user.schoolId, isDeleted: { $ne: true } };

    if (category) query.category = category;
    if (status) query.status = status;
    if (academicYear) query.academicYear = academicYear;
    if (q) {
      // Coerce to string (guards against NoSQL injection via object params) and
      // escape regex metacharacters before matching title/vendor case-insensitively.
      const escaped = String(q)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (escaped) {
        query.$or = [{ title: new RegExp(escaped, 'i') }, { vendor: new RegExp(escaped, 'i') }];
      }
    }
    if (from || to) {
      query.expenseDate = {};
      if (from) query.expenseDate.$gte = new Date(from);
      if (to) query.expenseDate.$lte = new Date(to);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [expenses, total] = await Promise.all([
      Expense.find(query).sort({ expenseDate: -1 }).skip(skip).limit(Number(limit)).lean(),
      Expense.countDocuments(query),
    ]);

    res.json({ expenses, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /expenses/summary — total by category for dashboard
router.get('/summary', async (req, res) => {
  try {
    const { academicYear, from, to, category, status } = req.query;
    const match = {
      schoolId: new mongoose.Types.ObjectId(req.user.schoolId),
      isDeleted: { $ne: true },
    };
    // Honor an explicit status filter so the cards match the filtered table
    // (the list route applies the same param). With no status filter, keep the
    // dashboard rollup excluding rejected expenses. String() guards against
    // object-shaped query params (e.g. status[$ne]=…) reaching the aggregation.
    if (status) match.status = String(status);
    else match.status = { $ne: 'rejected' };
    if (category) match.category = String(category);
    if (academicYear) match.academicYear = academicYear;
    if (from || to) {
      match.expenseDate = {};
      if (from) match.expenseDate.$gte = new Date(from);
      if (to) match.expenseDate.$lte = new Date(to);
    }

    const summary = await Expense.aggregate([
      { $match: match },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);

    const totalAmount = summary.reduce((sum, s) => sum + s.total, 0);
    res.json({ summary, totalAmount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /expenses
router.post('/', validateZod(createExpenseSchema), async (req, res) => {
  try {
    const expense = await Expense.create({
      ...req.body,
      schoolId: req.user.schoolId,
    });
    res.status(201).json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /expenses/:id
// P10: status/approvedBy are intentionally NOT accepted here — use the
// dedicated approve/reject endpoints below so approvedBy is stamped
// server-side from the authenticated user.
router.put('/:id', validateZod(updateExpenseSchema), async (req, res) => {
  try {
    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.user.schoolId, isDeleted: { $ne: true } },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /expenses/:id/approve — approve a pending expense. approvedBy is set
// from the authenticated user so it can't be spoofed by the client.
router.post('/:id/approve', async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      schoolId: req.user.schoolId,
      isDeleted: { $ne: true },
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.status === 'approved') {
      return res.status(409).json({ error: 'Expense is already approved' });
    }
    expense.status = 'approved';
    expense.approvedBy = String(req.user._id);
    await expense.save();
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /expenses/:id/reject — reject a pending expense, recording who rejected
// it. An optional reason can be supplied (stored in the description field if
// present, since the Expense schema has no dedicated rejection-reason path).
router.post('/:id/reject', validateZod(rejectExpenseSchema), async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      schoolId: req.user.schoolId,
      isDeleted: { $ne: true },
    });
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.status === 'rejected') {
      return res.status(409).json({ error: 'Expense is already rejected' });
    }
    expense.status = 'rejected';
    expense.approvedBy = String(req.user._id);
    const { reason } = req.body || {};
    if (reason) {
      expense.description = expense.description
        ? `${expense.description}\n[Rejected: ${reason}]`
        : `[Rejected: ${reason}]`;
    }
    await expense.save();
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /expenses/:id — soft delete
router.delete('/:id', async (req, res) => {
  try {
    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.user.schoolId },
      { isDeleted: true },
      { new: true }
    );
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
