// Covers xyne-spaces:, xyne-spaces-dev:, xyne-spaces-sandbox:
const isElectronBundled = window.location.protocol.startsWith('xyne-spaces');

const hostname = window.location.hostname;
export const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
export const isSandboxLocal = hostname.endsWith('.localhost');
export const isTestEnv =
  import.meta.env.MODE === 'test' || hostname === 'dashboard' || isSandboxLocal;

export const isSandBox = hostname.includes('sandbox');
export const isProd = !isLocalhost && !isSandBox && !isSandboxLocal;

// Availability in the client is prod-agnostic now; the server's LOCAL_HARNESS_ENABLED
// flag is the real gate for whether runs actually route to a local device.
export const isLocalHarnessAvailable = (): boolean =>
  typeof window !== 'undefined' && !!window.electronAPI?.localHarness;

const protocol = isLocalhost || isTestEnv || isSandboxLocal ? 'http' : 'https';

const ELECTRON_BACKEND_URL = isProd
  ? 'https://app.spaces.xyne.juspay.net'
  : isSandBox
    ? 'https://app.spaces.sandbox.xyne.juspay.net'
    : 'http://localhost:3001';
const ELECTRON_BACKEND_ZERO_URL = isProd
  ? 'https://app.spaces.xyne.juspay.net'
  : isSandBox
    ? 'https://app.spaces.sandbox.xyne.juspay.net'
    : 'http://localhost:4848';
const isDockerTestEnv = isTestEnv && !isSandboxLocal;
const backendPort = isLocalhost ? ':3001' : isDockerTestEnv ? ':5173' : '';

export const API_BASE_URL = isElectronBundled
  ? `${ELECTRON_BACKEND_URL}/api`
  : `${protocol}://${hostname}${backendPort}/api`;

const zeroServerPort = isLocalhost ? ':4848' : isTestEnv ? ':4848' : '';
export const APPS_PUBLIC_BASE_URL = isLocalhost
  ? 'http://localhost:3001/api/apps'
  : isSandBox
    ? 'https://spaces.sandbox.xyne.juspay.net/api/apps'
    : 'https://spaces.xyne.juspay.net/api/apps';

export const VITE_ZERO_SERVER =
  (import.meta.env['VITE_ZERO_SERVER'] as string | undefined) ||
  (isElectronBundled
    ? `${ELECTRON_BACKEND_ZERO_URL}/zero`
    : `${protocol}://${hostname}${zeroServerPort}/zero`);

// OpenTelemetry
const otelHost = isDockerTestEnv ? 'otel-collector' : hostname;
const otelPort = isLocalhost || isDockerTestEnv ? ':4318' : '';
const otelPath = isLocalhost || isDockerTestEnv ? '/v1/metrics' : '/godel/v1/metrics';
export const OTEL_METRICS_ENDPOINT = isElectronBundled
  ? `${ELECTRON_BACKEND_URL}/godel/v1/metrics`
  : `${protocol}://${otelHost}${otelPort}${otelPath}`;
export const OTEL_SERVICE_NAME =
  (import.meta.env['VITE_OTEL_SERVICE_NAME'] as string) || 'xyne-spaces-frontend';
export const OTEL_EXPORT_INTERVAL_MS: number = parseInt(
  (import.meta.env['VITE_OTEL_EXPORT_INTERVAL_MS'] as string) || '60000',
  10,
);
export const ENABLE_OTEL_METRICS: boolean = import.meta.env['VITE_ENABLE_OTEL_METRICS'] !== 'false';
export const ENABLE_ACTIVITY_LOG: boolean = import.meta.env['VITE_ENABLE_ACTIVITY_LOG'] !== 'false';

export const SEARCH_VERSION = import.meta.env['VITE_SEARCH_VERSION'] as string;

// Working hours configuration (in IST) - should match backend defaults
export const WORKING_HOUR_START: number = parseInt(
  (import.meta.env['VITE_WORKING_HOUR_START'] as string) || '11',
  10,
);
export const WORKING_HOUR_END: number = parseInt(
  (import.meta.env['VITE_WORKING_HOUR_END'] as string) || '19',
  10,
);

export const FLUSH_INTERVAL_IN_MS = 60000;
export const MAX_BATCH_SIZE = 10;
export const LOGGER_BASE_URL = isElectronBundled
  ? `${ELECTRON_BACKEND_URL}/godel/events`
  : `${protocol}://${hostname}/godel/events`;

export const MAX_RETRIES = 3;

// Feature flag: show manual GENERATE SUMMARY action button (Generate PRD, Generate Summary, Chat with Transcript)
// Auto-generation still runs regardless of this flag
export const ENABLE_SUMMARY_ACTION_BUTTON: boolean =
  import.meta.env['VITE_ENABLE_SUMMARY_ACTION_BUTTON'] === 'true';

// Workspace ID used to rewrite legacy in-app links that don't contain a workspace segment.
// Set VITE_DEFAULT_WORKSPACE_ID in .env.local to the default workspace ID.
export const DEFAULT_WORKSPACE_ID: string =
  (import.meta.env['VITE_DEFAULT_WORKSPACE_ID'] as string) ?? '';
