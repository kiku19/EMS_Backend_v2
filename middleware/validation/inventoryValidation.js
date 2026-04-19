import { z } from 'zod';

const ASSET_STATUSES = ['ACTIVE', 'UNDER_MAINTENANCE', 'DISPOSED', 'LOST'];
const ASSET_CONDITIONS = ['GOOD', 'FAIR', 'POOR', 'DAMAGED'];
const MAINTENANCE_TYPES = ['PREVENTIVE', 'CORRECTIVE', 'INSPECTION'];
const MAINTENANCE_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const PROCUREMENT_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'ORDERED',
  'RECEIVED',
  'PURCHASED',
  'CANCELLED',
];
const AUDIT_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const DEPRECIATION_METHODS = ['STRAIGHT_LINE', 'DECLINING_BALANCE'];

export const createAssetSchema = z.object({
  assetTag: z.string().trim().max(50).optional(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100),
  serialNumber: z.string().trim().max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  location: z.string().trim().max(200).optional(),
  assignedTo: z
    .string()
    .regex(objectIdRegex, 'assignedTo must be a valid Staff ID')
    .optional()
    .nullable(),
  assignedToName: z.string().trim().max(200).optional(),
  quantity: z.number().int().min(0).default(1),
  minimumQuantity: z.number().int().min(0).optional(),
  purchaseDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
    )
    .optional(),
  purchasePrice: z.number().min(0).optional(),
  currentValue: z.number().min(0).optional(),
  depreciationRate: z.number().min(0).max(100).optional(),
  depreciationMethod: z.enum(DEPRECIATION_METHODS).default('DECLINING_BALANCE').optional(),
  usefulLifeYears: z.number().min(0).optional(),
  warrantyExpiry: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
    )
    .optional(),
  vendorId: z.string().regex(objectIdRegex).optional(),
  condition: z.enum(ASSET_CONDITIONS).default('GOOD'),
  status: z.enum(ASSET_STATUSES).default('ACTIVE'),
  notes: z.string().trim().max(1000).optional(),
});

export const updateAssetSchema = createAssetSchema.partial();

export const assignAssetSchema = z.object({
  assignedTo: z.string().regex(objectIdRegex, 'assignedTo must be a valid Staff ID'),
});

export const createVendorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactPerson: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().email().max(200).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional(),
  category: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
  isActive: z.boolean().default(true),
});

export const updateVendorSchema = createVendorSchema.partial();

export const createMaintenanceLogSchema = z.object({
  assetId: z.string().regex(objectIdRegex),
  maintenanceType: z.enum(MAINTENANCE_TYPES),
  description: z.string().trim().min(1).max(1000),
  scheduledDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'scheduledDate must be YYYY-MM-DD or ISO 8601')),
  completedDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'completedDate must be YYYY-MM-DD or ISO 8601'))
    .optional(),
  cost: z.number().min(0).optional(),
  status: z.enum(MAINTENANCE_STATUSES).default('SCHEDULED'),
  vendorId: z.string().regex(objectIdRegex).optional(),
  performedBy: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const updateMaintenanceLogSchema = createMaintenanceLogSchema.partial();

export const createProcurementSchema = z.object({
  itemName: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100).optional(),
  quantity: z.number().int().min(1),
  estimatedCost: z.number().min(0).optional(),
  actualCost: z.number().min(0).optional(),
  justification: z.string().trim().max(1000).optional(),
  status: z.enum(PROCUREMENT_STATUSES).default('PENDING'),
  vendorId: z.string().regex(objectIdRegex).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const updateProcurementSchema = createProcurementSchema.partial();

export const createAssetCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
});

export const updateAssetCategorySchema = createAssetCategorySchema.partial();

const auditItemSchema = z.object({
  assetId: z.string().regex(objectIdRegex),
  expectedQuantity: z.number().min(0).optional(),
  actualQuantity: z.number().min(0).optional(),
  condition: z.enum(ASSET_CONDITIONS).optional(),
  notes: z.string().trim().max(500).optional(),
  verifiedBy: z.string().trim().max(200).optional(),
});

export const createAssetAuditSchema = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.enum(AUDIT_STATUSES).default('PENDING'),
  startDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
    )
    .optional(),
  completedDate: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
    )
    .optional(),
  auditItems: z.array(auditItemSchema).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const updateAssetAuditSchema = createAssetAuditSchema.partial();

export const stockAdjustSchema = z.object({
  type: z.enum(['IN', 'OUT']),
  quantity: z.number().int('Must be a whole number').min(1, 'Must be at least 1'),
  reason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});
