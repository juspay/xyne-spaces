/**
 * App Configuration
 *
 * URLs and Lotus flags come from `app.config.js` → `extra` (filled after loadLotusEnv), read via
 * `expo-constants`. Relying on `process.env.EXPO_PUBLIC_*` in this module breaks under Metro/Babel
 * workers during `expo export:embed`/Airborne: workers can inline wrong env (e.g. localhost).
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { parseRemoteLoggingEnabled } from './observability/logging/config/parseRemoteLoggingEnabled';
import { parseMetricsEnabled } from './observability/metrics/config/parseMetricsEnabled';
import { resolveMetricsEndpoint } from './observability/metrics/config/resolveMetricsEndpoint';

// Type definitions for expo-constants extra properties
interface ExpoConfigExtra {
  appVariant?: 'dev' | 'sandbox' | 'prod' | 'community';
  lotusGrafanaLogsEndpoint?: string;
  lotusRemoteLoggingEnabled?: string;
  lotusMetricsEnabled?: string;
  lotusTelemetryEndpoint?: string;
  lotusApiBaseUrl?: string;
  lotusDashboardOrigin?: string;
  lotusPublicDeepLinkOrigin?: string;
  lotusAppEnv?: string;
  lotusMtlsEnabled?: string;
  lotusMicrosoftClientId?: string;
  lotusMicrosoftTenantId?: string;
  lotusZeroServerUrl?: string;
}

interface ExpoConfigWithExtra {
  extra?: ExpoConfigExtra;
  version?: string;
  runtimeVersion?: string;
}

interface ConstantsWithExtras {
  expoConfig?: ExpoConfigWithExtra;
  nativeBuildVersion?: string;
}

// Cast Constants to include our custom properties
const TypedConstants = Constants as ConstantsWithExtras;

type LotusExtras = {
  lotusApiBaseUrl?: string;
  lotusDashboardOrigin?: string;
  lotusPublicDeepLinkOrigin?: string;
  lotusAppEnv?: string;
  lotusMtlsEnabled?: string;
  lotusMicrosoftClientId?: string;
  lotusMicrosoftTenantId?: string;
  lotusZeroServerUrl?: string;
};

function lotusExtras(): LotusExtras {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  if (!extra) return {};

  const s = (k: keyof LotusExtras): string => {
    const v = extra[k as string];
    return typeof v === 'string' ? v.trim() : '';
  };

  return {
    lotusApiBaseUrl: s('lotusApiBaseUrl'),
    lotusDashboardOrigin: s('lotusDashboardOrigin'),
    lotusPublicDeepLinkOrigin: s('lotusPublicDeepLinkOrigin'),
    lotusAppEnv: s('lotusAppEnv'),
    lotusMtlsEnabled: s('lotusMtlsEnabled'),
    lotusMicrosoftClientId: s('lotusMicrosoftClientId'),
    lotusMicrosoftTenantId: s('lotusMicrosoftTenantId'),
    lotusZeroServerUrl: s('lotusZeroServerUrl'),
  };
}

/**
 * The separate community store app (`APP_VARIANT=community`). It has its own backend,
 * Firebase project and signed-out landing screen; everything else is shared with the main app.
 */
export const IS_COMMUNITY_APP = TypedConstants.expoConfig?.extra?.appVariant === 'community';
const DEFAULT_APP_ORIGIN = IS_COMMUNITY_APP
  ? 'https://spaces.xyne.ai'
  : 'https://app.spaces.xyne.juspay.net';
const PUBLIC_WEB_ORIGIN = IS_COMMUNITY_APP
  ? 'https://spaces.xyne.ai'
  : 'https://spaces.xyne.juspay.net';

const DEFAULT_DEV_API_URL = `${DEFAULT_APP_ORIGIN}/api`;
const DEFAULT_PROD_API_URL = `${DEFAULT_APP_ORIGIN}/api`;

const xs = lotusExtras();
const ENV_API_BASE_URL = xs.lotusApiBaseUrl;
const ENV_DASHBOARD_ORIGIN = xs.lotusDashboardOrigin;
const DEFAULT_PUBLIC_DEEP_LINK_ORIGIN = PUBLIC_WEB_ORIGIN;

const rawApiBaseUrl = ENV_API_BASE_URL || (__DEV__ ? DEFAULT_DEV_API_URL : DEFAULT_PROD_API_URL);

export const API_BASE_URL = rawApiBaseUrl.replace(/\/$/, '');
export const API_ORIGIN = API_BASE_URL.replace(/\/api$/, '').replace(/\/$/, '');

export const DASHBOARD_ORIGIN =
  ENV_DASHBOARD_ORIGIN ||
  (__DEV__ && API_ORIGIN.includes('localhost:3001') ? 'http://localhost:5173' : API_ORIGIN);

export const DASHBOARD_URL = `${DASHBOARD_ORIGIN}/`;
export const PROTECTED_HOSTS = [new URL(API_BASE_URL).host];

const normalizePublicDeepLinkOrigin = (raw: string | undefined): string => {
  try {
    const parsed = new URL(raw || DEFAULT_PUBLIC_DEEP_LINK_ORIGIN);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return DEFAULT_PUBLIC_DEEP_LINK_ORIGIN;
    }
    return parsed.origin;
  } catch {
    return DEFAULT_PUBLIC_DEEP_LINK_ORIGIN;
  }
};

/** Public origin for copied links and OS App/Universal Link verification. */
export const PUBLIC_DEEP_LINK_ORIGIN = normalizePublicDeepLinkOrigin(xs.lotusPublicDeepLinkOrigin);

