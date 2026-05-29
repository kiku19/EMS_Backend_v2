import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import Asset from '../models/Asset.js';
import AssetCategory from '../models/AssetCategory.js';
import Vendor from '../models/Vendor.js';
import MaintenanceLog from '../models/MaintenanceLog.js';
import ProcurementRequest from '../models/ProcurementRequest.js';
import AssetAudit from '../models/AssetAudit.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import { authHeadersFor, createSchoolRecord, createStaffUser } from './helpers/factories.js';
import { createTestApp } from './helpers/testApp.js';

vi.mock('../services/trashService.js', () => ({
  logToTrash: vi.fn().mockResolvedValue(undefined),
}));

let seq = 0;
function nextSeq() {
  return ++seq;
}

async function setup() {
  const school = await createSchoolRecord({
    name: `Inventory School ${nextSeq()}`,
    code: `IS-${nextSeq()}`,
  });
  const admin = await createStaffUser({ schoolId: school._id });
  const { app } = createTestApp();
  const headers = authHeadersFor(admin, 'admin');
  return { school, admin, app, headers };
}

function buildAssetPayload(overrides = {}) {
  return {
    name: `Asset ${nextSeq()}`,
    category: 'Furniture',
    assetTag: `TAG-${nextSeq()}`,
    serialNumber: `SN-${nextSeq()}`,
    description: 'Test asset',
    location: 'Room 101',
    quantity: 5,
    minimumQuantity: 2,
    purchasePrice: 1000,
    purchaseDate: '2024-01-01',
    condition: 'GOOD',
    status: 'ACTIVE',
    ...overrides,
  };
}

function buildVendorPayload(overrides = {}) {
  return {
    name: `Vendor ${nextSeq()}`,
    contactPerson: 'Contact Person',
    phone: '9876543210',
    email: 'vendor@example.com',
    address: 'Vendor Address',
    category: 'Furniture',
    notes: 'Test vendor',
    ...overrides,
  };
}

function buildMaintenancePayload(assetId, overrides = {}) {
  return {
    assetId: assetId.toString(),
    maintenanceType: 'PREVENTIVE',
    description: 'Regular maintenance',
    scheduledDate: '2025-06-15',
    cost: 500,
    status: 'SCHEDULED',
    performedBy: 'Technician',
    notes: 'Test maintenance',
    ...overrides,
  };
}

function buildProcurementPayload(overrides = {}) {
  return {
    itemName: `Item ${nextSeq()}`,
    category: 'FURNITURE',
    quantity: 10,
    estimatedCost: 5000,
    justification: 'Need more chairs',
    status: 'PENDING',
    notes: 'Test procurement',
    ...overrides,
  };
}

function buildCategoryPayload(overrides = {}) {
  return {
    name: `Category ${nextSeq()}`,
    description: 'Test category',
    ...overrides,
  };
}

function buildAuditPayload(overrides = {}) {
  return {
    title: `Audit ${nextSeq()}`,
    status: 'PENDING',
    startDate: '2025-06-01',
    notes: 'Test audit',
    ...overrides,
  };
}

async function createAssetDirect(schoolId, overrides = {}) {
  return Asset.create({
    schoolId,
    name: `Direct Asset ${nextSeq()}`,
    category: 'Electronics',
    quantity: 1,
    assetTag: `TAG-${nextSeq()}`,
    ...overrides,
  });
}

async function createVendorDirect(schoolId, overrides = {}) {
  return Vendor.create({
    schoolId,
    name: `Direct Vendor ${nextSeq()}`,
    ...overrides,
  });
}

async function createCategoryDirect(schoolId, overrides = {}) {
  return AssetCategory.create({
    schoolId,
    name: `Direct Category ${nextSeq()}`,
    ...overrides,
  });
}

async function createMaintenanceDirect(schoolId, assetId, overrides = {}) {
  return MaintenanceLog.create({
    schoolId,
    assetId,
    maintenanceType: 'PREVENTIVE',
    description: 'Test maintenance',
    scheduledDate: new Date('2025-06-15'),
    ...overrides,
  });
}

async function createProcurementDirect(schoolId, overrides = {}) {
  return ProcurementRequest.create({
    schoolId,
    itemName: `Direct Item ${nextSeq()}`,
    quantity: 5,
    ...overrides,
  });
}

async function createAuditDirect(schoolId, overrides = {}) {
  return AssetAudit.create({
    schoolId,
    title: `Direct Audit ${nextSeq()}`,
    ...overrides,
  });
}

