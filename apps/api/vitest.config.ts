import { defineConfig } from 'vitest/config';

process.env.DATABASE_URL ??= 'mysql://vigioni:change-me-local@127.0.0.1:3306/vigioni';
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-with-at-least-32-characters';
process.env.CAMERA_CREDENTIAL_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: { environment: 'node', sequence: { concurrent: false } },
});
