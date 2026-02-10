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
                version: pkg.version,
                buildTime: Date.now()
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
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    'process.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL),
    'process.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(process.env.VITE_GOOGLE_CLIENT_ID),
    'process.env.VITE_MIXPANEL_TOKEN': JSON.stringify(process.env.VITE_MIXPANEL_TOKEN),
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
});
