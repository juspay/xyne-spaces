/**
 * One way for claw-auth to POST to an xyne-claw S2S endpoint (goal judge,
 * respond gate, …). Owns the S2S key check, URL join, header, timeout, non-OK
 * handling and JSON parse, and NEVER throws — every failure comes back as a
 * typed `ok: false` so each caller maps it onto its own fail-closed decision.
 *
 * It deliberately does not log or validate the payload: callers keep their own
 * log lines and response shape checks, so moving onto this changes no behaviour.
 */
import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";

export type ClawS2sFailure =
  /** XYNE_CLAW_S2S_KEY is not configured — no request was made. */
  | { ok: false; kind: "no-key"; error: string }
  /** Claw answered with a non-2xx status. `body` is the first 200 chars. */
  | { ok: false; kind: "http"; status: number; body: string; error: string }
  /** Network error, timeout, abort or an unparseable JSON body. */
  | { ok: false; kind: "error"; error: string };

export type ClawS2sResult = { ok: true; data: unknown } | ClawS2sFailure;

export interface ClawS2sOptions {
  timeoutMs: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export function clawUrl(path: string): string {
  return `${CONFIG.xyneClawUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function postToClaw(path: string, body: unknown, opts: ClawS2sOptions): Promise<ClawS2sResult> {
  const key = CONFIG.xyneClawS2sKey;
  if (!key) return { ok: false, kind: "no-key", error: "XYNE_CLAW_S2S_KEY not set" };
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(clawUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, kind: "http", status: res.status, body: text.slice(0, 200), error: `HTTP ${res.status}` };
    }
    return { ok: true, data: (await res.json()) as unknown };
  } catch (err) {
    return { ok: false, kind: "error", error: errMsg(err) };
  }
}
