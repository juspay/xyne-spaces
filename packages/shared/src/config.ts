// React Native defines `window` but not `window.location`.
const runtimeLocation = typeof window !== 'undefined' ? window.location : undefined;
const isElectronBundled = runtimeLocation?.protocol.startsWith('xyne-spaces') ?? false;
const hostname = runtimeLocation?.hostname ?? '';
const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
const isSandboxLocal = hostname.endsWith('.localhost');
const viteEnv =
  typeof import.meta !== 'undefined'
    ? (import.meta as { env?: { MODE?: string; VITE_ENABLE_DEV_AUTH?: string } }).env
    : undefined;
const isViteTestMode = viteEnv?.MODE === 'test';
const isTestEnv = isViteTestMode || hostname === 'dashboard' || isSandboxLocal;
const isDevAuthEnabled = isLocalhost && viteEnv?.VITE_ENABLE_DEV_AUTH === 'true';
const isSkipAuthEnv = isTestEnv || isDevAuthEnabled;
const isSandBox = hostname.includes('sandbox');
const protocol = isLocalhost || isTestEnv || isSandboxLocal ? 'http' : 'https';
const ELECTRON_BACKEND_URL = /* isProd */ !isLocalhost && !isSandBox && !isSandboxLocal
  ? 'https://app.spaces.xyne.juspay.net'
  : isSandBox
    ? 'https://app.spaces.sandbox.xyne.juspay.net'
    : 'http://localhost:3001';
const isDockerTestEnv = isTestEnv && !isSandboxLocal;
const sameOriginPort = typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '';
const backendPort = isLocalhost ? ':3001' : isDockerTestEnv ? ':5173' : '';
// Match the dashboard's explicit API override and opt-in Vite development proxy.
// This package also runs in Node, where import.meta.env is absent.
const env = (import.meta as ImportMeta & {
  env?: { DEV?: boolean; VITE_DEV_PROXY?: string; VITE_API_BASE_OVERRIDE?: string };
}).env;
// Local dev auth also goes through the dashboard's own origin (its Vite proxy
// forwards /api), as VITE_DEV_PROXY does.
export const API_BASE_URL =
  env?.VITE_API_BASE_OVERRIDE ||
  (env?.DEV && env.VITE_DEV_PROXY === 'true'
    ? '/api'
    : isElectronBundled
      ? `${ELECTRON_BACKEND_URL}/api`
      : isLocalhost && isSkipAuthEnv
        ? `${protocol}://${hostname}${sameOriginPort}/api`
        : `${protocol}://${hostname}${backendPort}/api`);
