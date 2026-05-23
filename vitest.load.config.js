import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config.js';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['./tests/load/*.test.js', './tests/*.load.test.js'],
    exclude: [],
  },
});
