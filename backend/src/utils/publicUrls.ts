import { config as appConfig } from '@/config/env';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

function parseHttpUrl(value: string, settingName: string): URL {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${settingName} configuration is required`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${settingName} must be a valid absolute URL`);
  }

  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    throw new Error(`${settingName} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(`${settingName} must not contain credentials`);
  }

  return url;
}

export function normalizeConfiguredBaseUrl(value: string, settingName: string): string {
  const url = parseHttpUrl(value, settingName);
  if (url.search || url.hash) {
    throw new Error(`${settingName} must not contain a query string or fragment`);
  }

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

export function getFrontendUrl(): string {
  if (!appConfig.frontendUrl) {
    throw new Error('FRONTEND_URL config is required');
  }
  return normalizeConfiguredBaseUrl(appConfig.frontendUrl, 'FRONTEND_URL');
}

export function getBackendUrl(): string {
  return normalizeConfiguredBaseUrl(appConfig.backendUrl, 'BACKEND_URL');
}

export function resolveConfiguredOAuthRedirectUrl(
  explicitRedirectUrl: string | undefined,
  backendUrl: string,
  callbackPath: `/${string}`,
  settingName: string,
): string {
  if (!explicitRedirectUrl?.trim()) {
    return `${normalizeConfiguredBaseUrl(backendUrl, 'BACKEND_URL')}${callbackPath}`;
  }

  const url = parseHttpUrl(explicitRedirectUrl, settingName);
  if (url.search) {
    throw new Error(`${settingName} must not contain a query string`);
  }
  if (url.hash) {
    throw new Error(`${settingName} must not contain a fragment`);
  }
  return url.toString();
}
