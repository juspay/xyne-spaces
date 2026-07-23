import { createHmac } from "node:crypto";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { decryptSurfaceSecret } from "./surface-resolver.js";

const log = createLogger("external-result-callback");

export interface CallbackOriginConfig {
  selfUrl: string;
  internalUrl?: string;
  xyneClawUrl: string;
  nodeEnv?: string;
}

export interface ExternalResultCallbackConfig {
  url: string;
  encryptedSecret?: string;
}

export interface ExternalResultPayload {
  sessionId: string;
  status: string;
  result: unknown;
  error?: string;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** True only for callback origins owned by claw-auth/claw itself. */
export function isInternalCallbackOrigin(
  callbackUrl: string,
  config: CallbackOriginConfig = {
    selfUrl: CONFIG.selfUrl,
    internalUrl: CONFIG.internalUrl,
    xyneClawUrl: CONFIG.xyneClawUrl,
    ...(process.env["NODE_ENV"] ? { nodeEnv: process.env["NODE_ENV"] } : {}),
  },
): boolean {
  const candidate = parseUrl(callbackUrl);
  if (!candidate) return false;

  const knownOrigins = [config.selfUrl, config.internalUrl, config.xyneClawUrl]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map(parseUrl)
    .filter((value): value is URL => value !== null)
    .map((value) => value.origin);
  if (knownOrigins.includes(candidate.origin)) return true;

  if (config.nodeEnv === "development") {
    const hostname = candidate.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  }
  return false;
}

/** Validate the deliberately narrow SSRF policy for external result delivery. */
export function isAllowedExternalCallbackUrl(callbackUrl: string): boolean {
  const parsed = parseUrl(callbackUrl);
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return false;

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "metadata.google.internal") return false;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return false;
  return true;
}

const RETRY_DELAYS_MS = [1_000, 3_000] as const;

function shouldRetryStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deliver a terminal result to an external integrator. This intentionally does
 * not know about the internal claw/auth S2S key: x-s2s-key, when present, is
 * exclusively the caller-provided callback secret.
 */
export async function sendExternalResultCallback(
  callback: { url: string; secret?: string },
  payload: ExternalResultPayload,
): Promise<"delivered" | "refused" | "failed"> {
  if (!isAllowedExternalCallbackUrl(callback.url)) {
    log.warn(`[external-callback] refused unsafe callback target session=${payload.sessionId}`);
    return "refused";
  }

  const rawBody = JSON.stringify({
    sessionId: payload.sessionId,
    status: payload.status,
    result: payload.result,
    ...(payload.error ? { error: payload.error } : {}),
  });
  const hasSecret = callback.secret !== undefined;
  const signature = hasSecret
    ? `sha256=${createHmac("sha256", callback.secret!).update(rawBody).digest("hex")}`
    : undefined;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(callback.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(hasSecret ? { "x-s2s-key": callback.secret! } : {}),
          ...(signature ? { "x-claw-signature": signature } : {}),
        },
        body: rawBody,
        redirect: "manual",
      });
      if (response.ok) {
        log.info(`[external-callback] delivered session=${payload.sessionId} attempt=${attempt} status=${response.status}`);
        return "delivered";
      }

      const retryable = shouldRetryStatus(response.status);
      log.warn(`[external-callback] rejected session=${payload.sessionId} attempt=${attempt} status=${response.status} retry=${retryable && attempt < 3}`);
      if (!retryable || attempt === 3) return "failed";
    } catch {
      // Do not log the thrown error: custom fetch implementations can include
      // request headers in it, which would risk exposing callbackSecret.
      log.warn(`[external-callback] network failure session=${payload.sessionId} attempt=${attempt} retry=${attempt < 3}`);
      if (attempt === 3) return "failed";
    }

    await delay(RETRY_DELAYS_MS[attempt - 1]!);
  }
  return "failed";
}

/** Result-endpoint adapter for the encrypted configuration persisted by /run. */
export async function sendStoredExternalResultCallback(
  callback: ExternalResultCallbackConfig,
  payload: ExternalResultPayload,
): Promise<"delivered" | "refused" | "failed"> {
  let secret: string | undefined;
  if (callback.encryptedSecret) {
    try {
      secret = decryptSurfaceSecret(callback.encryptedSecret, "external callback secret");
    } catch {
      log.warn(`[external-callback] stored secret could not be decrypted session=${payload.sessionId}`);
      return "failed";
    }
  }
  return sendExternalResultCallback(
    { url: callback.url, ...(secret !== undefined ? { secret } : {}) },
    payload,
  );
}
