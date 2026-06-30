import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { checkPermission } from '../middleware/permissions.js';
import { extractSchoolId } from '../utils/schoolContext.js';
import Asset from '../models/Asset.js';
import AssetCategory from '../models/AssetCategory.js';
import AssetAudit from '../models/AssetAudit.js';
import Vendor from '../models/Vendor.js';
import MaintenanceLog from '../models/MaintenanceLog.js';
import ProcurementRequest from '../models/ProcurementRequest.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import { logToTrash } from '../services/trashService.js';
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
  stockAdjustSchema,
} from '../middleware/inventoryValidation.js';

const router = express.Router();
router.use(authenticate);

function scopeBySchool(schoolId, query = {}) {
  const id = extractSchoolId(schoolId);
  if (!id) throw new Error('schoolId is required');
  return { ...query, schoolId: id };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── STATS ───────────────────────────────────────────────────────────────────

router.get('/stats', checkPermission('inventory', 'view'), async (req, res) => {
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

router.get('/assets', checkPermission('inventory', 'view'), async (req, res) => {
  try {
    const { page = 1, limit = 50, search, category, status, condition, location } = req.query;
    const schoolId = req.user.schoolId;
    const query = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

    if (category) query.category = category;
    if (status) query.status = status;
    if (condition) query.condition = condition;
    if (location) query.location = location;
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      query.$or = [
        { name: regex },
        { assetTag: regex },
        { location: regex },
        { serialNumber: regex },
        { assignedToName: regex },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [assets, total] = await Promise.all([
      Asset.find(query)
        .populate('vendorId', 'name phone')
        .populate('assignedTo', 'name email phone')
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

router.get('/assets/low-stock', checkPermission('inventory', 'view'), async (req, res) => {
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

router.get('/assets/:id', checkPermission('inventory', 'view'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const asset = await Asset.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    )
      .populate('vendorId', 'name phone email')
      .populate('assignedTo', 'name email phone');

    if (!asset) return res.status(404).json({ error: req.t('common:routes.assetNotFound') });
    res.json(asset);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/assets', checkPermission('inventory', 'create'), async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/assets/:id', checkPermission('inventory', 'edit'), async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/assets/:id/assign', checkPermission('inventory', 'edit'), async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/assets/:id/stock-adjust', checkPermission('inventory', 'edit'), async (req, res) => {
  try {
    const data = stockAdjustSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const asset = await Asset.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!asset) return res.status(404).json({ error: req.t('common:routes.assetNotFound') });

    const previousQuantity = asset.quantity;
    const newQuantity =
      data.type === 'IN' ? previousQuantity + data.quantity : previousQuantity - data.quantity;

    if (newQuantity < 0) {
      return res.status(400).json({ success: false, error: 'Stock cannot go below 0' });
    }

    const [updatedAsset, transaction] = await Promise.all([
      Asset.findByIdAndUpdate(
        asset._id,
        { quantity: newQuantity, updatedBy: req.user._id },
        { new: true }
      ),
      InventoryTransaction.create({
        schoolId: asset.schoolId,
        assetId: asset._id,
        type: data.type,
        quantity: data.quantity,
        previousQuantity,
        newQuantity,
        reason: data.reason,
        notes: data.notes,
        performedBy: req.user._id,
      }),
    ]);

    res.json({ asset: updatedAsset, transaction });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/assets/:id/depreciation', checkPermission('inventory', 'view'), async (req, res) => {
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

    // Use the model's static method which supports both depreciation methods
    const currentValue = Asset.calculateDepreciatedValue(asset);
    const totalDepreciation = asset.purchasePrice - currentValue;

    // Persist the computed currentValue so reports stay fresh
    if (asset.currentValue !== currentValue) {
      asset.currentValue = currentValue;
      await asset.save();
    }

    res.json({
      assetId: asset._id,
      name: asset.name,
      purchasePrice: asset.purchasePrice,
      purchaseDate: asset.purchaseDate,
      depreciationRate: rate,
      depreciationMethod: asset.depreciationMethod || 'DECLINING_BALANCE',
      yearsElapsed: Math.round(yearsElapsed * 100) / 100,
      currentValue,
      totalDepreciation: Math.round(totalDepreciation * 100) / 100,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/assets/:id', checkPermission('inventory', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const assetSnapshot = await Asset.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    ).lean();

    const asset = await Asset.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isDeleted: true, updatedBy: req.user._id },
      { new: true }
    );

    if (!asset) return res.status(404).json({ error: req.t('common:routes.assetNotFound') });

    if (assetSnapshot) {
      logToTrash({
        itemType: 'Asset',
        itemId: assetSnapshot._id,
        itemName: assetSnapshot.name || 'Unnamed Asset',
        originalData: assetSnapshot,
        deletedBy: req.user?._id || req.user?.id,
        schoolId,
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── ASSET CATEGORIES ─────────────────────────────────────────────────────────

router.get('/categories', checkPermission('inventory', 'view'), async (req, res) => {
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

router.post('/categories', checkPermission('inventory', 'create'), async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.categoryWithThisNameAlreadyExists'),
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/categories/:id', checkPermission('inventory', 'edit'), async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/categories/:id', checkPermission('inventory', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const categorySnapshot = await AssetCategory.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    ).lean();

    const category = await AssetCategory.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isDeleted: true, updatedBy: req.user._id },
      { new: true }
    );

    if (!category) return res.status(404).json({ error: req.t('common:routes.categoryNotFound') });

    if (categorySnapshot) {
      logToTrash({
        itemType: 'AssetCategory',
        itemId: categorySnapshot._id,
        itemName: categorySnapshot.name || 'Unnamed Category',
        originalData: categorySnapshot,
        deletedBy: req.user?._id || req.user?.id,
        schoolId,
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── VENDORS ─────────────────────────────────────────────────────────────────

router.get('/vendors', checkPermission('inventory', 'view'), async (req, res) => {
  try {
    const { search } = req.query;
    const schoolId = req.user.schoolId;
    const query = scopeBySchool(schoolId, { isDeleted: { $ne: true } });

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ name: regex }, { contactPerson: regex }, { phone: regex }];
    }

    const vendors = await Vendor.find(query).sort({ name: 1 });
    res.json(vendors);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/vendors', checkPermission('inventory', 'create'), async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/vendors/:id', checkPermission('inventory', 'edit'), async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/vendors/:id', checkPermission('inventory', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const vendorId = req.params.id;

    // Check for dependent records before deleting
    const [activeAssets, activeMaintenance, activeProcurement] = await Promise.all([
      Asset.countDocuments(scopeBySchool(schoolId, { vendorId, isDeleted: { $ne: true } })),
      MaintenanceLog.countDocuments(
        scopeBySchool(schoolId, { vendorId, isDeleted: { $ne: true } })
      ),
      ProcurementRequest.countDocuments(
        scopeBySchool(schoolId, { vendorId, isDeleted: { $ne: true } })
      ),
    ]);

    if (activeAssets > 0 || activeMaintenance > 0 || activeProcurement > 0) {
      const deps = [];
      if (activeAssets > 0) deps.push(`${activeAssets} asset(s)`);
      if (activeMaintenance > 0) deps.push(`${activeMaintenance} maintenance log(s)`);
      if (activeProcurement > 0) deps.push(`${activeProcurement} procurement request(s)`);
      return res.status(400).json({
        success: false,
        error: `Cannot delete vendor. It is referenced by ${deps.join(', ')}. Please reassign or remove them first.`,
      });
    }

    const vendorSnapshot = await Vendor.findOne(
      scopeBySchool(schoolId, { _id: vendorId, isDeleted: { $ne: true } })
    ).lean();

    const vendor = await Vendor.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: vendorId, isDeleted: { $ne: true } }),
      { isDeleted: true, updatedBy: req.user._id },
      { new: true }
    );

    if (!vendor) return res.status(404).json({ error: req.t('common:routes.vendorNotFound') });

    if (vendorSnapshot) {
      logToTrash({
        itemType: 'Vendor',
        itemId: vendorSnapshot._id,
        itemName: vendorSnapshot.name || 'Unnamed Vendor',
        originalData: vendorSnapshot,
        deletedBy: req.user?._id || req.user?.id,
        schoolId,
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── MAINTENANCE LOGS ─────────────────────────────────────────────────────────

router.get('/maintenance', checkPermission('inventory', 'view'), async (req, res) => {
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

router.post('/maintenance', checkPermission('inventory', 'create'), async (req, res) => {
  try {
    const data = createMaintenanceLogSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const log = await MaintenanceLog.create({
      ...data,
      schoolId: extractSchoolId(schoolId),
      createdBy: req.user._id,
    });

    // Update asset status only when maintenance is actively in progress (not when just scheduled)
    if (data.status === 'IN_PROGRESS') {
      await Asset.findOneAndUpdate(
        scopeBySchool(schoolId, { _id: data.assetId, isDeleted: { $ne: true } }),
        { status: 'UNDER_MAINTENANCE' }
      );
    }

    res.status(201).json(log);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/maintenance/:id', checkPermission('inventory', 'edit'), async (req, res) => {
  try {
    const data = updateMaintenanceLogSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    const log = await MaintenanceLog.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { ...data, updatedBy: req.user._id },
      { new: true, runValidators: true }
    );

    if (!log) return res.status(404).json({ error: req.t('common:routes.maintenanceLogNotFound') });

    // If completed, only restore asset to ACTIVE if no other active maintenance logs exist
    if (data.status === 'COMPLETED') {
      const otherActiveLogs = await MaintenanceLog.countDocuments(
        scopeBySchool(schoolId, {
          assetId: log.assetId,
          _id: { $ne: log._id },
          status: { $nin: ['COMPLETED', 'CANCELLED'] },
          isDeleted: { $ne: true },
        })
      );
      if (otherActiveLogs === 0) {
        await Asset.findOneAndUpdate(
          scopeBySchool(schoolId, { _id: log.assetId, isDeleted: { $ne: true } }),
          { status: 'ACTIVE' }
        );
      }
    }

    res.json(log);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/maintenance/:id', checkPermission('inventory', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    const logSnapshot = await MaintenanceLog.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    ).lean();

    const log = await MaintenanceLog.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isDeleted: true, deletedAt: new Date(), deletedBy: req.user._id },
      { new: true }
    );

    if (!log) return res.status(404).json({ error: req.t('common:routes.maintenanceLogNotFound') });

    if (logSnapshot) {
      logToTrash({
        itemType: 'MaintenanceLog',
        itemId: logSnapshot._id,
        itemName: logSnapshot.description || 'Unnamed Maintenance Log',
        originalData: logSnapshot,
        deletedBy: req.user?._id || req.user?.id,
        schoolId,
      }).catch(() => {});
    }

    // If the log was for an active maintenance, restore asset status
    if (log.status !== 'COMPLETED') {
      await Asset.findOneAndUpdate(
        scopeBySchool(schoolId, { _id: log.assetId, isDeleted: { $ne: true } }),
        { status: 'ACTIVE' }
      );
    }

    res.json({ success: true, message: 'Maintenance log deleted' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ─── PROCUREMENT ─────────────────────────────────────────────────────────────

router.get('/procurement', checkPermission('inventory', 'view'), async (req, res) => {
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

router.post('/procurement', checkPermission('inventory', 'create'), async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

// Allowed procurement status transitions
const PROCUREMENT_TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['ORDERED', 'CANCELLED'],
  REJECTED: ['CANCELLED'],
  ORDERED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['CANCELLED'],
  PURCHASED: ['CANCELLED'],
  CANCELLED: [],
};

router.put('/procurement/:id', checkPermission('inventory', 'edit'), async (req, res) => {
  try {
    const data = updateProcurementSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    // Validate status transition if status is being changed
    if (data.status) {
      const existing = await ProcurementRequest.findOne(
        scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
      );
      if (!existing)
        return res.status(404).json({ error: req.t('common:routes.procurementRequestNotFound') });

      const currentStatus = existing.status || 'PENDING';
      const allowed = PROCUREMENT_TRANSITIONS[currentStatus] || [];
      if (data.status !== currentStatus && !allowed.includes(data.status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status transition from ${currentStatus} to ${data.status}. Allowed: ${allowed.join(', ') || 'none'}`,
        });
      }
    }

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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/procurement/:id', checkPermission('inventory', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;
    const requestSnapshot = await ProcurementRequest.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    ).lean();

    const request = await ProcurementRequest.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      { isDeleted: true, updatedBy: req.user._id },
      { new: true }
    );

    if (!request)
      return res.status(404).json({ error: req.t('common:routes.procurementRequestNotFound') });

    if (requestSnapshot) {
      logToTrash({
        itemType: 'ProcurementRequest',
        itemId: requestSnapshot._id,
        itemName: requestSnapshot.itemName || 'Unnamed Procurement Request',
        originalData: requestSnapshot,
        deletedBy: req.user?._id || req.user?.id,
        schoolId,
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── ASSET AUDITS ─────────────────────────────────────────────────────────────

router.get('/audits', checkPermission('inventory', 'view'), async (req, res) => {
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

router.post('/audits', checkPermission('inventory', 'create'), async (req, res) => {
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.put('/audits/:id', checkPermission('inventory', 'edit'), async (req, res) => {
  try {
    const data = updateAssetAuditSchema.parse(req.body);
    const schoolId = req.user.schoolId;

    // Auto-set completedDate when audit is completed
    const updatePayload = { ...data, updatedBy: req.user._id };
    if (data.status === 'COMPLETED') {
      updatePayload.completedDate = new Date();
    }

    const audit = await AssetAudit.findOneAndUpdate(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } }),
      updatePayload,
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
      return res.status(400).json({
        success: false,
        error: req.t('common:routes.validationFailed'),
        details: error.errors,
      });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

router.delete('/audits/:id', checkPermission('inventory', 'delete'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    // Prevent deleting IN_PROGRESS audits
    const existing = await AssetAudit.findOne(
      scopeBySchool(schoolId, { _id: req.params.id, isDeleted: { $ne: true } })
    );
    if (!existing) return res.status(404).json({ error: req.t('common:routes.auditNotFound') });
    if (existing.status === 'IN_PROGRESS') {
      return res.status(400).json({
        error: 'Cannot delete an audit that is in progress. Complete or cancel it first.',
      });
    }

    const auditSnapshot = existing.toObject();

    existing.isDeleted = true;
    existing.updatedBy = req.user._id;
    await existing.save();

    if (auditSnapshot) {
      logToTrash({
        itemType: 'AssetAudit',
        itemId: auditSnapshot._id,
        itemName: auditSnapshot.name || 'Unnamed Asset Audit',
        originalData: auditSnapshot,
        deletedBy: req.user?._id || req.user?.id,
        schoolId,
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── REPORTS ─────────────────────────────────────────────────────────────────

router.get('/reports', checkPermission('inventory', 'view'), async (req, res) => {
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
            $addFields: {
              _yearsElapsed: {
                $cond: {
                  if: {
                    $and: [
                      { $gt: ['$purchaseDate', null] },
                      { $gt: ['$purchasePrice', 0] },
                      { $gt: ['$depreciationRate', 0] },
                    ],
                  },
                  then: {
                    $divide: [
                      { $subtract: [new Date(), '$purchaseDate'] },
                      1000 * 60 * 60 * 24 * 365.25,
                    ],
                  },
                  else: 0,
                },
              },
            },
          },
          {
            $addFields: {
              _computedCurrentValue: {
                $cond: {
                  if: { $gt: ['$_yearsElapsed', 0] },
                  then: {
                    $max: [
                      0,
                      {
                        $multiply: [
                          '$purchasePrice',
                          {
                            $pow: [
                              { $subtract: [1, { $divide: ['$depreciationRate', 100] }] },
                              '$_yearsElapsed',
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  else: { $ifNull: ['$purchasePrice', 0] },
                },
              },
            },
          },
          {
            $group: {
              _id: null,
              totalPurchaseValue: { $sum: { $ifNull: ['$purchasePrice', 0] } },
              totalCurrentValue: { $sum: '$_computedCurrentValue' },
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
