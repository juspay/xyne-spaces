import { CONFIG } from "../../config.js";
import { createLogger } from "../../logger.js";
import { decryptSurfaceSecret } from "../../lib/surface-resolver.js";
import { postExternalCallback } from "./api.js";
import {
  RETRY_DELAYS_MS,
  MAX_DELIVERY_ATTEMPTS,
  ALLOWED_PROTOCOLS,
  BLOCKED_HOSTNAMES,
  LINK_LOCAL_IPV4_RE,
  DEV_LOCAL_HOSTNAMES,
} from "./const.js";

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
    return DEV_LOCAL_HOSTNAMES.has(hostname);
  }
  return false;
}

/** Validate the deliberately narrow SSRF policy for external result delivery. */
export function isAllowedExternalCallbackUrl(callbackUrl: string): boolean {
  const parsed = parseUrl(callbackUrl);
  if (!parsed || !ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (LINK_LOCAL_IPV4_RE.test(hostname)) return false;
  return true;
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
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    const outcome = await postExternalCallback({
      url: callback.url,
      body: rawBody,
      ...(callback.secret !== undefined ? { secret: callback.secret } : {}),
    });
    const isLastAttempt = attempt === MAX_DELIVERY_ATTEMPTS;

    if (outcome.kind === "delivered") {
      log.info(`[external-callback] delivered session=${payload.sessionId} attempt=${attempt} status=${outcome.httpStatus}`);
      return "delivered";
    }

    if (outcome.kind === "rejected") {
      log.warn(`[external-callback] rejected session=${payload.sessionId} attempt=${attempt} status=${outcome.httpStatus} retry=${outcome.retryable && !isLastAttempt}`);
      if (!outcome.retryable || isLastAttempt) return "failed";
    } else {
      // api.ts deliberately returns no error detail here — the underlying fetch
      // error can carry request headers, and those include callbackSecret.
      log.warn(`[external-callback] network failure session=${payload.sessionId} attempt=${attempt} retry=${!isLastAttempt}`);
      if (isLastAttempt) return "failed";
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
