/** Zero serializes `ClientNotFound` as this phrase on the connection error. */
const CLIENT_NOT_FOUND_PATTERN = /client\s*not\s*found/i;
const FATAL_COOKIE_PATTERN =
  /InvalidConnectionRequest(BaseCookie|LastMutationID|ClientDeleted)|UnexpectedBaseCookie/i;

const REFRESH_COOLDOWN_MS = 2000;

let lastZeroClientRefreshAt = 0;

const reasonText = (reason: unknown): string => {
  if (reason === null || reason === undefined) return '';
  if (typeof reason === 'string') return reason;
  if (typeof reason !== 'object') return String(reason);
  const record = reason as { kind?: unknown; message?: unknown; name?: unknown };
  return [record.kind, record.message, record.name]
    .filter(value => typeof value === 'string')
    .join(' ');
};

/**
 * After `ClientNotFound` the server has disabled this client group.
 * `connection.connect()` with the same clientID always fails — mint a new Zero.
 */
export const isZeroClientStateNotFoundReason = (reason: unknown): boolean =>
  CLIENT_NOT_FOUND_PATTERN.test(reasonText(reason));

/** Cookie / client-deleted errors also require a new Zero instance, not connect(). */
export const isFatalZeroClientResetReason = (reason: unknown): boolean => {
  const text = reasonText(reason);
  return CLIENT_NOT_FOUND_PATTERN.test(text) || FATAL_COOKIE_PATTERN.test(text);
};

/**
 * Zero's `connection.connect()` only resumes terminal states (`error`, `needs-auth`).
 * Calling it while `connecting` / `connected` / `disconnected` is a no-op or can
 * abort an in-flight handshake (WS 1000).
 */
export const shouldRequestZeroConnect = (connectionName: string): boolean =>
  connectionName === 'error' || connectionName === 'needs-auth';

export const requestZeroClientRefresh = (): boolean => {
  const now = Date.now();
  if (now - lastZeroClientRefreshAt < REFRESH_COOLDOWN_MS) return false;
  lastZeroClientRefreshAt = now;
  return true;
};

/**
 * RN often polyfills `document` with `visibilityState === 'hidden'`. Zero then
 * waits for `waitForVisible()` after disconnect and never reconnects. Force
 * visible so AppState owns backgrounding.
 */
export const ensureReactNativeDocumentVisibleForZero = (): void => {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || typeof doc !== 'object') return;
  try {
    Object.defineProperty(doc, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    Object.defineProperty(doc, 'hidden', {
      configurable: true,
      get: () => false,
    });
  } catch {
    // ignore non-configurable polyfills
  }
};
