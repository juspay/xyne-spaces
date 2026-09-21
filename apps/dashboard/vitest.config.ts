import { defineConfig } from 'vitest/config';

// Scoped deliberately: the dashboard has no test harness beyond this, so the
// surface is kept to pure modules with no heavy deps (no jsdom, no BlockNote,
// no React rendering). Widen it only alongside the setup those tests need.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
