// Covers xyne-spaces:, xyne-spaces-dev:, xyne-spaces-sandbox:
const isElectronBundled = window.location.protocol.startsWith('xyne-spaces');

const hostname = window.location.hostname;
export const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
export const isSandboxLocal = hostname.endsWith('.localhost');
export const isTestEnv =
  import.meta.env.MODE === 'test' || hostname === 'dashboard' || isSandboxLocal;

export const isSandBox = hostname.includes('sandbox');
export const isProd = !isLocalhost && !isSandBox && !isSandboxLocal;

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

// Replaces API_BASE_URL wholesale; the SDLC lane builds with '/sdlc-api'.
// NOT named VITE_API_BASE_URL — that already means the backend origin with no
// '/api' suffix, used as a vite proxy target.
const apiBaseOverride = (import.meta.env['VITE_API_BASE_OVERRIDE'] as string | undefined) || '';

export const API_BASE_URL =
  apiBaseOverride ||
  (isElectronBundled
    ? `${ELECTRON_BACKEND_URL}/api`
    : `${protocol}://${hostname}${backendPort}/api`);

const zeroServerPort = isLocalhost ? ':4848' : isTestEnv ? ':4848' : '';
export const APPS_PUBLIC_BASE_URL = isLocalhost
  ? 'http://localhost:3001/api/apps'
  : isSandBox
    ? 'https://spaces.sandbox.xyne.juspay.net/api/apps'
    : 'https://spaces.xyne.juspay.net/api/apps';

// SDLC lane: same-origin path to its own zero-cache. Everything else derives from
// the serving host. VITE_ZERO_SERVER is deliberately not read here — it is used
// server-side (vite preview's /zero proxy, sandbox's traefik rule), and reading it
// client-side let a baked absolute URL pin every host to one origin.
const laneZeroPath = (import.meta.env['VITE_ZERO_PATH'] as string | undefined) || '';

export const VITE_ZERO_SERVER = laneZeroPath
  ? `${window.location.origin}${laneZeroPath}`
  : isElectronBundled
    ? `${ELECTRON_BACKEND_ZERO_URL}/zero`
    : `${protocol}://${hostname}${zeroServerPort}/zero`;

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

// Slack app install page (user's own OAuth token for DM migration). Workspace-specific, so env-only;
// set VITE_SLACK_APP_INSTALL_URL in .env.local — the UI hides the link when unset.
export const SLACK_APP_INSTALL_URL: string =
  (import.meta.env['VITE_SLACK_APP_INSTALL_URL'] as string) || '';
// Deployment lane. The same source builds a second 'sdlc' bundle served at
// '/sdlc-app/' with its own backend and zero-cache. Inert when VITE_XYNE_SURFACE
// is unset. See docs/sdlc-fast-lane.md.

export type XyneSurface = 'main' | 'sdlc';

export const XYNE_SURFACE: XyneSurface =
  (import.meta.env['VITE_XYNE_SURFACE'] as string) === 'sdlc' ? 'sdlc' : 'main';

export const isSdlcSurface = XYNE_SURFACE === 'sdlc';

// Router basename; vite.config.ts reads the same var for `base`. No trailing
// slash, which is what react-router expects.
export const APP_BASE_PATH: string = (
  (import.meta.env['VITE_APP_BASE_PATH'] as string) || '/'
).replace(/\/+$/, '');

// Where the main bundle points its iframe.
export const SDLC_APP_BASE_PATH: string =
  (import.meta.env['VITE_SDLC_APP_BASE_PATH'] as string) || '/sdlc-app';

// Gives this bundle its own Zero IndexedDB so two clients on one origin do not
// share a store. Empty = single lane, unchanged behaviour.
export const ZERO_STORAGE_KEY: string = (import.meta.env['VITE_ZERO_STORAGE_KEY'] as string) || '';
