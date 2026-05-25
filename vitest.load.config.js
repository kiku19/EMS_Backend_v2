import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/globalSetup.js'],
    setupFiles: ['./tests/clockSetup.js', './tests/setup.js'],
    include: ['./tests/**/*.load.test.js', './tests/load/**/*.test.js'],
    maxWorkers: 4,
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
