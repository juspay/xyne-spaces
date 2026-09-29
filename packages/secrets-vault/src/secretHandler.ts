export interface VerifyResult {
  ok: boolean;
  /** Why verification failed — surfaced all the way to the HTTP response's `message`, so the UI can show it, not just the server logs. */
  reason?: string;
}

export interface SecretHandler {
  rotate: () => Promise<string | null>;
  verify: (value: string) => Promise<VerifyResult>;
}

/**
 * Most third-party credentials (GitHub PATs, Mettle tokens, ...) have no
 * self-service mint API — a human generates a new value and pastes it in
 * manually — so these are the defaults: `rotate` returns null (nothing to
 * automate; the rotation cron treats null as "skip, needs a human," not a
 * failure), `verify` passes unconditionally (no healthcheck performed).
 * Pass overrides for whichever one a service actually supports.
 */
export function createSecretHandler(overrides: Partial<SecretHandler> = {}): SecretHandler {
  return {
    rotate: overrides.rotate ?? (async () => null),
    verify: overrides.verify ?? (async () => ({ ok: true })),
  };
}
