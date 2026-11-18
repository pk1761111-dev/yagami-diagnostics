import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://yagami:yagami@localhost:5432/yagami_test',
      DISABLE_SCHEDULER: 'true',
      UPLOAD_DIR: './test-uploads',
      MAX_UPLOAD_MB: '1',
    },
  },
});
