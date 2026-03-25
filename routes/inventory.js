import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import Asset from '../models/Asset.js';
import AssetCategory from '../models/AssetCategory.js';
import AssetAudit from '../models/AssetAudit.js';
import Vendor from '../models/Vendor.js';
import MaintenanceLog from '../models/MaintenanceLog.js';
import ProcurementRequest from '../models/ProcurementRequest.js';
import {
  createAssetSchema,
  updateAssetSchema,
  assignAssetSchema,
  createVendorSchema,
  updateVendorSchema,
  createMaintenanceLogSchema,
  updateMaintenanceLogSchema,
  createProcurementSchema,
  updateProcurementSchema,
  createAssetCategorySchema,
  updateAssetCategorySchema,
  createAssetAuditSchema,
  updateAssetAuditSchema,
} from '../middleware/inventoryValidation.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const id = extractSchoolId(schoolId);
  if (!id) throw new Error('schoolId is required');
  return { ...query, schoolId: id };
}

// ─── STATS ───────────────────────────────────────────────────────────────────

router.get('/stats', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const base = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

    const [
      totalAssets,
      activeAssets,
      underMaintenance,
      pendingProcurements,
      totalVendors,
      lowStockAssets,
    ] = await Promise.all([
      Asset.countDocuments(base),
      Asset.countDocuments({ ...base, status: 'ACTIVE' }),
      Asset.countDocuments({ ...base, status: 'UNDER_MAINTENANCE' }),
      ProcurementRequest.countDocuments(
        scopeBySchool(schoolId, { isDeleted: { $ne: true }, status: 'PENDING' })
      ),
      Vendor.countDocuments(scopeBySchool(schoolId, { isDeleted: { $ne: true }, isActive: true })),
      Asset.countDocuments({
        ...base,
        $expr: {
          $and: [{ $gt: ['$minimumQuantity', 0] }, { $lte: ['$quantity', '$minimumQuantity'] }],
        },
      }),
    ]);

    res.json({
      totalAssets,
      activeAssets,
      underMaintenance,
      pendingProcurements,
      totalVendors,
      lowStockAssets,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── ASSETS ──────────────────────────────────────────────────────────────────

router.get('/assets', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, category, status, condition } = req.query;
    const schoolId = req.user.schoolId;
    const query = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

    if (category) query.category = category;
    if (status) query.status = status;
    if (condition) query.condition = condition;
    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [
        { name: regex },
        { assetTag: regex },
        { location: regex },
        { serialNumber: regex },
        { assignedTo: regex },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [assets, total] = await Promise.all([
      Asset.find(query)
        .populate('vendorId', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Asset.countDocuments(query),
    ]);

    res.json({ data: assets, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/assets/low-stock', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const assets = await Asset.find({
      ...scopeBySchool(schoolId, { isDeleted: { $ne: true } }),
      minimumQuantity: { $gt: 0 },
      $expr: { $lte: ['$quantity', '$minimumQuantity'] },
    })
      .populate('vendorId', 'name phone')
      .sort({ quantity: 1 });

    res.json(assets);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/assets/:id', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const asset = await Asset.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    ).populate('vendorId', 'name phone email');

    if (!asset) return res.status(404).json({ error: req.t('common:routes.assetNotFound') });
    res.json(asset);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/assets', authenticate, async (req, res) => {
  try {
    const data = createAssetSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const asset = await Asset.create({
      ...data,
      schoolId: extractSchoolId(schoolId),
      createdBy: req.user._id,
    });

    res.status(201).json(asset);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/assets/:id', authenticate, async (req, res) => {
  try {
    const data = updateAssetSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const asset = await Asset.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { ...data, updatedBy: req.user._id },
      { new: true, runValidators: true }
    );

    if (!asset) return res.status(404).json({ error: req.t('common:routes.assetNotFound') });
    res.json(asset);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/assets/:id/assign', authenticate, async (req, res) => {
  try {
    const data = assignAssetSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const asset = await Asset.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { assignedTo: data.assignedTo, updatedBy: req.user._id },
      { new: true }
    );

    if (!asset) return res.status(404).json({ error: req.t('common:routes.assetNotFound') });
    res.json(asset);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/assets/:id/depreciation', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const asset = await Asset.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );

    if (!asset) return res.status(404).json({ error: req.t('common:routes.assetNotFound') });
    if (!asset.purchasePrice || !asset.purchaseDate) {
      return res.json({
        asset: asset._id,
        depreciation: null,
        message: req.t('common:routes.purchasePriceAndDateAreRequiredForDepreciationCalculation'),
      });
    }

    const rate = asset.depreciationRate || 0;
    const purchaseDate = new Date(asset.purchaseDate);
    const now = new Date();
    const yearsElapsed = (now - purchaseDate) / (1000 * 60 * 60 * 24 * 365.25);
    const currentValue = asset.purchasePrice * Math.pow(1 - rate / 100, yearsElapsed);
    const totalDepreciation = asset.purchasePrice - currentValue;

    res.json({
      assetId: asset._id,
      name: asset.name,
      purchasePrice: asset.purchasePrice,
      purchaseDate: asset.purchaseDate,
      depreciationRate: rate,
      yearsElapsed: Math.round(yearsElapsed * 100) / 100,
      currentValue: Math.max(0, Math.round(currentValue * 100) / 100),
      totalDepreciation: Math.round(totalDepreciation * 100) / 100,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/assets/:id', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const asset = await Asset.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isDeleted: true, updatedBy: req.user._id },
      { new: true }
    );

    if (!asset) return res.status(404).json({ error: req.t('common:routes.assetNotFound') });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── ASSET CATEGORIES ─────────────────────────────────────────────────────────

router.get('/categories', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const categories = await AssetCategory.find(
      scopeBySchool(schoolId, { isDeleted: { $ne: true } })
    ).sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/categories', authenticate, async (req, res) => {
  try {
    const data = createAssetCategorySchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const category = await AssetCategory.create({
      ...data,
      schoolId: extractSchoolId(schoolId),
      createdBy: req.user._id,
    });

    res.status(201).json(category);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ success: false, error: req.t('common:routes.categoryWithThisNameAlreadyExists') });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/categories/:id', authenticate, async (req, res) => {
  try {
    const data = updateAssetCategorySchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const category = await AssetCategory.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { ...data, updatedBy: req.user._id },
      { new: true, runValidators: true }
    );

    if (!category) return res.status(404).json({ error: req.t('common:routes.categoryNotFound') });
    res.json(category);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/categories/:id', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const category = await AssetCategory.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isDeleted: true, updatedBy: req.user._id },
      { new: true }
    );

    if (!category) return res.status(404).json({ error: req.t('common:routes.categoryNotFound') });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── VENDORS ─────────────────────────────────────────────────────────────────

router.get('/vendors', authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    const schoolId = req.user.schoolId;
    const query = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

    if (search) {
      const regex = new RegExp(search, 'i');
      query.$or = [{ name: regex }, { contactPerson: regex }, { phone: regex }];
    }

    const vendors = await Vendor.find(query).sort({ name: 1 });
    res.json(vendors);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/vendors', authenticate, async (req, res) => {
  try {
    const data = createVendorSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const vendor = await Vendor.create({
      ...data,
      schoolId: extractSchoolId(schoolId),
      createdBy: req.user._id,
    });

    res.status(201).json(vendor);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/vendors/:id', authenticate, async (req, res) => {
  try {
    const data = updateVendorSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const vendor = await Vendor.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { ...data, updatedBy: req.user._id },
      { new: true, runValidators: true }
    );

    if (!vendor) return res.status(404).json({ error: req.t('common:routes.vendorNotFound') });
    res.json(vendor);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/vendors/:id', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const vendor = await Vendor.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isDeleted: true, updatedBy: req.user._id },
      { new: true }
    );

    if (!vendor) return res.status(404).json({ error: req.t('common:routes.vendorNotFound') });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── MAINTENANCE LOGS ─────────────────────────────────────────────────────────

router.get('/maintenance', authenticate, async (req, res) => {
  try {
    const { assetId, status } = req.query;
    const schoolId = req.user.schoolId;
    const query = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

    if (assetId) query.assetId = assetId;
    if (status) query.status = status;

    const logs = await MaintenanceLog.find(query)
      .populate('assetId', 'name assetTag category')
      .populate('vendorId', 'name phone')
      .sort({ scheduledDate: -1 });

    res.json(logs);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/maintenance', authenticate, async (req, res) => {
  try {
    const data = createMaintenanceLogSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const log = await MaintenanceLog.create({
      ...data,
      schoolId: extractSchoolId(schoolId),
      createdBy: req.user._id,
    });

    // Update asset status if needed
    if (data.status === 'IN_PROGRESS' || data.status === 'SCHEDULED') {
      await Asset.findOneAndUpdate(
        scopeBySchool(schoolId, { _id: data.assetId, isDeleted: { $ne: true } }),
        { status: 'UNDER_MAINTENANCE' }
      );
    }

    res.status(201).json(log);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/maintenance/:id', authenticate, async (req, res) => {
  try {
    const data = updateMaintenanceLogSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const log = await MaintenanceLog.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { ...data, updatedBy: req.user._id },
      { new: true, runValidators: true }
    );

    if (!log) return res.status(404).json({ error: req.t('common:routes.maintenanceLogNotFound') });

    // If completed, restore asset to ACTIVE
    if (data.status === 'COMPLETED') {
      await Asset.findOneAndUpdate(
        scopeBySchool(schoolId, { _id: log.assetId, isDeleted: { $ne: true } }),
        { status: 'ACTIVE' }
      );
    }

    res.json(log);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

// ─── PROCUREMENT ─────────────────────────────────────────────────────────────

router.get('/procurement', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    const schoolId = req.user.schoolId;
    const query = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

    if (status) query.status = status;

    const requests = await ProcurementRequest.find(query)
      .populate('requestedBy', 'name')
      .populate('approvedBy', 'name')
      .populate('vendorId', 'name')
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/procurement', authenticate, async (req, res) => {
  try {
    const data = createProcurementSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const request = await ProcurementRequest.create({
      ...data,
      schoolId: extractSchoolId(schoolId),
      requestedBy: req.user._id,
      createdBy: req.user._id,
    });

    res.status(201).json(request);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/procurement/:id', authenticate, async (req, res) => {
  try {
    const data = updateProcurementSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const update = { ...data, updatedBy: req.user._id };
    if (data.status === 'APPROVED' || data.status === 'REJECTED') {
      update.approvedBy = req.user._id;
    }

    const request = await ProcurementRequest.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      update,
      { new: true, runValidators: true }
    )
      .populate('requestedBy', 'name')
      .populate('approvedBy', 'name');

    if (!request)
      return res.status(404).json({ error: req.t('common:routes.procurementRequestNotFound') });
    res.json(request);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/procurement/:id', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const request = await ProcurementRequest.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isDeleted: true, updatedBy: req.user._id },
      { new: true }
    );

    if (!request)
      return res.status(404).json({ error: req.t('common:routes.procurementRequestNotFound') });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── ASSET AUDITS ─────────────────────────────────────────────────────────────

router.get('/audits', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    const schoolId = req.user.schoolId;
    const query = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

    if (status) query.status = status;

    const audits = await AssetAudit.find(query)
      .populate('auditItems.assetId', 'name assetTag category')
      .sort({ createdAt: -1 });

    res.json(audits);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/audits', authenticate, async (req, res) => {
  try {
    const data = createAssetAuditSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const audit = await AssetAudit.create({
      ...data,
      schoolId: extractSchoolId(schoolId),
      createdBy: req.user._id,
    });

    res.status(201).json(audit);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/audits/:id', authenticate, async (req, res) => {
  try {
    const data = updateAssetAuditSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const audit = await AssetAudit.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { ...data, updatedBy: req.user._id },
      { new: true, runValidators: true }
    ).populate('auditItems.assetId', 'name assetTag category');

    if (!audit) return res.status(404).json({ error: req.t('common:routes.auditNotFound') });

    // If completed audit, update asset conditions and quantities from audit items
    if (data.status === 'COMPLETED' && data.auditItems?.length) {
      const bulkOps = data.auditItems
        .filter((item) => item.actualQuantity != null || item.condition)
        .map((item) => ({
          updateOne: {
            filter: scopeBySchool(schoolId, { _id: item.assetId, isDeleted: { $ne: true } }),
            update: {
              ...(item.actualQuantity != null ? { quantity: item.actualQuantity } : {}),
              ...(item.condition ? { condition: item.condition } : {}),
            },
          },
        }));
      if (bulkOps.length) await Asset.bulkWrite(bulkOps);
    }

    res.json(audit);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res
        .status(400)
        .json({
          success: false,
          error: req.t('common:routes.validationFailed'),
          details: error.errors,
        });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/audits/:id', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const audit = await AssetAudit.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isDeleted: true, updatedBy: req.user._id },
      { new: true }
    );

    if (!audit) return res.status(404).json({ error: req.t('common:routes.auditNotFound') });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── REPORTS ─────────────────────────────────────────────────────────────────

router.get('/reports', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const base = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

    const [categoryBreakdown, conditionSummary, statusSummary, totalValueResult] =
      await Promise.all([
        Asset.aggregate([
          { $match: base },
          {
            $group: {
              _id: '$category',
              count: { $sum: 1 },
              totalValue: { $sum: { $ifNull: ['$purchasePrice', 0] } },
              totalQuantity: { $sum: '$quantity' },
            },
          },
          { $sort: { count: -1 } },
        ]),
        Asset.aggregate([
          { $match: base },
          { $group: { _id: '$condition', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Asset.aggregate([
          { $match: base },
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Asset.aggregate([
          { $match: base },
          {
            $group: {
              _id: null,
              totalPurchaseValue: { $sum: { $ifNull: ['$purchasePrice', 0] } },
              totalCurrentValue: { $sum: { $ifNull: ['$currentValue', 0] } },
              totalItems: { $sum: 1 },
            },
          },
        ]),
      ]);

    const totals = totalValueResult[0] || {
      totalPurchaseValue: 0,
      totalCurrentValue: 0,
      totalItems: 0,
    };

    res.json({
      totals,
      categoryBreakdown,
      conditionSummary,
      statusSummary,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
