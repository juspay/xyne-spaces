/**
 * PKCE (RFC 7636) for OrcaRouter, Flow B — out-of-band code.
 *
 * Xyne Spaces is self-hosted: the claw-auth backend is a server whose public
 * address differs per deployment and is often behind a proxy, so a `127.0.0.1`
 * loopback callback cannot be served by the user's browser back to the server.
 * Flow B hands the user a URL and takes a pasted code back, exactly like the
 * repo's existing Codex/Claude sign-in UX. (The device grant is not
 * implemented — it is optional and cannot replace PKCE.)
 *
 * The verifier never leaves this process except in the exchange body. It is
 * never placed in a URL, log, error message, telemetry event or HTTP response.
 */

import crypto from "node:crypto";
import {
  ORCAROUTER_APP_NAME,
  ORCAROUTER_AUTHORIZE_PATH,
  ORCAROUTER_CODE_CHALLENGE_METHOD,
  ORCAROUTER_EXCHANGE_PATH,
  ORCAROUTER_OOB_CALLBACK,
  ORCAROUTER_SCOPE,
  ORCAROUTER_KEY_PREFIX,
  MIN_ORCAROUTER_KEY_LENGTH,
  MAX_ORCAROUTER_KEY_LENGTH,
  EXCHANGE_TIMEOUT_MS,
  assertAllowedOrcaRouterOrigin,
  resolveAuthBase,
} from "./constants.js";
import { createLogger } from "../../logger.js";

const log = createLogger("orcarouter-pkce");

