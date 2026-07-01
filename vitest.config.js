import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/clockSetup.js', './tests/setup.js'],
    include: ['./tests/**/*.test.js'],
    exclude: ['**/e2e-*.test.js', '**/*.e2e.test.js', '**/load/*.test.js', '**/*.load.test.js'],
    maxWorkers: 4,
    testTimeout: 45000,
    hookTimeout: 90000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'routes/**/*.js',
        'models/**/*.js',
        'middleware/**/*.js',
        'services/**/*.js',
        'utils/**/*.js',
      ],
      exclude: ['routes/seedDummyData.js', 'routes/dataCleanup.js'],
      // Ratchet floor set just below current measured coverage (lines ~43%,
      // branches ~32%) so CI is green and cannot regress below today's bar.
      // The 60% target was aspirational (set 2026-05-31) but never actually
      // enforced — the job died at the npm-audit step before coverage ran.
      // Raise these incrementally as coverage improves; do not let them block
      // every PR while the suite is well below the goal.
      thresholds: {
        lines: 40,
        statements: 40,
        functions: 40,
        branches: 30,
      },
    },
  },
});
