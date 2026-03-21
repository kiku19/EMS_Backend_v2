/**
 * Unit tests for services/cacheService.js
 *
 * Tests the CacheService in-memory fallback mode (no Redis).
 * Redis is not available in test environment, so all operations
 * fall back to InMemoryCache.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import cacheService, { TTL } from '../services/cacheService.js';

beforeEach(async () => {
  await cacheService.clear();
});

// ---------------------------------------------------------------------------
// TTL constants
// ---------------------------------------------------------------------------

describe('TTL constants', () => {
  it('has expected values', () => {
    expect(TTL.TIMETABLE).toBe(2 * 60 * 1000);
    expect(TTL.CONFLICT).toBe(30 * 1000);
    expect(TTL.CLASS_LIST).toBe(5 * 60 * 1000);
    expect(TTL.SCHOOL_SETTINGS).toBe(10 * 60 * 1000);
    expect(TTL.FEE_HEADS).toBe(5 * 60 * 1000);
    expect(TTL.DEFAULT).toBe(5 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// get / set / delete
// ---------------------------------------------------------------------------

describe('CacheService get/set/delete', () => {
  it('returns null on cache miss', async () => {
    const result = await cacheService.get('nonexistent');
    expect(result).toBeNull();
  });

  it('stores and retrieves a value', async () => {
    await cacheService.set('key1', { name: 'test' });
    const result = await cacheService.get('key1');
    expect(result).toEqual({ name: 'test' });
  });

  it('stores strings, numbers, arrays', async () => {
    await cacheService.set('str', 'hello');
    await cacheService.set('num', 42);
    await cacheService.set('arr', [1, 2, 3]);

    expect(await cacheService.get('str')).toBe('hello');
    expect(await cacheService.get('num')).toBe(42);
    expect(await cacheService.get('arr')).toEqual([1, 2, 3]);
  });

  it('overwrites existing key', async () => {
    await cacheService.set('key1', 'old');
    await cacheService.set('key1', 'new');
    expect(await cacheService.get('key1')).toBe('new');
  });

  it('deletes a key', async () => {
    await cacheService.set('key1', 'value');
    await cacheService.delete('key1');
    expect(await cacheService.get('key1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('CacheService clear', () => {
  it('removes all entries', async () => {
    await cacheService.set('a', 1);
    await cacheService.set('b', 2);
    await cacheService.clear();

    expect(await cacheService.get('a')).toBeNull();
    expect(await cacheService.get('b')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// invalidatePattern
// ---------------------------------------------------------------------------

describe('CacheService invalidatePattern', () => {
  it('removes keys matching a wildcard pattern', async () => {
    await cacheService.set('timetable:class:c1:2025', 'val1');
    await cacheService.set('timetable:class:c2:2025', 'val2');
    await cacheService.set('other:key', 'val3');

    const deleted = await cacheService.invalidatePattern('timetable:class:*');

    expect(deleted).toBe(2);
    expect(await cacheService.get('timetable:class:c1:2025')).toBeNull();
    expect(await cacheService.get('timetable:class:c2:2025')).toBeNull();
    expect(await cacheService.get('other:key')).toBe('val3');
  });

  it('returns 0 when no keys match', async () => {
    await cacheService.set('foo', 'bar');
    const deleted = await cacheService.invalidatePattern('nomatch:*');
    expect(deleted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Key generators
// ---------------------------------------------------------------------------

describe('CacheService key generators', () => {
  it('getClassListKey', () => {
    expect(cacheService.getClassListKey('2025-26')).toBe('classes:2025-26');
  });

  it('getTeacherListKey', () => {
    expect(cacheService.getTeacherListKey('2025-26')).toBe('teachers:2025-26');
  });

  it('getClassTimetableKey', () => {
    expect(cacheService.getClassTimetableKey('c1', '2025-26')).toBe('timetable:class:c1:2025-26');
  });

  it('getTeacherTimetableKey', () => {
    expect(cacheService.getTeacherTimetableKey('t1', '2025-26')).toBe(
      'timetable:teacher:t1:2025-26'
    );
  });

  it('getAvailableTeachersKey', () => {
    expect(cacheService.getAvailableTeachersKey('c1', 'Math', 'Monday', 1)).toBe(
      'available:c1:Math:Monday:1'
    );
  });

  it('getTeacherAssignmentsKey', () => {
    expect(cacheService.getTeacherAssignmentsKey('t1')).toBe('assignments:t1');
  });
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

describe('CacheService getStats', () => {
  it('returns stats with memory backend', async () => {
    await cacheService.set('k', 'v');
    const stats = await cacheService.getStats();

    expect(stats.backend).toBe('memory');
    expect(stats.memorySize).toBeGreaterThanOrEqual(1);
    expect(stats.memoryKeys).toContain('k');
  });
});

// ---------------------------------------------------------------------------
// Invalidation helpers
// ---------------------------------------------------------------------------

describe('CacheService invalidation helpers', () => {
  it('invalidateTimetableCache clears timetable and available keys', async () => {
    await cacheService.set('timetable:class:c1:2025-26', 'data');
    await cacheService.set('available:c1:Math:Mon:1', 'data');

    await cacheService.invalidateTimetableCache('2025-26');

    expect(await cacheService.get('timetable:class:c1:2025-26')).toBeNull();
    expect(await cacheService.get('available:c1:Math:Mon:1')).toBeNull();
  });

  it('invalidateClassCache clears class-specific timetable and available keys', async () => {
    await cacheService.set('timetable:class:c1:2025-26', 'data');
    await cacheService.set('timetable:class:c2:2025-26', 'other');
    await cacheService.set('available:c1:Math:Mon:1', 'data');

    await cacheService.invalidateClassCache('c1');

    expect(await cacheService.get('timetable:class:c1:2025-26')).toBeNull();
    expect(await cacheService.get('available:c1:Math:Mon:1')).toBeNull();
    // c2 should still be cached
    expect(await cacheService.get('timetable:class:c2:2025-26')).toBe('other');
  });

  it('invalidateTeacherCache clears teacher-specific keys', async () => {
    await cacheService.set('timetable:teacher:t1:2025-26', 'data');
    await cacheService.set('assignments:t1', 'data');

    await cacheService.invalidateTeacherCache('t1');

    expect(await cacheService.get('timetable:teacher:t1:2025-26')).toBeNull();
    expect(await cacheService.get('assignments:t1')).toBeNull();
  });
});
