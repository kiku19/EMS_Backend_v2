import express from 'express';
const router = express.Router();
import { authenticate } from '../middleware/auth.js';
import { validateZod } from '../validators/zodHelpers.js';
import { createExpenseSchema, updateExpenseSchema } from '../validators/expenseSchema.js';
import Expense from '../models/Expense.js';
import mongoose from 'mongoose';

router.use(authenticate);

// GET /expenses — list with optional filters
router.get('/', async (req, res) => {
  try {
    const { category, status, academicYear, from, to, page = 1, limit = 50 } = req.query;
    const query = { schoolId: req.user.schoolId, isDeleted: { $ne: true } };

    if (category) query.category = category;
    if (status) query.status = status;
    if (academicYear) query.academicYear = academicYear;
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
    const { academicYear, from, to } = req.query;
    const match = {
      schoolId: new mongoose.Types.ObjectId(req.user.schoolId),
      isDeleted: { $ne: true },
      status: { $ne: 'rejected' },
    };
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
