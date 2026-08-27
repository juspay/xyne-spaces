import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import packageJson from './package.json';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

const require = createRequire(import.meta.url);
const ortDistDir = path.dirname(
  require.resolve('onnxruntime-web', {
    paths: [path.dirname(require.resolve('@huggingface/transformers'))],
  })
);

export default defineConfig(({ mode }) => {
  // Vite puts .env values on import.meta.env, not process.env, so this file
  // cannot see them without loading explicitly. process.env last so a shell value
  // still wins and existing invocations are unchanged.
  const env: Record<string, string | undefined> = {
    ...loadEnv(mode, process.cwd(), ''),
    ...process.env,
  };

  // Deployment lane. Unset for the main bundle, which keeps base '/' and 5173.
  const appBasePath = env.VITE_APP_BASE_PATH || '/';
  const isSdlcSurface = env.VITE_XYNE_SURFACE === 'sdlc';
  const devPort = Number(env.VITE_DEV_PORT) || (isSdlcSurface ? 5175 : 5173);

  // Dev only: the main server stands in for the edge, so the iframe is same-origin
  // exactly as in prod. No rewriting, mirroring the deployed setup.
  const sdlcEdgeProxy = {
    '/sdlc-app': {
      target: env.VITE_SDLC_APP_URL || 'http://localhost:5175',
      changeOrigin: true,
      secure: false,
      ws: true,
    },
    '/sdlc-api': {
      target: env.VITE_SDLC_BACKEND_URL || 'http://localhost:3011',
      changeOrigin: true,
      secure: false,
      ws: true,
    },
    // Shared local zero-cache: both lanes read the same Postgres in dev, so a
    // second one adds setup for no coverage.
    '/sdlc-zero': {
      target: env.VITE_SDLC_ZERO_SERVER || 'http://localhost:4848',
      changeOrigin: true,
      secure: false,
      ws: true,
    },
  };

  return {
    base: appBasePath,
    // Both lanes run from this same project dir, so they would share
    // node_modules/.vite and invalidate each other's prebundled deps
    // ("504 Outdated Optimize Dep"). Give the SDLC server its own.
    ...(isSdlcSurface ? { cacheDir: 'node_modules/.vite-sdlc' } : {}),
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
        },
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
          {
          src: [
            `${ortDistDir}/ort-wasm-simd-threaded.asyncify.wasm`,
            `${ortDistDir}/ort-wasm-simd-threaded.asyncify.mjs`,
            `${ortDistDir}/ort-wasm-simd-threaded.wasm`,
            `${ortDistDir}/ort-wasm-simd-threaded.mjs`,
          ],
          dest: 'onnx',
        },
      ],
      }),
    ],
    build: {
      manifest: true,
      reportCompressedSize: false,
    },
    optimizeDeps: {
      exclude: ['@terrastruct/d2'],
      // Dynamically imported only from the canvas docx export; pre-bundle it so
      // the first export click doesn't hit a discover-and-reload failure in dev.
      include: ['@turbodocx/html-to-docx'],
    },
    server: {
      port: devPort,
      host: true,
      allowedHosts: ['dashboard', 'localhost', '.localhost'],
      proxy: {
        // Same-origin proxy so the dashboard can call the claw-auth backend
        // (which sets no CORS headers) during local dev, mirroring
        // xyne-claw-auth/frontend/vite.config.ts.
        '/claw/api/v1': {
          target: env.VITE_CLAW_BACKEND_URL || 'http://localhost:3003',
          changeOrigin: true,
          secure: false,
        },
        // The SDLC server is served through this one, so it must not self-proxy.
        ...(isSdlcSurface ? {} : sdlcEdgeProxy),
        ...(env.VITE_ENVIRONMENT === 'test'
          ? {
              '/api': {
                target: env.VITE_API_BASE_URL,
                changeOrigin: true,
                secure: false,
                ws: true,
              },
              '/zero': {
                target: env.VITE_ZERO_SERVER || 'http://localhost:4848',
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
          target: env.VITE_CLAW_BACKEND_URL || 'http://localhost:3003',
          changeOrigin: true,
          secure: false,
        },
        ...(env.VITE_ENVIRONMENT === 'test'
          ? {
              '/api': {
                target: env.VITE_API_BASE_URL,
                changeOrigin: true,
                secure: false,
                ws: true,
              },
              '/zero': {
                target: env.VITE_ZERO_SERVER,
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
      dedupe: [
        'react',
        'react-dom',
        '@rocicorp/zero',
        '@tanstack/react-query',
        '@xstate/react',
        'xstate',
      ],
    },
    define: {
      // @turbodocx/html-to-docx (canvas docx export) is Node-oriented and
      // references the bare `global` identifier, which does not exist in browsers.
      global: 'globalThis',
      // Keys are the literal source tokens Vite replaces; only values come from env.
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL),
      'process.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(env.VITE_GOOGLE_CLIENT_ID),
      'process.env.VITE_MIXPANEL_TOKEN': JSON.stringify(env.VITE_MIXPANEL_TOKEN),
      __APP_VERSION__: JSON.stringify(packageJson.version),
    },
  };
});
