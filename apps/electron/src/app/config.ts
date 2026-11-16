/**
 * Application configuration constants
 */

const packageJson = require('../../package.json');
const { APP_ENV } = packageJson;

// Hosted deployment URLs are not hard-coded. Each value is read from the environment
// (dev, CI) and otherwise from package.json, where electron-builder's
// `extraMetadata` (build.*.json, or `-c.extraMetadata.<NAME>=<url>` on the
// command line) bakes it into a packaged build. Unset, the value is empty.
const deploymentValue = (name: string): string => {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  const fromPackage: unknown = packageJson[name];
  return typeof fromPackage === 'string' ? fromPackage : '';
};

export interface AppConfig {
  BACKEND_URL: string;
  MTLS_BACKEND_URL: string;
  MTLS_FRONTEND_URL: string;
  MTLS_IDENTITY_NAME: string;
  UNPROTECTED_URL: string;
  FRONTEND_URL: string;
  CLAW_AUTH_URL: string;
  DEEP_LINK_PROTOCOL: string;
  USER_DATA_SUFFIX: string;         // Appended to userData dir to isolate flavors
  APP_NAME: string;
  APP_CONFIG: string;
  APP_ID: string;
  window: {
    width: number;
    height: number;
    title: string;
  };
  enableMtls: boolean;
  loginTempHeader?: boolean;
  useBundledUI: boolean;
  sendLogs: boolean;
  enableOtelMetrics: boolean;
  RELEASE_CONFIG_URL: string;
  UI_ZIP_URL: string;
  uiUpdateCheckIntervalMs: number;
  preProdKey: string;
}

const devConfig: AppConfig = {
  BACKEND_URL: 'http://localhost:3001',
  MTLS_BACKEND_URL: 'http://localhost:3000',
  MTLS_FRONTEND_URL: 'http://localhost:5174',
  MTLS_IDENTITY_NAME: 'Web Simulation Client',
  UNPROTECTED_URL: 'http://localhost:4001',
  FRONTEND_URL: 'http://localhost:5173',
  CLAW_AUTH_URL: 'http://localhost:3003',
  DEEP_LINK_PROTOCOL: 'xyne-spaces-dev',
  USER_DATA_SUFFIX: '-dev',
  APP_NAME: 'Xyne Spaces DEV',
  APP_CONFIG: 'dev',
  APP_ID: "com.xyne.spaces.dev",
  window: {
    width: 1200,
    height: 800,
    title: 'Xyne Spaces',
  },
  enableMtls: false,
  useBundledUI: false,
  sendLogs: false,
  enableOtelMetrics: true,
  RELEASE_CONFIG_URL: 'http://localhost:3456',
  UI_ZIP_URL: 'http://localhost:8888/releases/dashboard.zip',
  uiUpdateCheckIntervalMs: 60 * 1000, // 1 minute for dev
  preProdKey: 'preProdFeaturesEnabled'
};

const prodConfig: AppConfig = {
  BACKEND_URL: deploymentValue('XYNE_BACKEND_URL'),
  MTLS_BACKEND_URL: deploymentValue('XYNE_MTLS_BACKEND_URL'),
  MTLS_FRONTEND_URL: deploymentValue('XYNE_MTLS_FRONTEND_URL'),
  MTLS_IDENTITY_NAME: 'Web Simulation Client',
  UNPROTECTED_URL: deploymentValue('XYNE_UNPROTECTED_URL'), // Non-mTLS endpoint only reserved for pre-enrollment logs and metrics
  FRONTEND_URL: deploymentValue('XYNE_FRONTEND_URL'),
  CLAW_AUTH_URL: deploymentValue('XYNE_CLAW_AUTH_URL'),
  DEEP_LINK_PROTOCOL: 'xyne-spaces',
  USER_DATA_SUFFIX: '',             // Empty — prod keeps original path, no migration needed
  APP_NAME: 'Xyne Spaces',
  APP_CONFIG: 'prod',
  APP_ID: "com.xyne.spaces",
  window: {
    width: 1200,
    height: 800,
    title: 'Xyne Spaces',
  },
  enableMtls: true,
  useBundledUI: false,
  sendLogs: true,
  enableOtelMetrics: true,
  loginTempHeader: true,
  RELEASE_CONFIG_URL: deploymentValue('RELEASE_CONFIG_URL'),
  UI_ZIP_URL: deploymentValue('UI_ZIP_URL'),
  uiUpdateCheckIntervalMs: 15 * 60 * 1000, // 15 minutes for prod
  preProdKey: 'preProdFeaturesEnabled',
};

