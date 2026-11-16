// React Native defines `window` but not `window.location`.
const runtimeLocation = typeof window !== 'undefined' ? window.location : undefined;
const isElectronBundled = runtimeLocation?.protocol.startsWith('xyne-spaces') ?? false;
const hostname = runtimeLocation?.hostname ?? '';
const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
const isSandboxLocal = hostname.endsWith('.localhost');
const isTestEnv = hostname === 'dashboard' || isSandboxLocal;
const isSandBox = hostname.includes('sandbox');
const protocol = isLocalhost || isTestEnv || isSandboxLocal ? 'http' : 'https';
// This package also runs in Node, where import.meta.env is absent.
const env = (import.meta as ImportMeta & {
  env?: { DEV?: boolean; VITE_DEV_PROXY?: string; VITE_ELECTRON_BACKEND_URL?: string };
}).env;
// Backend origin baked into the Electron bundle (no window.location host to derive
// it from). Set VITE_ELECTRON_BACKEND_URL at build time; defaults to local dev.
const ELECTRON_BACKEND_URL = (env?.VITE_ELECTRON_BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, '');
const isDockerTestEnv = isTestEnv && !isSandboxLocal;
const backendPort = isLocalhost ? ':3001' : isDockerTestEnv ? ':5173' : '';
// Match the dashboard's opt-in Vite development proxy.
export const API_BASE_URL =
  env?.DEV && env.VITE_DEV_PROXY === 'true'
    ? '/api'
    : isElectronBundled
      ? `${ELECTRON_BACKEND_URL}/api`
      : `${protocol}://${hostname}${backendPort}/api`;
