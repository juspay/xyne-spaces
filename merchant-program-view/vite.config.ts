import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// The Spaces backend sends no CORS headers, so the browser blocks direct
// cross-origin calls from the dev server. In dev we PROXY /api and /claw to
// XYNE_BASE_URL (same-origin from the browser's view) and lib/xyne.ts uses a ''
// baseUrl so the SDK emits relative paths that land here. Published, there is no
// dev server: the app is embedded and its fetches are tunnelled to the host
// (see lib/xyne.ts). XYNE_TOKEN / XYNE_APP_ID are injected as guarded globals
// (not import.meta — the Spaces sandbox rejects it); they're for local dev only.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'XYNE_');
  const target = env.XYNE_BASE_URL || 'http://localhost:3001';
  const routeEnv = env.XYNE_ROUTE_ENV; // 'playground' routes to pre-prod; unset = prod

  // Log every proxied request/response, and (optionally) stamp x-route-env. The
  // storage SDK has no route toggle, so the header must be added here; the spaces
  // SDK can send it itself via createClient({ useBeta: true }).
  const proxyWithLogging = (): ProxyOptions => ({
    target,
    changeOrigin: true,
    secure: false,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        if (routeEnv) proxyReq.setHeader('x-route-env', routeEnv);
        console.log(`[proxy] -> ${req.method} ${req.url}`);
      });
      proxy.on('proxyRes', (proxyRes, req) => {
        console.log(`[proxy] <- ${proxyRes.statusCode} ${req.url}`);
      });
      proxy.on('error', (err, req) => {
        console.log(`[proxy] x ${req.url} - ${err.message}`);
      });
    },
  });

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, '.') } },
    server: { proxy: { '/api': proxyWithLogging(), '/claw': proxyWithLogging() } },
    define: {
      __XYNE_TOKEN__: JSON.stringify(env.XYNE_TOKEN ?? ''),
      __XYNE_APP_ID__: JSON.stringify(env.XYNE_APP_ID ?? ''),
    },
  };
});
