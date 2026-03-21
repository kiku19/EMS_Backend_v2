/**
 * Unit tests for utils/debounce.js
 *
 * Tests debounce, throttle, and debounceAsync utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, throttle, debounceAsync } from '../utils/debounce.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// debounce
// ---------------------------------------------------------------------------

describe('debounce', () => {
  it('delays execution until after the wait period', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('resets the timer on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    vi.advanceTimersByTime(50);
    debounced('b');
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('supports leading: true option', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { leading: true, trailing: false });

    debounced('a');
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('a');

    debounced('b');
    vi.advanceTimersByTime(200);
    // With trailing: false, second call should not trigger
    expect(fn).toHaveBeenCalledOnce();
  });

  it('cancel() prevents pending invocation', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);

    expect(fn).not.toHaveBeenCalled();
  });

  it('flush() invokes pending call immediately', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a');
    debounced.flush();

    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('pending() returns true when a timer is active', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    expect(debounced.pending()).toBe(false);
    debounced();
    expect(debounced.pending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(debounced.pending()).toBe(false);
  });

  it('uses default wait of 300ms', () => {
    const fn = vi.fn();
    const debounced = debounce(fn);

    debounced();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// throttle
// ---------------------------------------------------------------------------

describe('throttle', () => {
  it('invokes immediately on first call (leading: true by default)', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('throttles subsequent calls within the wait period', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('a');
    throttled('b');
    throttled('c');
    expect(fn).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(100);
    // trailing call fires with last args
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('c');
  });
});

// ---------------------------------------------------------------------------
// debounceAsync
// ---------------------------------------------------------------------------

describe('debounceAsync', () => {
  it('returns a promise that resolves after the wait period', async () => {
    vi.useRealTimers(); // async needs real timers
    const fn = vi.fn().mockResolvedValue('result');
    const debounced = debounceAsync(fn, 50);

    const promise = debounced('a');
    const result = await promise;

    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe('result');
  });

  it('only invokes the last call when called rapidly', async () => {
    vi.useRealTimers();
    const fn = vi.fn().mockResolvedValue('done');
    const debounced = debounceAsync(fn, 50);

    debounced('a');
    debounced('b');
    const result = await debounced('c');

    expect(result).toBe('done');
    // fn should be called with 'c' (last call wins)
    expect(fn).toHaveBeenCalledWith('c');
  });
});
