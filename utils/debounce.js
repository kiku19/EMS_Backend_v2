/**
 * Debounce utility for delaying function execution
 * Useful for conflict checks during rapid edits
 */

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked
 *
 * @param {Function} func - The function to debounce
 * @param {number} wait - The number of milliseconds to delay
 * @param {Object} options - Options object
 * @param {boolean} options.leading - Invoke on the leading edge of the timeout
 * @param {boolean} options.trailing - Invoke on the trailing edge of the timeout
 * @returns {Function} The debounced function
 */
export function debounce(func, wait = 300, options = {}) {
  let timeout;
  let lastArgs;
  let lastThis;
  let result;
  let lastCallTime;
  let lastInvokeTime = 0;

  const { leading = false, trailing = true, maxWait } = options;

  function invokeFunc(time) {
    const args = lastArgs;
    const thisArg = lastThis;

    lastArgs = lastThis = undefined;
    lastInvokeTime = time;
    result = func.apply(thisArg, args);
    return result;
  }

  function leadingEdge(time) {
    // Reset any `maxWait` timer
    lastInvokeTime = time;
    // Start the timer for the trailing edge
    timeout = setTimeout(timerExpired, wait);
    // Invoke the leading edge
    return leading ? invokeFunc(time) : result;
  }

  function remainingWait(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;

    return maxWait !== undefined
      ? Math.min(timeWaiting, maxWait - timeSinceLastInvoke)
      : timeWaiting;
  }

  function shouldInvoke(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;

    // Either this is the first call, activity has stopped and we're at the
    // trailing edge, the system time has gone backwards and we're treating
    // it as the trailing edge, or we've hit the `maxWait` limit
    return (
      lastCallTime === undefined ||
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (maxWait !== undefined && timeSinceLastInvoke >= maxWait)
    );
  }

  function timerExpired() {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    // Restart the timer
    timeout = setTimeout(timerExpired, remainingWait(time));
  }

  function trailingEdge(time) {
    timeout = undefined;

    // Only invoke if we have `lastArgs` which means `func` has been
    // debounced at least once
    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = undefined;
    return result;
  }

  function cancel() {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timeout = undefined;
  }

  function flush() {
    return timeout === undefined ? result : trailingEdge(Date.now());
  }

  function pending() {
    return timeout !== undefined;
  }

  function debounced(...args) {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timeout === undefined) {
        return leadingEdge(lastCallTime);
      }
      if (maxWait !== undefined) {
        // Handle invocations in a tight loop
        timeout = setTimeout(timerExpired, wait);
        return invokeFunc(lastCallTime);
      }
    }
    if (timeout === undefined) {
      timeout = setTimeout(timerExpired, wait);
    }
    return result;
  }

  debounced.cancel = cancel;
  debounced.flush = flush;
  debounced.pending = pending;

  return debounced;
}

/**
 * Creates a throttled function that only invokes func at most once per every wait milliseconds
 *
 * @param {Function} func - The function to throttle
 * @param {number} wait - The number of milliseconds to throttle invocations to
 * @param {Object} options - Options object
 * @param {boolean} options.leading - Invoke on the leading edge of the timeout
 * @param {boolean} options.trailing - Invoke on the trailing edge of the timeout
 * @returns {Function} The throttled function
 */
export function throttle(func, wait = 300, options = {}) {
  const { leading = true, trailing = true } = options;
  return debounce(func, wait, {
    leading,
    trailing,
    maxWait: wait,
  });
}

/**
 * Async debounce - debounces async functions and returns a promise
 *
 * @param {Function} func - The async function to debounce
 * @param {number} wait - The number of milliseconds to delay
 * @returns {Function} The debounced async function
 */
export function debounceAsync(func, wait = 300) {
  let timeout;
  const pendingPromise = null;

  return function debounced(...args) {
    return new Promise((resolve, reject) => {
      const later = async () => {
        timeout = null;
        try {
          const result = await func.apply(this, args);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      if (timeout) {
        clearTimeout(timeout);
      }

      timeout = setTimeout(later, wait);
    });
  };
}

export default { debounce, throttle, debounceAsync };
