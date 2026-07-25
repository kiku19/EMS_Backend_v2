import { describe, expect, it, beforeEach } from 'vitest';
import School from '../models/School.js';
import { moduleAccessGuard } from '../middleware/auth/moduleAccess.js';
import { clearModuleCache } from '../services/moduleAccessService.js';
import {
  resolveEnabledModules,
  normalizeToggleableSelection,
  CORE_MODULES,
  ALL_MODULE_KEYS,
} from '../config/moduleRegistry.js';

// Minimal req/res/next doubles for exercising the gateway middleware.
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function runGuard({ schoolId, path, role = 'admin' }) {
  const req = { user: { schoolId, role, id: 'u1' }, path, t: (k) => k };
  const res = makeRes();
  let nextCalled = false;
  return moduleAccessGuard(req, res, () => {
    nextCalled = true;
  }).then(() => ({ res, nextCalled }));
}

describe('moduleRegistry.resolveEnabledModules', () => {
  it('treats an undefined field as unmanaged → everything enabled', () => {
    const { managed, enabled } = resolveEnabledModules(undefined);
    expect(managed).toBe(false);
    expect(enabled.size).toBe(ALL_MODULE_KEYS.length);
  });

  it('treats an empty array as managed core-only', () => {
    const { managed, enabled } = resolveEnabledModules([]);
    expect(managed).toBe(true);
    expect([...enabled].sort()).toEqual([...CORE_MODULES].sort());
  });

  it('unions core with valid toggleable keys and drops invalid ones', () => {
    const { enabled } = resolveEnabledModules(['fees', 'library', 'bogus']);
    expect(enabled.has('fees')).toBe(true);
    expect(enabled.has('library')).toBe(true);
    expect(enabled.has('bogus')).toBe(false);
    CORE_MODULES.forEach((k) => expect(enabled.has(k)).toBe(true));
  });

  it('normalizeToggleableSelection strips core and invalid keys', () => {
    expect(normalizeToggleableSelection(['students', 'fees', 'staff', 'bogus'])).toEqual(['fees']);
  });
});

describe('moduleAccessGuard middleware', () => {
  beforeEach(() => clearModuleCache());

  it('blocks a disabled module with 403 MODULE_DISABLED', async () => {
    const school = await School.create({
      name: 'Guard A',
      code: 'GUARDA',
      enabledModules: ['fees'],
    });
    const { res, nextCalled } = await runGuard({ schoolId: school._id, path: '/library/books' });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('MODULE_DISABLED');
    expect(res.body.module).toBe('library');
  });

  it('allows an enabled module', async () => {
    const school = await School.create({
      name: 'Guard B',
      code: 'GUARDB',
      enabledModules: ['fees'],
    });
    const { res, nextCalled } = await runGuard({ schoolId: school._id, path: '/fees/collect' });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('never gates a core/system path (students)', async () => {
    const school = await School.create({ name: 'Guard C', code: 'GUARDC', enabledModules: [] });
    const { nextCalled } = await runGuard({ schoolId: school._id, path: '/students/123' });
    expect(nextCalled).toBe(true);
  });

  it('fails open for an unmanaged school (no enabledModules field)', async () => {
    // Persist a school without the field to simulate pre-feature data.
    const school = await School.create({ name: 'Guard D', code: 'GUARDD' });
    await School.collection.updateOne({ _id: school._id }, { $unset: { enabledModules: '' } });
    const { nextCalled } = await runGuard({ schoolId: school._id, path: '/library/books' });
    expect(nextCalled).toBe(true);
  });
});
