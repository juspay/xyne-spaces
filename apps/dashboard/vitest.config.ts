import path from 'path';
import { defineConfig } from 'vitest/config';

// Unit tests only — pure logic modules that need no DOM. The dashboard's vite.config.ts
// pulls in the full plugin chain (onnxruntime copy, model fetch), which a unit run does
// not need, so the test config is deliberately standalone.
//
// Component tests (e.g. src/components/AIScreen/Workspace/__tests__/workspaceLastOpenSwitch.test.tsx)
// import real UI modules that use the app's path aliases, so mirror the subset of
// vite.config.ts resolve.alias they need. CSS stays unprocessed (node environment).
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: path.resolve(__dirname, './src') + '/' },
      { find: /^react-router-dom-actual$/, replacement: path.resolve(__dirname, 'node_modules/react-router-dom') },
      { find: /^react-router-dom$/, replacement: path.resolve(__dirname, 'src/lib/react-router-dom-shim.ts') },
    ],
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@xstate/react', 'xstate'],
  },
  define: { __APP_VERSION__: '"test"' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: false,
    css: false,
  },
});
