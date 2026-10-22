import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests only — pure logic modules that need no DOM. The dashboard's vite.config.ts
// pulls in the full plugin chain (onnxruntime copy, model fetch), which a unit run does
// not need, so the test config is deliberately standalone.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
  },
});