export const MICROSOFT_CLIENT_ID = xs.lotusMicrosoftClientId ?? '';
export const MICROSOFT_TENANT_ID = xs.lotusMicrosoftTenantId ?? '';
export const MICROSOFT_REDIRECT_URI = 'xyne-spaces://auth/microsoft/callback';
export const MICROSOFT_SCOPES = ['openid', 'email', 'profile', 'User.Read', 'offline_access'];

/**
 * Mirrored from `MTLS_ENABLED` in `.env.*` via loadLotusEnv → extra.lotusMtlsEnabled.
 * When false, skip native client-cert WebView setup, device enrollment, and mTLS health checks.
 * When unset, defaults to true so unknown bundles behave like production.
 */
export function isMtlsFeatureEnabled(): boolean {
  const v = (xs.lotusMtlsEnabled ?? 'true').toLowerCase();
  if (v === 'false') return false;
  if (v === 'true') return true;
  return true;
}

/**
 * `MTLS_ENABLED=false` means no enrollment gate or mTLS health checks, regardless of build flavor.
 */
export function skipsDeviceEnrollmentGate(): boolean {
  return !isMtlsFeatureEnabled();
}

const ENV_ZERO_SERVER_URL = xs.lotusZeroServerUrl ?? '';

/** Rocicorp Zero sync URL; must match local zero-cache when API is HTTP (see dashboard `VITE_ZERO_SERVER`). */
export const ZERO_SERVER_URL = (() => {
  if (ENV_ZERO_SERVER_URL.length > 0) {
    return ENV_ZERO_SERVER_URL;
  }
  try {
    const apiUrl = new URL(API_BASE_URL);
    if (apiUrl.protocol === 'http:') {
      return `http://${apiUrl.hostname}:4848/zero`;
    }
  } catch {
    /* fall through */
  }
  return `${DEFAULT_APP_ORIGIN}/zero`;
})();

/**
 * Logger endpoint configuration
 * - DEBUG: Console logging only, immediate flush
 * - PROD: Batched to /godel/events endpoint
 */
export const APP_VARIANT = TypedConstants.expoConfig?.extra?.appVariant as
  'dev' | 'sandbox' | 'prod' | 'community' | undefined;
const IS_DEV = __DEV__ || APP_VARIANT === 'dev';
const IS_SANDBOX = APP_VARIANT === 'sandbox';

const getLoggerBaseUrl = (): string => {
  // if (IS_DEV) return 'http://0.0.0.0:4001';
  if (IS_SANDBOX) return 'https://spaces.sandbox.xyne.juspay.net';
  return PUBLIC_WEB_ORIGIN;
};

// Logger endpoint override (for local testing)
const LOGGER_ENDPOINT_OVERRIDE = TypedConstants.expoConfig?.extra?.lotusGrafanaLogsEndpoint as
  string | undefined;

const _loggerBase = LOGGER_ENDPOINT_OVERRIDE?.replace(/\/$/, '');

export function isRemoteLoggingEnabled(): boolean {
  const extra = TypedConstants.expoConfig?.extra;

  return parseRemoteLoggingEnabled(extra?.lotusRemoteLoggingEnabled, {
    isDevBuild: __DEV__,
    isProductionVariant: extra?.appVariant === 'prod' || extra?.appVariant === 'community',
  });
}

export const LOGGER_CONFIG = {
  // Endpoint for sending logs to /godel/events
  eventsEndpoint: _loggerBase
    ? `${_loggerBase}/godel/events`
    : `${getLoggerBaseUrl()}/godel/events`,

  // Batching configuration (matches dashboard and electron - 10s for faster visibility)
  flushIntervalInMs: 10000, // 10s
  maxBatchSize: 10,
  maxRetries: 3,

  // Service identification
  serviceName: 'xynespaces-native',
  version: TypedConstants.expoConfig?.version ?? 'unknown',
  runtimeVersion: TypedConstants.expoConfig?.runtimeVersion ?? 'unknown',
  buildVersion: TypedConstants.nativeBuildVersion ?? 'unknown',

  // Platform info
  platform: Platform.OS,
  platformVersion: Platform.Version,

  /** When false, structured logs stay on ConsoleTransport (dev) and skip Grafana. */
  remoteLoggingEnabled: isRemoteLoggingEnabled(),
} as const;

/**
 * Telemetry (Metrics) Configuration
 */

const getMetricsBaseUrl = (): string => {
  // if (IS_DEV) return 'http://0.0.0.0:4001';
  if (IS_SANDBOX) return 'https://spaces.sandbox.xyne.juspay.net';
  return PUBLIC_WEB_ORIGIN;
};

export function isMetricsEnabled(): boolean {
  const extra = TypedConstants.expoConfig?.extra;

  return parseMetricsEnabled(extra?.lotusMetricsEnabled, {
    isDevBuild: __DEV__,
  });
}

export const TELEMETRY_CONFIG = {
  // OTLP metrics endpoint
  metricsEndpoint: resolveMetricsEndpoint(
    TypedConstants.expoConfig?.extra?.lotusTelemetryEndpoint,
    getMetricsBaseUrl(),
  ),

  // Export configuration - shorter interval for dev to see metrics faster
  exportIntervalMs: __DEV__ ? 8000 : 30000,

  // Service identification for OTel
  serviceName: 'xynespaces-native',

  // Defaults to release builds; may be explicitly overridden for testing.
  enabled: isMetricsEnabled(),
} as const;

/**
 * Check if running in debug mode
 */
export function isDebugMode(): boolean {
  return IS_DEV;
}
