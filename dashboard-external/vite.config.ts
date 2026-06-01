import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Rewrites absolute public-asset paths (e.g. '/images/...', '/sounds/...')
 * to include the Vite base prefix ('/external/images/...').
 * This runs only in the dashboard-external build, so dashboard source files
 * can keep using plain '/images/...' paths and they'll just work everywhere.
 */
function rewritePublicAssetPaths(): Plugin {
  let base: string;
  return {
    name: 'rewrite-public-asset-paths',
    configResolved(config) {
      base = config.base;
    },
    transform(code, id) {
      if (id.includes('node_modules')) return null;
      if (!/\.[jt]sx?$/.test(id)) return null;
      if (!/(["'`])\/(images|sounds)\//.test(code)) return null;
      return code.replace(/(["'`])\/(images|sounds)\//g, `$1${base}$2/`);
    },
    transformIndexHtml(html) {
      return html.replace(/(["'])\/(images|sounds)\//g, `$1${base}$2/`);
    },
  };
}

function resolveFromDashboardExternal(): Plugin {
  let localImporter: string;
  let dashboardImporter: string;

  return {
    name: 'resolve-from-dashboard-external',
    enforce: 'pre',
    configResolved(config) {
      localImporter = path.join(config.root, 'package.json');
      dashboardImporter = path.resolve(config.root, '../dashboard/package.json');
    },
    async resolveId(id: string, importer: string | undefined, options: any) {
      if (!id || id.startsWith('.') || id.startsWith('/') || id.startsWith('\0')) return null;
      if (id.startsWith('@/') || id.startsWith('@xyne/')) return null;
      if (id === 'react-router-dom' || id === 'react-router-dom-actual') return null;
      // Don't intercept imports from node_modules — they have their own resolution context
      if (importer && importer.includes('/node_modules/')) return null;

      const local = await this.resolve(id, localImporter, { ...options, skipSelf: true });
      if (local) return local;

      const dashboard = await this.resolve(id, dashboardImporter, { ...options, skipSelf: true });
      return dashboard ?? null;
    },
  };
}

export default defineConfig({
  base: '/external/',
  plugins: [rewritePublicAssetPaths(), resolveFromDashboardExternal(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../dashboard/src'),
      '@xyne/shared': path.resolve(__dirname, '../shared/dist'),
      'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
      'react-router-dom-actual': path.resolve(__dirname, 'node_modules/react-router-dom'),
      // Stub out heavy editor deps — ThreadMessages is never rendered in the external app
      '@/components/Chat/ThreadPannel': path.resolve(__dirname, 'src/stubs/ThreadPannelStub.tsx'),
    },
    dedupe: ['react', 'react-dom', '@tanstack/react-query', 'react-router-dom', 'livekit-client', 'xstate'],
  },
  server: {
    port: 5174,
    host: true,
    allowedHosts: ['localhost', '.localhost'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    __APP_VERSION__: JSON.stringify('external'),
  },
  build: {
    outDir: 'dist',
    manifest: true,
  },
});
