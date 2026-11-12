/**
 * Service-assertion headers for a call to one of our own services, picked by the
 * target URL's origin: claw-auth itself, the xyne-claw runtime, or Spaces.
 * Used where a URL is built at runtime (callbacks, forwards); a fixed target
 * can call serviceAuthHeaders(aud, …) directly.
 */
import { CONFIG } from "../config.js";
import { serviceAuthHeaders, type ServiceName } from "./service-assertion.js";

function origin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Which of our services `url` points at, or undefined for anything else. */
export function serviceForUrl(url: string): ServiceName | undefined {
  const o = origin(url);
  if (!o) return undefined;
  if ([CONFIG.internalUrl, CONFIG.selfUrl].map(origin).includes(o)) return "xyne-claw-auth";
  if (origin(CONFIG.xyneClawUrl) === o) return "xyne-claw";
  if ([CONFIG.spacesInternalUrl, CONFIG.spacesBackendUrl].map(origin).includes(o)) return "xyne-spaces";
  return undefined;
}

/** Assertion headers when `url` is one of our services; {} otherwise (never sign for third parties). */
export function internalServiceHeaders(method: string, url: string): Record<string, string> {
  const aud = serviceForUrl(url);
  return aud ? serviceAuthHeaders(aud, method, url) : {};
}
