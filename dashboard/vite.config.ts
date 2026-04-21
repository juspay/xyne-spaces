import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import packageJson from './package.json';
import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')
);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'version-file',
      closeBundle() {
        try {
          writeFileSync(
            'dist/version.json',
            JSON.stringify(
              {
                version: pkg.version
              },
              null,
              2
            )
          );
          console.log('✓ version.json created successfully');
        } catch (error) {
          console.error('✗ Failed to create version.json:', error);
          throw new Error(`Build failed: Unable to create version.json - ${error}`);
        }
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
      ],
    }),
  ],
  build: {
    manifest: true
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['dashboard', 'localhost'],
    proxy: process.env.VITE_ENVIRONMENT === 'test' ? {
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
    } : undefined,
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
