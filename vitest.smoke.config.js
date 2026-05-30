import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config.js';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['./tests/**/*.unit.test.js'],
    exclude: [],
    maxWorkers: 4,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
