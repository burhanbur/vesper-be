import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.integration.test.ts'],
    fileParallelism: false,
    cache: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    // No tests/setup.ts: it replaces DATABASE_URL with an unrelated database.
  },
});
