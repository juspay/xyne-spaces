import { API_BASE_URL } from '../config.js';
import { webCryptoTransitCrypto, type TransitCrypto } from './transit-crypto.js';

/** The parts of a response the transit and manifest calls read. */
export interface TransitResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** How the transit and manifest calls reach the API (relative paths, JSON bodies). */
export interface TransitHttp {
  request(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<TransitResponse>;
}

/** What a host provides for transit encryption. */
export interface TransitPlatform {
  crypto: TransitCrypto;
  http: TransitHttp;
}

/** Browsers and desktop: WebCrypto, and the API with the session cookie. */
const webTransitHttp: TransitHttp = {
  request: (path, { method = 'GET', body } = {}) =>
    fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
};

let platform: TransitPlatform = { crypto: webCryptoTransitCrypto, http: webTransitHttp };

/** Called once at startup by hosts that differ from the browser (React Native). */
export function setTransitPlatform(next: Partial<TransitPlatform>): void {
  platform = { ...platform, ...next };
}

export function getTransitPlatform(): TransitPlatform {
  return platform;
}
