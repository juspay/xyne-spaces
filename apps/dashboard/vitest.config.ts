import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit tests only — pure logic modules that need no DOM. The dashboard's vite.config.ts
// pulls in the full plugin chain (onnxruntime copy, model fetch), which a unit run does
// not need, so the test config is deliberately standalone. It keeps the `@/` alias so
// modules written against app paths load the same way.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
