import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/clockSetup.js', './tests/setup.js'],
    include: ['./tests/**/*.test.js'],
    exclude: ['**/e2e-*.test.js', '**/*.e2e.test.js', '**/load/*.test.js', '**/*.load.test.js'],
    maxWorkers: 8,
    testTimeout: 30000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['routes/**/*.js', 'middleware/**/*.js', 'services/**/*.js', 'utils/**/*.js'],
      exclude: ['routes/seedDummyData.js', 'routes/dataCleanup.js'],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 60,
      },
    },
  },
});
