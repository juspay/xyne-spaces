/**
 * Application configuration constants
 */

const { APP_ENV } = require('../../package.json');

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
  agentInteract: {
    endpoint: string;
    method: string;
  };
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
  agentInteract: {
    endpoint: "/api/query",
    method: "POST"
  },
  preProdKey: 'preProdFeaturesEnabled'
};

const prodConfig: AppConfig = {
  BACKEND_URL: 'https://app.spaces.xyne.juspay.net',
  MTLS_BACKEND_URL: 'https://auth.spaces.xyne.juspay.net',
  MTLS_FRONTEND_URL: 'https://auth.spaces.xyne.juspay.net',
  MTLS_IDENTITY_NAME: 'Web Simulation Client',
  UNPROTECTED_URL: 'https://spaces.xyne.juspay.net', // Non-mTLS endpoint only reserved for pre-enrollment logs and metrics
  FRONTEND_URL: 'https://app.spaces.xyne.juspay.net',
  CLAW_AUTH_URL: 'https://app.spaces.xyne.juspay.net',
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
  RELEASE_CONFIG_URL: 'https://airborne.juspay.in/release/xyne/xyne-mobile',
  UI_ZIP_URL: 'https://app.spaces.xyne.juspay.net/releases/dashboard.zip',
  uiUpdateCheckIntervalMs: 15 * 60 * 1000, // 15 minutes for prod
  agentInteract: {
    endpoint: "/api/query",
    method: "POST"
  },
  preProdKey: 'preProdFeaturesEnabled',
};

const sandboxConfig: AppConfig = {
  BACKEND_URL: 'https://app.spaces.sandbox.xyne.juspay.net',
  MTLS_BACKEND_URL: 'https://auth.spaces.sandbox.xyne.juspay.net',
  MTLS_FRONTEND_URL: 'https://auth.spaces.sandbox.xyne.juspay.net',
  MTLS_IDENTITY_NAME: 'Web Simulation Client Sandbox',
  UNPROTECTED_URL: 'https://spaces.xyne.juspay.net', // Non-mTLS endpoint only reserved for pre-enrollment logs and metrics
  FRONTEND_URL: 'https://app.spaces.sandbox.xyne.juspay.net',
  CLAW_AUTH_URL: 'https://app.spaces.sandbox.xyne.juspay.net',
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
  RELEASE_CONFIG_URL: 'https://airborne.juspay.in/release/xyne/xyne-mobile',
  UI_ZIP_URL: 'https://app.spaces.xyne.juspay.net/releases/dashboard.zip',
  uiUpdateCheckIntervalMs: 15 * 60 * 1000, // 15 minutes for prod
  agentInteract: {
    endpoint: "/api/query",
    method: "POST"
  },
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