const sandboxConfig: AppConfig = {
  BACKEND_URL: deploymentValue('XYNE_BACKEND_URL'),
  MTLS_BACKEND_URL: deploymentValue('XYNE_MTLS_BACKEND_URL'),
  MTLS_FRONTEND_URL: deploymentValue('XYNE_MTLS_FRONTEND_URL'),
  MTLS_IDENTITY_NAME: 'Web Simulation Client Sandbox',
  UNPROTECTED_URL: deploymentValue('XYNE_UNPROTECTED_URL'), // Non-mTLS endpoint only reserved for pre-enrollment logs and metrics
  FRONTEND_URL: deploymentValue('XYNE_FRONTEND_URL'),
  CLAW_AUTH_URL: deploymentValue('XYNE_CLAW_AUTH_URL'),
  DEEP_LINK_PROTOCOL: 'xyne-spaces-sandbox',
  USER_DATA_SUFFIX: '-sandbox',
  APP_NAME: 'Xyne Spaces Sandbox',
  APP_CONFIG: 'sandbox',
  APP_ID: "com.xyne.spaces.sandbox",
  window: {
    width: 1200,
    height: 800,
    title: 'Xyne Spaces Sandbox',
  },
  enableMtls: true,
  useBundledUI: false,
  sendLogs: true,
  enableOtelMetrics: true,
  RELEASE_CONFIG_URL: deploymentValue('RELEASE_CONFIG_URL'),
  UI_ZIP_URL: deploymentValue('UI_ZIP_URL'),
  uiUpdateCheckIntervalMs: 15 * 60 * 1000, // 15 minutes for prod
  preProdKey: 'preProdFeaturesEnabled'
};


const baseConfig: AppConfig = process.env.NODE_ENV === 'development' ? devConfig
  : (APP_ENV === 'sandbox' ? sandboxConfig : prodConfig);

// Local harness is allowed in ALL build targets (incl. prod). The authoritative
// enable/disable gate lives server-side (LOCAL_HARNESS_ENABLED in xyne-claw-auth);
// this client flag only controls whether we detect/offer a local CLI connection.
// Override to false at build time via FEATURE_LOCAL_HARNESS_DISABLED for an emergency kill.
export const ENABLE_LOCAL_HARNESS = process.env['FEATURE_LOCAL_HARNESS_DISABLED'] !== 'true';

export const config: AppConfig = {
  ...baseConfig,
  useBundledUI: process.env.USE_BUNDLED_UI === 'true' ? true : baseConfig.useBundledUI,
  RELEASE_CONFIG_URL: process.env.RELEASE_CONFIG_URL || baseConfig.RELEASE_CONFIG_URL,
  UI_ZIP_URL: process.env.UI_ZIP_URL || baseConfig.UI_ZIP_URL,
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Hostnames treated as first party by the privileged renderer bridge (preload.ts),
 * the cookie sync and the frontend CSP. XYNE_FIRST_PARTY_HOSTS (comma-separated;
 * an entry starting with "." or "*." matches the domain and every subdomain, e.g.
 * ".example.org") overrides the default, which is the hosts of the configured
 * URLs above. localhost is handled by each caller separately.
 */
const configuredFirstPartyHosts = deploymentValue('XYNE_FIRST_PARTY_HOSTS')
  .split(',')
  .map((host) => host.trim().toLowerCase().replace(/^\*\./, '.'))
  .filter(Boolean);

export const FIRST_PARTY_HOSTS: string[] =
  configuredFirstPartyHosts.length > 0
    ? configuredFirstPartyHosts
    : Array.from(
        new Set(
          [
            config.BACKEND_URL,
            config.MTLS_BACKEND_URL,
            config.MTLS_FRONTEND_URL,
            config.UNPROTECTED_URL,
            config.FRONTEND_URL,
            config.CLAW_AUTH_URL,
          ]
            .map(hostOf)
            .filter((host) => host && host !== 'localhost' && host !== '127.0.0.1'),
        ),
      );

// Mirrored in preload.ts, which cannot require this module.
export function isFirstPartyHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return FIRST_PARTY_HOSTS.some((entry) =>
    entry.startsWith('.') ? host === entry.slice(1) || host.endsWith(entry) : host === entry,
  );
}