/** UNPADDED base64url — the only encoding the challenge accepts. */
export function base64UrlNoPad(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkceAttempt {
  /** 32 random bytes, base64url. Never leaves the process except in the exchange body. */
  verifier: string;
  /** base64url(sha256(verifier)), unpadded. Safe to put in the authorize URL. */
  challenge: string;
  /** 16 random bytes, base64url. CSRF token, echoed back by the consent screen. */
  state: string;
}

/**
 * A fresh verifier + state for every attempt, from `crypto.randomBytes`.
 * Reusing one across attempts, or deriving it from anything guessable
 * (timestamp, username, fixed salt), defeats the whole flow.
 */
export function createPkceAttempt(): PkceAttempt {
  const verifier = base64UrlNoPad(crypto.randomBytes(32));
  const challenge = base64UrlNoPad(crypto.createHash("sha256").update(verifier).digest());
  const state = base64UrlNoPad(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

export interface BuildAuthorizeUrlInput {
  authBase?: string;
  challenge: string;
  state: string;
  appName?: string;
  scope?: string;
}

/**
 * The Flow B authorize URL. `callback_url=oob` is spelled out rather than
 * omitted so the mode is asked for rather than guessed at, and S256 is
 * mandatory for a code a human can read off a screen.
 *
 * Only origin + `/auth` + the challenge/state/app_name/scope params — the
 * verifier is not accepted by this function and cannot reach the URL.
 */
export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const authBase = assertAllowedOrcaRouterOrigin(
    input.authBase?.trim() || resolveAuthBase(),
    "authBase",
  );
  const url = new URL(`${authBase}${ORCAROUTER_AUTHORIZE_PATH}`);
  url.searchParams.set("callback_url", ORCAROUTER_OOB_CALLBACK);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", ORCAROUTER_CODE_CHALLENGE_METHOD);
  url.searchParams.set("state", input.state);
  url.searchParams.set("app_name", input.appName?.trim() || ORCAROUTER_APP_NAME);
  url.searchParams.set("scope", input.scope?.trim() || ORCAROUTER_SCOPE);
  return url.toString();
}

export interface ExchangeCodeInput {
  authBase?: string;
  code: string;
  verifier: string;
  fetchImpl?: typeof fetch;
}

export interface ExchangeCodeResult {
  /** The issued, durable `sk-orca-…` key. Belongs to the user, not to this app. */
  apiKey: string;
  /** What was GRANTED (not what was asked for). Only `api` is usable here. */
  scope: string;
  userId?: string;
}

/** A terminal exchange failure. Never carries the code or the verifier. */
export class OrcaRouterExchangeError extends Error {
  constructor(
    public readonly status: number | undefined,
    message: string,
    public readonly reason:
      | "denied"
      | "expired_or_reused"
      | "bad_request"
      | "rate_limited"
      | "scope"
      | "network"
      | "malformed",
  ) {
    super(message);
    this.name = "OrcaRouterExchangeError";
  }
}

function upstreamDetail(payload: unknown, raw: string): string {
  const record = (payload ?? {}) as Record<string, unknown>;
  for (const key of ["error_description", "message", "detail", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  }
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (!oneLine || oneLine.startsWith("{") || oneLine.startsWith("[")) return "";
  return oneLine.slice(0, 200);
}

function assertUsableKey(key: unknown): string {
  if (typeof key !== "string" || !key.trim()) {
    throw new OrcaRouterExchangeError(undefined, "OrcaRouter did not return a key. Start again.", "malformed");
  }
  const value = key.trim();
  if (!value.startsWith(ORCAROUTER_KEY_PREFIX) || value.length < MIN_ORCAROUTER_KEY_LENGTH || value.length > MAX_ORCAROUTER_KEY_LENGTH) {
    throw new OrcaRouterExchangeError(
      undefined,
      "OrcaRouter returned a value that is not an API key. Start again.",
      "malformed",
    );
  }
  return value;
}

/**
 * `POST ${authBase}/api/v1/auth/keys` with
 * `{ code, code_verifier, code_challenge_method: "S256" }`.
 *
 * The auth origin only — the inference origin's `/v1` does not serve the auth
 * endpoints, so a URL built there would 404.
 * Error semantics (denial, expired/reused code, 400, 403, 429, network) all
 * end safely with an actionable message and never hang, hot-loop, echo the key
 * or echo the verifier.
 */
export async function exchangeCode(input: ExchangeCodeInput): Promise<ExchangeCodeResult> {
  const authBase = assertAllowedOrcaRouterOrigin(
    input.authBase?.trim() || resolveAuthBase(),
    "authBase",
  );
  const code = (input.code ?? "").trim();
  if (!code) throw new OrcaRouterExchangeError(undefined, "An authorization code is required.", "bad_request");
  if (!input.verifier) {
    throw new OrcaRouterExchangeError(undefined, "This sign-in attempt has no stored verifier — start again.", "expired_or_reused");
  }

  const doFetch = input.fetchImpl ?? fetch;
  const url = `${authBase}${ORCAROUTER_EXCHANGE_PATH}`;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // The verifier appears in this body and NOWHERE else.
      body: JSON.stringify({
        code,
        code_verifier: input.verifier,
        code_challenge_method: ORCAROUTER_CODE_CHALLENGE_METHOD,
      }),
      signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    });
  } catch {
    // Transport failure: terminal for this attempt. Never a retry loop.
    throw new OrcaRouterExchangeError(
      undefined,
      "Could not reach OrcaRouter to finish sign-in. Check your connection and start again.",
      "network",
    );
  }

  const raw = await response.text().catch(() => "");
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  const detail = upstreamDetail(payload, raw);
  const record = (payload ?? {}) as Record<string, unknown>;

  if (!response.ok) {
    // OAuth-style error bodies ({error, error_description}) are what the
    // consent screen returns; `access_denied` is the user saying no.
    const oauthError = typeof record["error"] === "string" ? record["error"] : "";
    if (oauthError === "access_denied" || response.status === 401) {
      throw new OrcaRouterExchangeError(response.status, "OrcaRouter sign-in was denied.", "denied");
    }
    if (response.status === 403) {
      throw new OrcaRouterExchangeError(
        403,
        "That code is unknown, expired, or already used. Start sign-in again.",
        "expired_or_reused",
      );
    }
    if (response.status === 429) {
      throw new OrcaRouterExchangeError(
        429,
        "OrcaRouter is limiting new sign-ins (10 keys per user per 24 hours). Wait and try again, or paste an existing API key.",
        "rate_limited",
      );
    }
    if (response.status === 400) {
      throw new OrcaRouterExchangeError(
        400,
        detail
          ? `OrcaRouter rejected the exchange: ${detail}`
          : "OrcaRouter rejected the exchange. Start sign-in again.",
        "bad_request",
      );
    }
    throw new OrcaRouterExchangeError(
      response.status,
      detail ? `OrcaRouter sign-in failed: ${detail}` : `OrcaRouter sign-in failed (${response.status}).`,
      "network",
    );
  }

  const apiKey = assertUsableKey(record["key"]);

  // Read the granted scope back — the response says what was GRANTED, not what
  // was asked for. A downgrade is a terminal failure, never an assumption.
  const granted = typeof record["scope"] === "string" ? record["scope"].trim() : "";
  if (granted !== ORCAROUTER_SCOPE) {
    log.warn(`[orcarouter] exchange granted scope="${granted || "none"}" (requested "${ORCAROUTER_SCOPE}") — refusing the key`);
    throw new OrcaRouterExchangeError(
      undefined,
      granted
        ? `OrcaRouter granted the "${granted}" scope, which this app cannot use (it asks for "${ORCAROUTER_SCOPE}").`
        : `OrcaRouter did not grant the "${ORCAROUTER_SCOPE}" scope, so this key cannot be used here.`,
      "scope",
    );
  }

  const userId = typeof record["user_id"] === "string" ? record["user_id"] : undefined;
  return { apiKey, scope: granted, ...(userId ? { userId } : {}) };
}
