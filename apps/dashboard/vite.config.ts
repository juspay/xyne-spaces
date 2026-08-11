import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import packageJson from './package.json';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
);

// onnxruntime-web is a transitive dep of @huggingface/transformers, so under pnpm it is
// NOT symlinked into apps/dashboard/node_modules — a literal 'node_modules/onnxruntime-web'
// path would silently copy nothing. Resolve it from the transformers entry instead, which
// makes Node walk the right node_modules chain. Neither package exports './package.json',
// so we resolve the entry module and take its directory.
const require = createRequire(import.meta.url);
const ortDistDir = path.dirname(
  require.resolve('onnxruntime-web', {
    paths: [path.dirname(require.resolve('@huggingface/transformers'))],
  })
);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'version-file',
      // Emit version.json through Rollup so Vite writes it into the build's outDir itself.
      // The previous approach used writeFileSync('dist/version.json') in closeBundle, which
      // assumed dist/ already existed — that fails on a CLEAN build (fresh CI workspace) with
      // ENOENT, and only "worked" when a prior build left dist/ behind. emitFile has no such
      // assumption and is the environment-safe way to add an asset to the bundle.
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: pkg.version }, null, 2),
        });
      }
    },
    viteStaticCopy({
      targets: [
        // PDF.js worker - renamed to .js for nginx compatibility
        {
          src: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
          dest: 'pdfjs',
          rename: 'pdf.worker.min.js',
        },
        // PDF.js WASM files (openjpeg.wasm, qcms_bg.wasm, etc.)
        {
          src: 'node_modules/pdfjs-dist/wasm/*',
          dest: 'pdfjs/wasm',
        },
        // ONNX Runtime WASM for the on-device intent classifier. Served from our own
        // origin — the worker sets `allowRemoteModels = false` so it can never reach a CDN.
        // See docs/ON_DEVICE_INTENT.md §5.1.
        {
          src: `${ortDistDir}/*.wasm`,
          dest: 'onnx',
        },
        {
          src: `${ortDistDir}/*.mjs`,
          dest: 'onnx',
        },
      ],
    }),
  ],
  build: {
    manifest: true
  },
  optimizeDeps: {
    exclude: ['@terrastruct/d2'],
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['dashboard', 'localhost', '.localhost'],
    proxy: {
      // Same-origin proxy so the dashboard can call the claw-auth backend
      // (which sets no CORS headers) during local dev, mirroring
      // xyne-claw-auth/frontend/vite.config.ts.
      '/claw/api/v1': {
        target: process.env.VITE_CLAW_BACKEND_URL || 'http://localhost:3003',
        changeOrigin: true,
        secure: false,
      },
      ...(process.env.VITE_ENVIRONMENT === 'test'
        ? {
            '/api': {
              target: process.env.VITE_API_BASE_URL,
              changeOrigin: true,
              secure: false,
              ws: true,
            },
            '/zero': {
              target: process.env.VITE_ZERO_SERVER,
              changeOrigin: true,
              secure: false,
              ws: true,
            },
          }
        : {}),
    },
  },
  preview: {
    port: 5173,
    host: true,
    allowedHosts: ['dashboard', 'localhost', '.localhost'],
    proxy: {
      // Keep the same-origin routes used by browser tests when the test image
      // serves its prebuilt bundle with `vite preview`.
      '/claw/api/v1': {
        target: process.env.VITE_CLAW_BACKEND_URL || 'http://localhost:3003',
        changeOrigin: true,
        secure: false,
      },
      ...(process.env.VITE_ENVIRONMENT === 'test'
        ? {
            '/api': {
              target: process.env.VITE_API_BASE_URL,
              changeOrigin: true,
              secure: false,
              ws: true,
            },
            '/zero': {
              target: process.env.VITE_ZERO_SERVER,
              changeOrigin: true,
              secure: false,
              ws: true,
            },
          }
        : {}),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/lib': path.resolve(__dirname, './src/shared/lib'),
      '@/components': path.resolve(__dirname, './src/shared/components'),
      '@/hooks': path.resolve(__dirname, './src/shared/hooks'),
      '@/workflow-ui': path.resolve(__dirname, './src/workflow-ui'),
      // Alias the real package to a private name so the shim can import it
      // without creating a circular dependency.
      'react-router-dom-actual': path.resolve(__dirname, 'node_modules/react-router-dom'),
      // Transparently replace react-router-dom with our workspace-aware shim.
      // All existing `import { useNavigate, Link } from 'react-router-dom'` calls
      // now get workspace-prefixed versions at runtime with zero per-file changes.
      'react-router-dom': path.resolve(__dirname, 'src/lib/react-router-dom-shim.ts'),
    },
    dedupe: ['react', 'react-dom', '@rocicorp/zero', '@tanstack/react-query', '@xstate/react', 'xstate']
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    'process.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL),
    'process.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(process.env.VITE_GOOGLE_CLIENT_ID),
    'process.env.VITE_MIXPANEL_TOKEN': JSON.stringify(process.env.VITE_MIXPANEL_TOKEN),
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
});
