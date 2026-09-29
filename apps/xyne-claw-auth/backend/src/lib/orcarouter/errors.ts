/**
 * Terminal-failure classification for OrcaRouter.
 *
 * Two surfaces, one rule: a durable OrcaRouter key is NOT a refresh token.
 * There is no refresh grant and no refresh endpoint, so an authentication
 * failure must never become a retry loop or a fake refresh — it marks the exact
 * account/credential generation for reauthentication and stops.
 *
 * Generation safety matters because a rejected request can land AFTER the user
 * has re-authorized: a late failure from an old request must never mark a
 * newer, working credential as broken.
 */

import { OrcaRouterExchangeError } from "./pkce.js";

export type OrcaRouterFailureKind =
  | "needsReauth"
  | "denied"
  | "expiredOrReused"
  | "badRequest"
  | "scopeDowngrade"
  | "rateLimited"
  | "unavailable"
  | "invalidRequest"
  | "forbidden"
  | "unknown";

export interface OrcaRouterFailure {
  kind: OrcaRouterFailureKind;
  /** True when the stored credential cannot be used again until a NEW login succeeds. */
  terminal: boolean;
  /** Always false: a durable key grant has no refresh grant. */
  refreshable: false;
  /** Safe to retry the same request (after honouring any Retry-After / delay). */
  retryable: boolean;
  message: string;
  status?: number;
}

export type OrcaRouterFailureSurface = "exchange" | "inference";

export interface OrcaRouterFailureInput {
  surface: OrcaRouterFailureSurface;
  status?: number | undefined;
  /** OAuth-style `error` code from the body, when present (`access_denied`, …). */
  error?: string | undefined;
  /** Short, already-sanitized upstream detail. Never the key or the verifier. */
  detail?: string | undefined;
}

function failure(
  kind: OrcaRouterFailureKind,
  message: string,
  opts: { terminal: boolean; retryable: boolean; status?: number | undefined },
): OrcaRouterFailure {
  return {
    kind,
    terminal: opts.terminal,
    refreshable: false,
    retryable: opts.retryable,
    message,
    ...(opts.status !== undefined ? { status: opts.status } : {}),
  };
}

/**
 * Classify an exchange or inference failure.
 *
 * Inference: a `401` from the relay means the key was revoked or is otherwise
 * no longer accepted — that is `needsReauth` for the exact credential
 * generation, with no refresh attempt and no retry.
 */
export function classifyOrcaRouterFailure(input: OrcaRouterFailureInput): OrcaRouterFailure {
  const { status, error, detail, surface } = input;
  const suffix = detail ? ` (${detail})` : "";

  if (surface === "exchange") {
    if (error === "access_denied" || status === 401) {
      return failure("denied", "OrcaRouter sign-in was denied.", { terminal: true, retryable: false, status });
    }
    if (status === 403) {
      return failure(
        "expiredOrReused",
        "That code is unknown, expired, or already used. Start sign-in again.",
        { terminal: true, retryable: false, status: 403 },
      );
    }
    if (status === 400) {
      return failure("badRequest", `OrcaRouter rejected the exchange${suffix}.`, {
        terminal: true,
        retryable: false,
        status: 400,
      });
    }
    if (status === 429) {
      return failure(
        "rateLimited",
        "OrcaRouter is limiting new sign-ins. Wait, then start sign-in again.",
        { terminal: false, retryable: true, status: 429 },
      );
    }
    if (status === undefined || status >= 500) {
      return failure(
        "unavailable",
        `OrcaRouter could not finish sign-in${suffix}. Nothing was saved — try again.`,
        { terminal: false, retryable: true, status },
      );
    }
    return failure("unknown", `OrcaRouter sign-in failed${suffix}.`, {
      terminal: false,
      retryable: false,
      status,
    });
  }

  // Inference relay.
  if (status === 401) {
    return failure(
      "needsReauth",
      "OrcaRouter no longer accepts this key — sign in again (or paste a new key) to reconnect.",
      { terminal: true, retryable: false, status: 401 },
    );
  }
  if (status === 403) {
    return failure("forbidden", `OrcaRouter refused this request${suffix}.`, {
      terminal: false,
      retryable: false,
      status: 403,
    });
  }
  if (status === 400) {
    return failure("invalidRequest", `OrcaRouter rejected this request${suffix}.`, {
      terminal: false,
      retryable: false,
      status: 400,
    });
  }
  if (status === 429) {
    return failure("rateLimited", "OrcaRouter is rate limiting this key. Slow down and retry.", {
      terminal: false,
      retryable: true,
      status: 429,
    });
  }
  if (status === undefined || status >= 500) {
    return failure("unavailable", `OrcaRouter is unreachable${suffix}.`, {
      terminal: false,
      retryable: true,
      status,
    });
  }
  return failure("unknown", `OrcaRouter request failed${suffix}.`, {
    terminal: false,
    retryable: false,
    status,
  });
}

