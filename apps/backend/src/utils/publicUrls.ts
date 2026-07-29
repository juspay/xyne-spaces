import { config as appConfig } from '@/config/env';
import type { Request } from 'express';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const INVALID_HOST_HEADER_CHARS = /[\s/?#@\\,]/;

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

function getSingleHeader(req: Request | null | undefined, headerName: string): string | undefined {
  const value = req?.headers[headerName];
  if (!value || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function isTrustedOriginalHostname(hostname: string): boolean {
  return appConfig.trustedOriginalHostDomains.some(
    (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

export function getTrustedOriginalHost(req: Request | null | undefined): string | undefined {
  if (appConfig.followHeaderRedirection !== true) {
    return undefined;
  }

  const originalHost = getSingleHeader(req, 'x-original-host')?.trim().toLowerCase();
  if (!originalHost || INVALID_HOST_HEADER_CHARS.test(originalHost)) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(`https://${originalHost}`);
  } catch {
    return undefined;
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return undefined;
  }

  if (!isTrustedOriginalHostname(url.hostname)) {
    return undefined;
  }

  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}

function getRequestProtocol(req: Request | null | undefined): 'http' | 'https' {
  const forwardedProto = getSingleHeader(req, 'x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === 'http' || forwardedProto === 'https') {
    return forwardedProto;
  }

  const requestProtocol = req?.protocol?.toLowerCase();
  if (requestProtocol === 'http' || requestProtocol === 'https') {
    return requestProtocol;
  }

  return 'https';
}

export function getTrustedOriginalHostBaseUrl(req: Request | null | undefined): string | undefined {
  const originalHost = getTrustedOriginalHost(req);
  if (!originalHost) {
    return undefined;
  }

  return `${getRequestProtocol(req)}://${originalHost}`;
}

export function getFrontendUrl(req: Request | null = null): string {
  const originalHostBaseUrl = getTrustedOriginalHostBaseUrl(req);
  if (originalHostBaseUrl) {
    return originalHostBaseUrl;
  }

  if (!appConfig.frontendUrl) {
    throw new Error('FRONTEND_URL config is required');
  }
  return normalizeConfiguredBaseUrl(appConfig.frontendUrl, 'FRONTEND_URL');
}

export function getBackendUrl(req: Request | null = null): string {
  const originalHostBaseUrl = getTrustedOriginalHostBaseUrl(req);
  if (originalHostBaseUrl) {
    return originalHostBaseUrl;
  }

  return normalizeConfiguredBaseUrl(appConfig.backendUrl, 'BACKEND_URL');
}

export function resolveConfiguredOAuthRedirectUrl(
  explicitRedirectUrl: string | undefined,
  backendUrl: string,
  callbackPath: `/${string}`,
  settingName: string,
  req: Request | null = null,
): string {
  const originalHostBaseUrl = getTrustedOriginalHostBaseUrl(req);
  if (originalHostBaseUrl) {
    return `${originalHostBaseUrl}${callbackPath}`;
  }

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
