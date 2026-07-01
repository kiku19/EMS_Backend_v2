/**
 * Unit tests for resolveAutoIndex() in database.js
 *
 * Pure function tests — no database, no HTTP. Verifies the production-only,
 * opt-in behavior of the Mongoose `autoIndex` connection option (SCH-202):
 * autoIndex stays ON everywhere by default and is only disabled when running
 * in production AND DB_DISABLE_AUTOINDEX is explicitly "true".
 */
import { describe, expect, it } from 'vitest';
import { resolveAutoIndex } from '../database.js';

describe('resolveAutoIndex', () => {
  it('defaults to true in production when the flag is unset', () => {
    expect(resolveAutoIndex({ NODE_ENV: 'production' })).toBe(true);
  });

  it('returns false in production only when DB_DISABLE_AUTOINDEX is "true"', () => {
    expect(resolveAutoIndex({ NODE_ENV: 'production', DB_DISABLE_AUTOINDEX: 'true' })).toBe(false);
  });

  it('ignores the flag outside production (development)', () => {
    expect(resolveAutoIndex({ NODE_ENV: 'development', DB_DISABLE_AUTOINDEX: 'true' })).toBe(true);
  });

  it('ignores the flag outside production (test)', () => {
    expect(resolveAutoIndex({ NODE_ENV: 'test', DB_DISABLE_AUTOINDEX: 'true' })).toBe(true);
  });

  it('only treats the exact string "true" as disable (not "1"/"TRUE"/true-ish)', () => {
    expect(resolveAutoIndex({ NODE_ENV: 'production', DB_DISABLE_AUTOINDEX: '1' })).toBe(true);
    expect(resolveAutoIndex({ NODE_ENV: 'production', DB_DISABLE_AUTOINDEX: 'TRUE' })).toBe(true);
    expect(resolveAutoIndex({ NODE_ENV: 'production', DB_DISABLE_AUTOINDEX: 'yes' })).toBe(true);
    expect(resolveAutoIndex({ NODE_ENV: 'production', DB_DISABLE_AUTOINDEX: '' })).toBe(true);
  });
});
