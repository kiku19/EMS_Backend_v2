import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { validateZod } from '../validators/zodHelpers.js';
import { z } from 'zod';
import Vendor from '../models/Vendor.js';

const router = express.Router();
router.use(authenticate);

// P11: minimal, school-scoped Vendor CRUD so expenses can link to a vendor
// record via Expense.vendorId. Registration of this router on the app is a
// shared mount (server.js / routes index) — see report follow-up. Until
// registered it is dead code but available for the route owner to mount.
//
// Authorization note: mirrors the sibling expenses.js routes, which are
// protected by `authenticate` only (there is no dedicated 'expenses' RBAC
// module in PERMISSION_TEMPLATES). If finer access control is added later,
// add checkPermission('payroll', ...) (the closest finance module) here.

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const vendorCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  contactPerson: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional(),
  category: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
  isActive: z.boolean().optional(),
});

const vendorUpdateSchema = vendorCreateSchema.partial();

const vendorParamsSchema = z.object({ id: objectIdString });

// GET /vendors — list, school-scoped, excludes soft-deleted.
router.get('/', async (req, res) => {
  try {
    const { q, category, isActive } = req.query;
    const query = {
      schoolId: req.user.schoolId,
      isDeleted: { $ne: true },
    };
    if (category) query.category = String(category);
    if (isActive !== undefined) query.isActive = String(isActive) === 'true';
    if (q) {
      const escaped = String(q)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (escaped) {
        query.$or = [
          { name: new RegExp(escaped, 'i') },
          { contactPerson: new RegExp(escaped, 'i') },
          { phone: new RegExp(escaped, 'i') },
        ];
      }
    }
    const vendors = await Vendor.find(query).sort({ name: 1 }).lean();
    res.json({ vendors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /vendors/:id
router.get('/:id', validateZod(vendorParamsSchema, 'params'), async (req, res) => {
  try {
    const vendor = await Vendor.findOne({
      _id: req.params.id,
      schoolId: req.user.schoolId,
      isDeleted: { $ne: true },
    }).lean();
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json(vendor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /vendors
router.post('/', validateZod(vendorCreateSchema), async (req, res) => {
  try {
    const vendor = await Vendor.create({
      ...req.body,
      schoolId: req.user.schoolId,
      createdBy: req.user._id,
    });
    res.status(201).json(vendor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /vendors/:id
router.put(
  '/:id',
  validateZod(vendorParamsSchema, 'params'),
  validateZod(vendorUpdateSchema),
  async (req, res) => {
    try {
      const vendor = await Vendor.findOneAndUpdate(
        { _id: req.params.id, schoolId: req.user.schoolId, isDeleted: { $ne: true } },
        { $set: { ...req.body, updatedBy: req.user._id } },
        { new: true, runValidators: true }
      );
      if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
      res.json(vendor);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// DELETE /vendors/:id — soft delete
router.delete('/:id', validateZod(vendorParamsSchema, 'params'), async (req, res) => {
  try {
    const vendor = await Vendor.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.user.schoolId },
      { $set: { isDeleted: true, updatedBy: req.user._id } },
      { new: true }
    );
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ message: 'Vendor deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