/** Map a thrown exchange error onto the same failure shape. */
export function classifyExchangeError(err: unknown): OrcaRouterFailure {
  if (err instanceof OrcaRouterExchangeError) {
    const kind: OrcaRouterFailureKind =
      err.reason === "scope"
        ? "scopeDowngrade"
        : err.reason === "denied"
          ? "denied"
          : err.reason === "expired_or_reused"
            ? "expiredOrReused"
            : err.reason === "bad_request"
              ? "badRequest"
              : err.reason === "rate_limited"
                ? "rateLimited"
                : err.reason === "network"
                  ? "unavailable"
                  : "unknown";
    const retryable = kind === "rateLimited" || kind === "unavailable";
    return failure(kind, err.message, {
      terminal: !retryable,
      retryable,
      status: err.status,
    });
  }
  return failure("unknown", "OrcaRouter sign-in failed.", { terminal: false, retryable: false });
}

export function isNeedsReauth(failure: OrcaRouterFailure): boolean {
  return failure.kind === "needsReauth";
}

// ── Generation-safe reauthentication marking ──────────────────────────────────

/** The exact account + credential generation that made the rejected request. */
export interface OrcaRouterCredentialSubject {
  userId: string;
  provider: string;
  /** Monotonically increasing per successful login; a new login mints a new one. */
  generation: number;
}

/** The account identity, without a generation. */
export type OrcaRouterAccount = Omit<OrcaRouterCredentialSubject, "generation">;

export interface OrcaRouterCredentialStateStore {
  /** The generation of the credential currently stored for this account, or
   *  null when there is none. */
  currentGeneration(account: OrcaRouterAccount): Promise<number | null> | number | null;
  /** Persist the needsReauth marker for this exact generation. */
  markNeedsReauth(subject: OrcaRouterCredentialSubject): Promise<void> | void;
}

export interface ApplyFailureResult {
  applied: boolean;
  reason?: "not-terminal" | "stale-generation" | "no-credential";
  /** Always false — there is no refresh grant to attempt. */
  refreshed: false;
}

/**
 * Apply a classified failure to the exact account/generation.
 *
 * Only a terminal `needsReauth` marks anything, only when the subject IS the
 * credential currently stored, and never a refresh. The old secret is left in
 * place (the caller decides when to replace it) so a transient or
 * misclassified failure cannot become irreversible account loss.
 */
export async function applyOrcaRouterFailure(
  classified: OrcaRouterFailure,
  subject: OrcaRouterCredentialSubject,
  store: OrcaRouterCredentialStateStore,
): Promise<ApplyFailureResult> {
  if (!classified.terminal || classified.kind !== "needsReauth") {
    return { applied: false, reason: "not-terminal", refreshed: false };
  }
  const current = await store.currentGeneration({ userId: subject.userId, provider: subject.provider });
  if (current === null) return { applied: false, reason: "no-credential", refreshed: false };
  if (current !== subject.generation) {
    // A late failure from an old request must not mark a newer credential.
    return { applied: false, reason: "stale-generation", refreshed: false };
  }
  await store.markNeedsReauth(subject);
  return { applied: true, refreshed: false };
}

// ── No refresh grant ─────────────────────────────────────────────────────────

/** A PKCE-issued OrcaRouter key is durable. It is not a refresh token. */
export const ORCAROUTER_REFRESH_GRANT_AVAILABLE = false;

export class OrcaRouterNoRefreshGrantError extends Error {
  constructor() {
    super(
      "OrcaRouter issues a durable API key, not a refreshable token. Reuse the stored key until OrcaRouter revokes it; a revoked key requires a new login.",
    );
    this.name = "OrcaRouterNoRefreshGrantError";
  }
}

/**
 * There is nothing to call. Exists so a caller that reaches for a refresh gets
 * a clear terminal refusal instead of inventing a grant.
 */
export function refreshOrcaRouterCredential(): Promise<never> {
  return Promise.reject(new OrcaRouterNoRefreshGrantError());
}

/** In-memory store, for tests and for callers without a persistence layer. */
export function createInMemoryCredentialStateStore(
  initial: readonly OrcaRouterCredentialSubject[] = [],
): OrcaRouterCredentialStateStore & { marked: OrcaRouterCredentialSubject[] } {
  const generations = new Map<string, number>();
  const marked: OrcaRouterCredentialSubject[] = [];
  const key = (account: OrcaRouterAccount): string => `${account.userId}:${account.provider}`;
  for (const subject of initial) generations.set(key(subject), subject.generation);
  return {
    marked,
    currentGeneration: (account) => generations.get(key(account)) ?? null,
    markNeedsReauth: (subject) => {
      marked.push({ ...subject });
    },
  };
}
