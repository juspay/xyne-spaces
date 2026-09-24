import { net, WebContentsView } from 'electron';
import log from 'electron-log/main';

const CLIENT_CERT_NEEDED = 'ERR_SSL_CLIENT_AUTH_CERT_NEEDED';
const PRIME_PATH = '/api/health';

const priming = new Map<string, Promise<void>>();

export function needsClientCertificate(err: unknown): boolean {
  return String(err instanceof Error ? err.message : err).includes(CLIENT_CERT_NEEDED);
}

async function selectClientCertificate(origin: string): Promise<void> {
  const view = new WebContentsView({ webPreferences: { javascript: false } });
  try {
    await view.webContents.loadURL(`${origin}${PRIME_PATH}`);
  } catch (err) {
    log.warn(`[LocalHarness] client certificate selection for ${origin} failed:`, err);
  } finally {
    view.webContents.close();
  }
}

export function primeClientCertificate(origin: string): Promise<void> {
  let pending = priming.get(origin);
  if (!pending) {
    pending = selectClientCertificate(origin).finally(() => priming.delete(origin));
    priming.set(origin, pending);
  }
  return pending;
}

export async function harnessFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const request: RequestInit = { ...init, credentials: 'omit' };
  try {
    return await net.fetch(url, request);
  } catch (err) {
    if (!needsClientCertificate(err)) throw err;
    await primeClientCertificate(new URL(url).origin);
    return net.fetch(url, request);
  }
}
