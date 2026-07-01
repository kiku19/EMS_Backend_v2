/**
 * Unit tests for the global Mongoose tenant-scope plugin and async context.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { getCurrentSchoolId, runWithTenant } from '../utils/tenantAsyncContext.js';
import { createSchoolRecord } from './helpers/factories.js';

describe('Tenant async context', () => {
  it('returns null outside a tenant context', () => {
    expect(getCurrentSchoolId()).toBeNull();
  });

  it('returns the active schoolId inside a context', () => {
    const result = runWithTenant('school-123', () => getCurrentSchoolId());
    expect(result).toBe('school-123');
  });

  it('isolates nested contexts', () => {
    runWithTenant('outer', () => {
      expect(getCurrentSchoolId()).toBe('outer');
      runWithTenant('inner', () => {
        expect(getCurrentSchoolId()).toBe('inner');
      });
      expect(getCurrentSchoolId()).toBe('outer');
    });
  });
});

describe('Tenant-scope Mongoose plugin', () => {
  let TenantWidget;
  let GlobalWidget;

  beforeEach(() => {
    // A model that owns schoolId — should be auto-scoped.
    const tenantSchema = new mongoose.Schema(
      {
        name: String,
        schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School' },
      },
      { collection: `tenant_widgets_${Date.now()}` }
    );

    // A model without schoolId — should never be scoped.
    const globalSchema = new mongoose.Schema(
      {
        name: String,
      },
      { collection: `global_widgets_${Date.now()}` }
    );

    TenantWidget = mongoose.model(`TenantWidget_${Date.now()}`, tenantSchema);
    GlobalWidget = mongoose.model(`GlobalWidget_${Date.now()}`, globalSchema);
  });

  it('injects schoolId into find queries when a tenant context is active', async () => {
    const schoolA = await createSchoolRecord({ name: 'School A', code: 'TS-A' });
    const schoolB = await createSchoolRecord({ name: 'School B', code: 'TS-B' });
    const docB = await TenantWidget.create({ name: 'Widget B', schoolId: schoolB._id });

    await runWithTenant(schoolA._id.toString(), async () => {
      const found = await TenantWidget.findById(docB._id);
      expect(found).toBeNull();
    });

    await runWithTenant(schoolB._id.toString(), async () => {
      const found = await TenantWidget.findById(docB._id);
      expect(found).not.toBeNull();
      expect(found.name).toBe('Widget B');
    });
  });

  it('does not override an explicitly provided schoolId', async () => {
    const schoolA = await createSchoolRecord({ name: 'School A', code: 'TS-A2' });
    const schoolB = await createSchoolRecord({ name: 'School B', code: 'TS-B2' });
    await TenantWidget.create({ name: 'Widget A', schoolId: schoolA._id });
    const docB = await TenantWidget.create({ name: 'Widget B', schoolId: schoolB._id });

    await runWithTenant(schoolA._id.toString(), async () => {
      // Explicit schoolId wins over context
      const found = await TenantWidget.findOne({ _id: docB._id, schoolId: schoolB._id });
      expect(found).not.toBeNull();
      expect(found.name).toBe('Widget B');
    });
  });

  it('does not inject schoolId outside a tenant context', async () => {
    const school = await createSchoolRecord({ name: 'School C', code: 'TS-C' });
    const doc = await TenantWidget.create({ name: 'Widget C', schoolId: school._id });

    const found = await TenantWidget.findById(doc._id);
    expect(found).not.toBeNull();
    expect(found.name).toBe('Widget C');
  });

  it('does not inject schoolId into models that lack the field', async () => {
    const globalDoc = await GlobalWidget.create({ name: 'Global Widget' });

    await runWithTenant('some-school-id', async () => {
      const found = await GlobalWidget.findById(globalDoc._id);
      expect(found).not.toBeNull();
      expect(found.name).toBe('Global Widget');
    });
  });

  it('sets schoolId on new documents when context is active and field is unset', async () => {
    const school = await createSchoolRecord({ name: 'School D', code: 'TS-D' });

    const doc = await runWithTenant(school._id.toString(), async () => {
      return TenantWidget.create({ name: 'Auto-scoped Widget' });
    });

    expect(doc.schoolId.toString()).toBe(school._id.toString());
  });

  it('does not change schoolId when explicitly provided on create', async () => {
    const schoolA = await createSchoolRecord({ name: 'School E', code: 'TS-E' });
    const schoolB = await createSchoolRecord({ name: 'School F', code: 'TS-F' });

    const doc = await runWithTenant(schoolA._id.toString(), async () => {
      return TenantWidget.create({ name: 'Explicit Widget', schoolId: schoolB._id });
    });

    expect(doc.schoolId.toString()).toBe(schoolB._id.toString());
  });

  it('injects schoolId into aggregate pipelines', async () => {
    const schoolA = await createSchoolRecord({ name: 'School G', code: 'TS-G' });
    const schoolB = await createSchoolRecord({ name: 'School H', code: 'TS-H' });
    await TenantWidget.create({ name: 'Widget G', schoolId: schoolA._id });
    await TenantWidget.create({ name: 'Widget H', schoolId: schoolB._id });

    await runWithTenant(schoolA._id.toString(), async () => {
      const results = await TenantWidget.aggregate([{ $match: { name: { $exists: true } } }]);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Widget G');
    });
  });
});