describe('inventory routes', () => {
  // ─── Auth ──────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 when no auth token is provided', async () => {
      const { app } = createTestApp();
      await request(app).get('/api/inventory/assets').expect(401);
      await request(app).post('/api/inventory/assets').send(buildAssetPayload()).expect(401);
      await request(app).get('/api/inventory/vendors').expect(401);
      await request(app).get('/api/inventory/stats').expect(401);
    });
  });

  // ─── Stats ─────────────────────────────────────────────────────────────
  describe('GET /api/inventory/stats', () => {
    it('returns inventory statistics', async () => {
      const { school, app, headers } = await setup();
      await createAssetDirect(school._id, { status: 'ACTIVE' });
      await createVendorDirect(school._id);
      await createProcurementDirect(school._id, { status: 'PENDING' });

      const res = await request(app).get('/api/inventory/stats').set(headers).expect(200);

      expect(res.body).toHaveProperty('totalAssets');
      expect(res.body).toHaveProperty('activeAssets');
      expect(res.body).toHaveProperty('underMaintenance');
      expect(res.body).toHaveProperty('pendingProcurements');
      expect(res.body).toHaveProperty('totalVendors');
      expect(res.body).toHaveProperty('lowStockAssets');
    });
  });

  // ─── Assets ────────────────────────────────────────────────────────────
  describe('GET /api/inventory/assets', () => {
    it('returns paginated assets', async () => {
      const { school, app, headers } = await setup();
      await createAssetDirect(school._id, { name: 'Asset A' });
      await createAssetDirect(school._id, { name: 'Asset B' });

      const res = await request(app).get('/api/inventory/assets').set(headers).expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
    });

    it('filters assets by category', async () => {
      const { school, app, headers } = await setup();
      await createAssetDirect(school._id, { name: 'Furniture', category: 'Furniture' });
      await createAssetDirect(school._id, { name: 'Electronics', category: 'Electronics' });

      const res = await request(app)
        .get('/api/inventory/assets')
        .query({ category: 'Electronics' })
        .set(headers)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].category).toBe('Electronics');
    });

    it('searches assets by name', async () => {
      const { school, app, headers } = await setup();
      await createAssetDirect(school._id, { name: 'Alpha Asset' });
      await createAssetDirect(school._id, { name: 'Beta Asset' });

      const res = await request(app)
        .get('/api/inventory/assets')
        .query({ search: 'Alpha' })
        .set(headers)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Alpha Asset');
    });

    it('filters assets by status', async () => {
      const { school, app, headers } = await setup();
      await createAssetDirect(school._id, { name: 'Active', status: 'ACTIVE' });
      await createAssetDirect(school._id, { name: 'Disposed', status: 'DISPOSED' });

      const res = await request(app)
        .get('/api/inventory/assets')
        .query({ status: 'ACTIVE' })
        .set(headers)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].status).toBe('ACTIVE');
    });
  });

  describe('GET /api/inventory/assets/low-stock', () => {
    it('returns low-stock assets', async () => {
      const { school, app, headers } = await setup();
      await createAssetDirect(school._id, {
        name: 'Low',
        assetTag: 'LOW-1',
        quantity: 1,
        minimumQuantity: 2,
      });
      await createAssetDirect(school._id, {
        name: 'Normal',
        assetTag: 'NORM-1',
        quantity: 10,
        minimumQuantity: 2,
      });

      const res = await request(app)
        .get('/api/inventory/assets/low-stock')
        .set(headers)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('Low');
    });
  });

  describe('GET /api/inventory/assets/:id', () => {
    it('returns an asset by id', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id, { name: 'Detail Asset' });

      const res = await request(app)
        .get(`/api/inventory/assets/${asset._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.name).toBe('Detail Asset');
    });

    it('returns 404 for non-existent asset', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).get(`/api/inventory/assets/${fakeId}`).set(headers).expect(404);
    });
  });

  describe('POST /api/inventory/assets', () => {
    it('creates a new asset', async () => {
      const { school, app, headers } = await setup();
      const payload = buildAssetPayload();

      const res = await request(app)
        .post('/api/inventory/assets')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.name).toBe(payload.name);
      expect(res.body.category).toBe(payload.category);
      expect(res.body.schoolId.toString()).toBe(school._id.toString());
    });

    it('returns 400 for invalid payload', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/inventory/assets')
        .set(headers)
        .send({ name: '' })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PUT /api/inventory/assets/:id', () => {
    it('updates an asset', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id);

      const res = await request(app)
        .put(`/api/inventory/assets/${asset._id}`)
        .set(headers)
        .send({ name: 'Updated Asset', location: 'New Room' })
        .expect(200);

      expect(res.body.name).toBe('Updated Asset');
      expect(res.body.location).toBe('New Room');
    });

    it('returns 404 for non-existent asset', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/inventory/assets/${fakeId}`)
        .set(headers)
        .send({ name: 'X' })
        .expect(404);
    });
  });

  describe('PUT /api/inventory/assets/:id/assign', () => {
    it('assigns an asset to a staff member', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id);
      const staff = await createStaffUser({ schoolId: school._id });

      const res = await request(app)
        .put(`/api/inventory/assets/${asset._id}/assign`)
        .set(headers)
        .send({ assignedTo: staff._id.toString() })
        .expect(200);

      expect(res.body.assignedTo.toString()).toBe(staff._id.toString());
    });

    it('returns 400 for invalid assignedTo', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id);

      const res = await request(app)
        .put(`/api/inventory/assets/${asset._id}/assign`)
        .set(headers)
        .send({ assignedTo: 'invalid-id' })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('POST /api/inventory/assets/:id/stock-adjust', () => {
    it('adjusts stock IN', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id, { quantity: 10 });

      const res = await request(app)
        .post(`/api/inventory/assets/${asset._id}/stock-adjust`)
        .set(headers)
        .send({ type: 'IN', quantity: 5, reason: 'Restocked' })
        .expect(200);

      expect(res.body.asset.quantity).toBe(15);
      expect(res.body.transaction).toBeTruthy();
    });

    it('adjusts stock OUT', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id, { quantity: 10 });

      const res = await request(app)
        .post(`/api/inventory/assets/${asset._id}/stock-adjust`)
        .set(headers)
        .send({ type: 'OUT', quantity: 3, reason: 'Damaged' })
        .expect(200);

      expect(res.body.asset.quantity).toBe(7);
    });

    it('returns 400 when stock goes below 0', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id, { quantity: 2 });

      const res = await request(app)
        .post(`/api/inventory/assets/${asset._id}/stock-adjust`)
        .set(headers)
        .send({ type: 'OUT', quantity: 5 })
        .expect(400);

      expect(res.body.error).toMatch(/below 0/i);
    });
  });

  describe('GET /api/inventory/assets/:id/depreciation', () => {
    it('returns depreciation info', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id, {
        purchasePrice: 10000,
        purchaseDate: new Date('2020-01-01'),
        depreciationRate: 10,
      });

      const res = await request(app)
        .get(`/api/inventory/assets/${asset._id}/depreciation`)
        .set(headers)
        .expect(200);

      expect(res.body).toHaveProperty('assetId');
      expect(res.body).toHaveProperty('currentValue');
      expect(res.body).toHaveProperty('totalDepreciation');
    });

    it('returns message when purchase data is missing', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id);

      const res = await request(app)
        .get(`/api/inventory/assets/${asset._id}/depreciation`)
        .set(headers)
        .expect(200);

      expect(res.body.depreciation).toBeNull();
    });

    it('returns 404 for non-existent asset', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .get(`/api/inventory/assets/${fakeId}/depreciation`)
        .set(headers)
        .expect(404);
    });
  });

  describe('DELETE /api/inventory/assets/:id', () => {
    it('soft-deletes an asset', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id);

      const res = await request(app)
        .delete(`/api/inventory/assets/${asset._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      const deleted = await Asset.findById(asset._id);
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 for non-existent asset', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/inventory/assets/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Categories ────────────────────────────────────────────────────────
  describe('GET /api/inventory/categories', () => {
    it('returns categories', async () => {
      const { school, app, headers } = await setup();
      await createCategoryDirect(school._id, { name: 'Cat A' });
      await createCategoryDirect(school._id, { name: 'Cat B' });

      const res = await request(app).get('/api/inventory/categories').set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });

  describe('POST /api/inventory/categories', () => {
    it('creates a category', async () => {
      const { app, headers } = await setup();
      const payload = buildCategoryPayload();

      const res = await request(app)
        .post('/api/inventory/categories')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.name).toBe(payload.name);
    });

    it('returns 400 for duplicate category name', async () => {
      const { school, app, headers } = await setup();
      await createCategoryDirect(school._id, { name: 'DupCat' });

      const res = await request(app)
        .post('/api/inventory/categories')
        .set(headers)
        .send({ name: 'DupCat' })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PUT /api/inventory/categories/:id', () => {
    it('updates a category', async () => {
      const { school, app, headers } = await setup();
      const category = await createCategoryDirect(school._id);

      const res = await request(app)
        .put(`/api/inventory/categories/${category._id}`)
        .set(headers)
        .send({ description: 'Updated desc' })
        .expect(200);

      expect(res.body.description).toBe('Updated desc');
    });

    it('returns 404 for non-existent category', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/inventory/categories/${fakeId}`)
        .set(headers)
        .send({ name: 'X' })
        .expect(404);
    });
  });

  describe('DELETE /api/inventory/categories/:id', () => {
    it('soft-deletes a category', async () => {
      const { school, app, headers } = await setup();
      const category = await createCategoryDirect(school._id);

      const res = await request(app)
        .delete(`/api/inventory/categories/${category._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      const deleted = await AssetCategory.findById(category._id);
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 for non-existent category', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/inventory/categories/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Vendors ───────────────────────────────────────────────────────────
  describe('GET /api/inventory/vendors', () => {
    it('returns vendors', async () => {
      const { school, app, headers } = await setup();
      await createVendorDirect(school._id, { name: 'Vendor A' });
      await createVendorDirect(school._id, { name: 'Vendor B' });

      const res = await request(app).get('/api/inventory/vendors').set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('searches vendors by name', async () => {
      const { school, app, headers } = await setup();
      await createVendorDirect(school._id, { name: 'Alpha Vendor' });
      await createVendorDirect(school._id, { name: 'Beta Vendor' });

      const res = await request(app)
        .get('/api/inventory/vendors')
        .query({ search: 'Alpha' })
        .set(headers)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Alpha Vendor');
    });
  });

  describe('POST /api/inventory/vendors', () => {
    it('creates a vendor', async () => {
      const { app, headers } = await setup();
      const payload = buildVendorPayload();

      const res = await request(app)
        .post('/api/inventory/vendors')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.name).toBe(payload.name);
    });

    it('returns 400 for invalid payload', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/inventory/vendors')
        .set(headers)
        .send({ name: '' })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PUT /api/inventory/vendors/:id', () => {
    it('updates a vendor', async () => {
      const { school, app, headers } = await setup();
      const vendor = await createVendorDirect(school._id);

      const res = await request(app)
        .put(`/api/inventory/vendors/${vendor._id}`)
        .set(headers)
        .send({ phone: '9111222333' })
        .expect(200);

      expect(res.body.phone).toBe('9111222333');
    });

    it('returns 404 for non-existent vendor', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/inventory/vendors/${fakeId}`)
        .set(headers)
        .send({ name: 'X' })
        .expect(404);
    });
  });

  describe('DELETE /api/inventory/vendors/:id', () => {
    it('returns 400 when vendor has dependent records', async () => {
      const { school, app, headers } = await setup();
      const vendor = await createVendorDirect(school._id);
      await createAssetDirect(school._id, { vendorId: vendor._id });

      const res = await request(app)
        .delete(`/api/inventory/vendors/${vendor._id}`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toMatch(/referenced by/i);
    });

    it('soft-deletes a vendor without dependents', async () => {
      const { school, app, headers } = await setup();
      const vendor = await createVendorDirect(school._id);

      const res = await request(app)
        .delete(`/api/inventory/vendors/${vendor._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      const deleted = await Vendor.findById(vendor._id);
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 for non-existent vendor', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/inventory/vendors/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Maintenance ───────────────────────────────────────────────────────
  describe('GET /api/inventory/maintenance', () => {
    it('returns maintenance logs', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id);
      await createMaintenanceDirect(school._id, asset._id);

      const res = await request(app).get('/api/inventory/maintenance').set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });

    it('filters by assetId', async () => {
      const { school, app, headers } = await setup();
      const asset1 = await createAssetDirect(school._id, { assetTag: 'A1' });
      const asset2 = await createAssetDirect(school._id, { assetTag: 'A2' });
      await createMaintenanceDirect(school._id, asset1._id);
      await createMaintenanceDirect(school._id, asset2._id);

      const res = await request(app)
        .get('/api/inventory/maintenance')
        .query({ assetId: asset1._id.toString() })
        .set(headers)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });
  });

  describe('POST /api/inventory/maintenance', () => {
    it('creates a maintenance log', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id);
      const payload = buildMaintenancePayload(asset._id);

      const res = await request(app)
        .post('/api/inventory/maintenance')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.description).toBe(payload.description);
    });

    it('returns 400 for invalid payload', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/inventory/maintenance')
        .set(headers)
        .send({ description: '' })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PUT /api/inventory/maintenance/:id', () => {
    it('updates a maintenance log', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id);
      const log = await createMaintenanceDirect(school._id, asset._id);

      const res = await request(app)
        .put(`/api/inventory/maintenance/${log._id}`)
        .set(headers)
        .send({ cost: 1000, notes: 'Updated' })
        .expect(200);

      expect(res.body.cost).toBe(1000);
      expect(res.body.notes).toBe('Updated');
    });

    it('returns 404 for non-existent log', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/inventory/maintenance/${fakeId}`)
        .set(headers)
        .send({ cost: 100 })
        .expect(404);
    });
  });

  describe('DELETE /api/inventory/maintenance/:id', () => {
    it('soft-deletes a maintenance log', async () => {
      const { school, app, headers } = await setup();
      const asset = await createAssetDirect(school._id);
      const log = await createMaintenanceDirect(school._id, asset._id);

      const res = await request(app)
        .delete(`/api/inventory/maintenance/${log._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      const deleted = await MaintenanceLog.findById(log._id);
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 for non-existent log', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/inventory/maintenance/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Procurement ───────────────────────────────────────────────────────
  describe('GET /api/inventory/procurement', () => {
    it('returns procurement requests', async () => {
      const { school, app, headers } = await setup();
      await createProcurementDirect(school._id, { itemName: 'Item A' });
      await createProcurementDirect(school._id, { itemName: 'Item B' });

      const res = await request(app).get('/api/inventory/procurement').set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('filters by status', async () => {
      const { school, app, headers } = await setup();
      await createProcurementDirect(school._id, { itemName: 'Pending', status: 'PENDING' });
      await createProcurementDirect(school._id, { itemName: 'Approved', status: 'APPROVED' });

      const res = await request(app)
        .get('/api/inventory/procurement')
        .query({ status: 'APPROVED' })
        .set(headers)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe('APPROVED');
    });
  });

  describe('POST /api/inventory/procurement', () => {
    it('creates a procurement request', async () => {
      const { app, headers } = await setup();
      const payload = buildProcurementPayload();

      const res = await request(app)
        .post('/api/inventory/procurement')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.itemName).toBe(payload.itemName);
      expect(res.body.status).toBe('PENDING');
    });

    it('returns 400 for invalid payload', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/inventory/procurement')
        .set(headers)
        .send({ itemName: '' })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PUT /api/inventory/procurement/:id', () => {
    it('updates a procurement request', async () => {
      const { school, app, headers } = await setup();
      const proc = await createProcurementDirect(school._id);

      const res = await request(app)
        .put(`/api/inventory/procurement/${proc._id}`)
        .set(headers)
        .send({ status: 'APPROVED' })
        .expect(200);

      expect(res.body.status).toBe('APPROVED');
    });

    it('returns 400 for invalid status transition', async () => {
      const { school, app, headers } = await setup();
      const proc = await createProcurementDirect(school._id, { status: 'PURCHASED' });

      const res = await request(app)
        .put(`/api/inventory/procurement/${proc._id}`)
        .set(headers)
        .send({ status: 'PENDING' })
        .expect(400);

      expect(res.body.error).toMatch(/invalid status transition/i);
    });

    it('returns 404 for non-existent procurement', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/inventory/procurement/${fakeId}`)
        .set(headers)
        .send({ status: 'APPROVED' })
        .expect(404);
    });
  });

  describe('DELETE /api/inventory/procurement/:id', () => {
    it('soft-deletes a procurement request', async () => {
      const { school, app, headers } = await setup();
      const proc = await createProcurementDirect(school._id);

      const res = await request(app)
        .delete(`/api/inventory/procurement/${proc._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      const deleted = await ProcurementRequest.findById(proc._id);
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 for non-existent procurement', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/inventory/procurement/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Audits ────────────────────────────────────────────────────────────
  describe('GET /api/inventory/audits', () => {
    it('returns asset audits', async () => {
      const { school, app, headers } = await setup();
      await createAuditDirect(school._id, { title: 'Audit A' });
      await createAuditDirect(school._id, { title: 'Audit B' });

      const res = await request(app).get('/api/inventory/audits').set(headers).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('filters by status', async () => {
      const { school, app, headers } = await setup();
      await createAuditDirect(school._id, { title: 'Pending', status: 'PENDING' });
      await createAuditDirect(school._id, { title: 'Completed', status: 'COMPLETED' });

      const res = await request(app)
        .get('/api/inventory/audits')
        .query({ status: 'COMPLETED' })
        .set(headers)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].status).toBe('COMPLETED');
    });
  });

  describe('POST /api/inventory/audits', () => {
    it('creates an asset audit', async () => {
      const { app, headers } = await setup();
      const payload = buildAuditPayload();

      const res = await request(app)
        .post('/api/inventory/audits')
        .set(headers)
        .send(payload)
        .expect(201);

      expect(res.body.title).toBe(payload.title);
    });

    it('returns 400 for invalid payload', async () => {
      const { app, headers } = await setup();
      const res = await request(app)
        .post('/api/inventory/audits')
        .set(headers)
        .send({ title: '' })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  describe('PUT /api/inventory/audits/:id', () => {
    it('updates an audit', async () => {
      const { school, app, headers } = await setup();
      const audit = await createAuditDirect(school._id);

      const res = await request(app)
        .put(`/api/inventory/audits/${audit._id}`)
        .set(headers)
        .send({ status: 'COMPLETED' })
        .expect(200);

      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.completedDate).toBeTruthy();
    });

    it('returns 404 for non-existent audit', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app)
        .put(`/api/inventory/audits/${fakeId}`)
        .set(headers)
        .send({ status: 'COMPLETED' })
        .expect(404);
    });
  });

  describe('DELETE /api/inventory/audits/:id', () => {
    it('returns 400 when deleting an in-progress audit', async () => {
      const { school, app, headers } = await setup();
      const audit = await createAuditDirect(school._id, { status: 'IN_PROGRESS' });

      const res = await request(app)
        .delete(`/api/inventory/audits/${audit._id}`)
        .set(headers)
        .expect(400);

      expect(res.body.error).toMatch(/in progress/i);
    });

    it('soft-deletes a pending audit', async () => {
      const { school, app, headers } = await setup();
      const audit = await createAuditDirect(school._id, { status: 'PENDING' });

      const res = await request(app)
        .delete(`/api/inventory/audits/${audit._id}`)
        .set(headers)
        .expect(200);

      expect(res.body.success).toBe(true);
      const deleted = await AssetAudit.findById(audit._id);
      expect(deleted.isDeleted).toBe(true);
    });

    it('returns 404 for non-existent audit', async () => {
      const { app, headers } = await setup();
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request(app).delete(`/api/inventory/audits/${fakeId}`).set(headers).expect(404);
    });
  });

  // ─── Reports ───────────────────────────────────────────────────────────
  describe('GET /api/inventory/reports', () => {
    it('returns inventory reports', async () => {
      const { school, app, headers } = await setup();
      await createAssetDirect(school._id, { category: 'Furniture', purchasePrice: 1000 });

      const res = await request(app).get('/api/inventory/reports').set(headers).expect(200);

      expect(res.body).toHaveProperty('totals');
      expect(res.body).toHaveProperty('categoryBreakdown');
      expect(res.body).toHaveProperty('conditionSummary');
      expect(res.body).toHaveProperty('statusSummary');
    });
  });

  // ─── Multi-tenancy ─────────────────────────────────────────────────────
  describe('Multi-tenancy', () => {
    it('School A admin cannot see School B assets', async () => {
      const schoolA = await createSchoolRecord({ name: 'Tenant A' });
      const schoolB = await createSchoolRecord({ name: 'Tenant B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      await createAssetDirect(schoolA._id, { name: 'Asset A' });
      await createAssetDirect(schoolB._id, { name: 'Asset B' });

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      const res = await request(app).get('/api/inventory/assets').set(headersA).expect(200);
      const names = res.body.data.map((a) => a.name);
      expect(names).toContain('Asset A');
      expect(names).not.toContain('Asset B');
    });

    it('School A admin cannot access School B asset by ID', async () => {
      const schoolA = await createSchoolRecord({ name: 'ISO A' });
      const schoolB = await createSchoolRecord({ name: 'ISO B' });
      const adminA = await createStaffUser({ schoolId: schoolA._id });
      const assetB = await createAssetDirect(schoolB._id);

      const { app } = createTestApp();
      const headersA = authHeadersFor(adminA, 'admin');

      await request(app).get(`/api/inventory/assets/${assetB._id}`).set(headersA).expect(404);
    });
  });
});
