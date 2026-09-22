import { defineConfig } from 'vitest/config';

// Scoped deliberately: the dashboard has no test harness beyond this, so the
// surface is kept to pure modules with no heavy deps (no jsdom, no BlockNote,
// no React rendering). Widen it only alongside the setup those tests need.
// No `globals: true` — test helpers are imported explicitly (repo convention).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
