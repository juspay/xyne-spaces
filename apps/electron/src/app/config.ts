/**
 * Public/development Electron configuration.
 *
 * Production and sandbox configuration lives in the private repository overlay.
 * Keep this file free of private domains, internal service URLs, and signing
 * metadata.
 */

export interface AppConfig {
  BACKEND_URL: string;
  MTLS_BACKEND_URL: string;
  MTLS_FRONTEND_URL: string;
  MTLS_IDENTITY_NAME: string;
  UNPROTECTED_URL: string;
  FRONTEND_URL: string;
  DEEP_LINK_PROTOCOL: string;
  USER_DATA_SUFFIX: string;
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
  TRUSTED_ORIGINS: string[];
  CSP_ALLOWED_ORIGINS: string[];
  CSP_ALLOWED_WS_ORIGINS: string[];
}

const devConfig: AppConfig = {
  BACKEND_URL: 'http://localhost:3001',
  MTLS_BACKEND_URL: 'http://localhost:3000',
  MTLS_FRONTEND_URL: 'http://localhost:5174',
  MTLS_IDENTITY_NAME: 'Web Simulation Client',
  UNPROTECTED_URL: 'http://localhost:4001',
  FRONTEND_URL: 'http://localhost:5173',
  DEEP_LINK_PROTOCOL: 'xyne-spaces-dev',
  USER_DATA_SUFFIX: '-dev',
  APP_NAME: 'Xyne Spaces DEV',
  APP_CONFIG: 'dev',
  APP_ID: 'com.xyne.spaces.dev',
  window: {
    width: 1200,
    height: 800,
    title: 'Xyne Spaces DEV',
  },
  enableMtls: false,
  useBundledUI: false,
  sendLogs: false,
  enableOtelMetrics: true,
  RELEASE_CONFIG_URL: 'http://localhost:3456',
  UI_ZIP_URL: 'http://localhost:8888/releases/dashboard.zip',
  uiUpdateCheckIntervalMs: 60 * 1000,
  agentInteract: {
    endpoint: '/api/query',
    method: 'POST',
  },
  preProdKey: 'preProdFeaturesEnabled',
  TRUSTED_ORIGINS: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:4001',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:4001',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
  ],
  CSP_ALLOWED_ORIGINS: [
    'http://localhost:*',
    'https://localhost:*',
    'http://127.0.0.1:*',
    'https://127.0.0.1:*',
  ],
  CSP_ALLOWED_WS_ORIGINS: [
    'ws://localhost:*',
    'wss://localhost:*',
    'ws://127.0.0.1:*',
    'wss://127.0.0.1:*',
  ],
};

export const config: AppConfig = {
  ...devConfig,
  useBundledUI: process.env.USE_BUNDLED_UI === 'true' ? true : devConfig.useBundledUI,
  RELEASE_CONFIG_URL: process.env.RELEASE_CONFIG_URL || devConfig.RELEASE_CONFIG_URL,
  UI_ZIP_URL: process.env.UI_ZIP_URL || devConfig.UI_ZIP_URL,
};
