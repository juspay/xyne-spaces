import { NativeModules } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

/**
 * Bridges a JS `AbortSignal` to a native in-flight request.
 *
 * Before this existed nothing could stop a request once it left JS: superseding a
 * search only made us *ignore* the answer, while the socket, the TLS handshake and
 * the native thread all ran to completion. Under fast typing that meant a dozen
 * uncancellable requests in flight at once.
 */

type CancellableCertificateModule = {
  cancelMtlsRequest?: (requestId: string) => Promise<boolean>;
  invalidateMtlsSession?: () => Promise<void>;
};

const CertificateModule = NativeModules['CertificateModule'] as
  CancellableCertificateModule | undefined;

export class RequestAbortedError extends Error {
  constructor(message = 'Request aborted') {
    super(message);
    this.name = 'RequestAbortedError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

/** Native reject codes that mean "we cancelled this on purpose", not "it failed". */
const CANCELLED_CODES = new Set(['MTLS_CANCELLED', 'ERR_CANCELED']);

function nativeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof RequestAbortedError) return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  const code = nativeErrorCode(error);
  return code !== undefined && CANCELLED_CODES.has(code);
}

export function newRequestId(): string {
  return uuidv4();
}

/**
 * Wires `signal` to the native task for `requestId` for as long as `run` is pending.
 *
 * Returns the caller's promise unchanged on success. On abort it rejects with
 * `RequestAbortedError` immediately rather than waiting for the native reject, so a
 * superseded search never holds a render open.
 */
export async function withNativeAbort<T>(
  requestId: string,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!signal) return run();

  if (signal.aborted) {
    throw new RequestAbortedError();
  }

  let settled = false;
  const onAbort = (): void => {
    if (settled) return;
    void CertificateModule?.cancelMtlsRequest?.(requestId).catch(() => undefined);
  };

  signal.addEventListener('abort', onAbort);

  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, rejectRace) => {
        signal.addEventListener('abort', () => rejectRace(new RequestAbortedError()), {
          once: true,
        });
      }),
    ]);
  } finally {
    settled = true;
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Tears down the shared native mTLS session. MUST be called whenever the client
 * identity changes — enrollment, re-enrollment, logout — because the session's
 * delegate captured the previous identity.
 */
export async function invalidateNativeMtlsSession(): Promise<void> {
  await CertificateModule?.invalidateMtlsSession?.().catch(() => undefined);
}

/**
 * Combines an external signal with a deadline.
 *
 * The native layer has its own timeout, but a native timeout cannot cover a stall
 * *before* the request reaches the socket (keychain contention, a saturated thread
 * pool). A JS-side deadline is the only thing that guarantees the promise settles.
 */
export function withDeadline(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void; didTimeOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const forward = (): void => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forward, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose: (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
}
