import { vi } from 'vitest';

// Freeze the test clock BEFORE any other setup file runs. This matters because
// `tests/setup.js` transitively imports `utils/constants.js`, and that module
// eagerly computes `CURRENT_ACADEMIC_YEAR = getDefaultAcademicYear()` at load
// time. Anything running after that sees the frozen moment, but the constant
// is already baked — so we must call `vi.useFakeTimers` before any import
// chain that touches constants.js.
//
// We only fake `Date` (and `performance` for code that uses it as a clock).
// Leaving setTimeout/setInterval on real timers is crucial: mongodb-memory-server,
// MongoDB driver connection pooling, and Agenda-style jobs spawn timers during
// startup/teardown, and faking those without manual advancement causes afterAll
// hooks to hang (`Hook timed out in 60000ms` on mongoose.disconnect).
vi.useFakeTimers({
  now: new Date('2026-03-31T12:00:00Z'),
  shouldAdvanceTime: true,
  toFake: ['Date', 'performance'],
});
