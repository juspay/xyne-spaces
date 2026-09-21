const runtimeLocation =
  typeof window !== 'undefined' && window.location ? window.location : undefined;
const runtimeProtocol = typeof runtimeLocation?.protocol === 'string' ? runtimeLocation.protocol : '';
const hostname = typeof runtimeLocation?.hostname === 'string' ? runtimeLocation.hostname : '';
const isElectronBundled = runtimeProtocol.startsWith('xyne-spaces');
const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
const isSandboxLocal = hostname.endsWith('.localhost');
const isTestEnv = hostname === 'dashboard' || isSandboxLocal;
const isSandBox = hostname.includes('sandbox');
const protocol = isLocalhost || isTestEnv || isSandboxLocal ? 'http' : 'https';
const ELECTRON_BACKEND_URL = /* isProd */ !isLocalhost && !isSandBox && !isSandboxLocal
  ? 'https://app.spaces.xyne.juspay.net'
  : isSandBox
    ? 'https://app.spaces.sandbox.xyne.juspay.net'
    : 'http://localhost:3001';
const isDockerTestEnv = isTestEnv && !isSandboxLocal;
const backendPort = isLocalhost ? ':3001' : isDockerTestEnv ? ':5173' : '';
export const API_BASE_URL = isElectronBundled
  ? `${ELECTRON_BACKEND_URL}/api`
  : `${protocol}://${hostname}${backendPort}/api`;
