/**
 * Client for XOR (Juspay Grid `POST /v1/systemone`, model `jev-latest`) — the
 * calibrated typed classifier that decides agent-creation picks.
 *
 * Grid gives this key only a handful of parallel requests and a rejected
 * request has been seen to hold a slot for a long time, so every call:
 *   1. is validated against the exact question shape before it is sent,
 *   2. takes a cluster-wide slot (claw shares the same Redis key),
 *   3. goes through a circuit breaker that stops sending after a 4xx/429.
 * Failure of any kind returns null and the caller falls back; it never throws.
 * The state text (the user's request) is never logged.
 */
import {
  validateSystemOneRequest,
  type SystemOneAnswer,
  type SystemOneQuestion,
} from "xyne-claw-shared";
import { errMsg } from "./errors.js";
import { withGlobalLlmSlot } from "./llm-slot.js";
import { createLogger } from "../logger.js";

const log = createLogger("xor");

const DEFAULT_URL = "https://grid.ai.juspay.net/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const SLOT_KEY = "claw:xor:slots";
const BREAKER_4XX_MS = 15 * 60_000;
const BREAKER_429_MS = 60_000;

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function xorEnabled(): boolean {
  if (env("XOR_SUGGEST").toLowerCase() === "off") return false;
  return env("XOR_API_KEY").length > 0;
}

function xorUrl(): string {
  return env("XOR_URL") || DEFAULT_URL;
}

function xorModel(): string {
  return env("XOR_MODEL") || DEFAULT_MODEL;
}

function xorTimeoutMs(): number {
  return Math.max(200, Number(env("XOR_TIMEOUT_MS") || 2_500));
}

/** Total parallel XOR requests across claw-auth and claw. 0 disables the gate. */
function xorMaxParallel(): number {
  const raw = env("XOR_MAX_PARALLEL");
  if (raw === "") return 4;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 4;
}

let breakerUntil = 0;
let breakerWhy = "";

export function xorBreakerOpen(now = Date.now()): boolean {
  return now < breakerUntil;
}

function tripBreaker(status: number): void {
  const ms = status === 429 ? BREAKER_429_MS : BREAKER_4XX_MS;
  const wasOpen = xorBreakerOpen();
  breakerUntil = Date.now() + ms;
  breakerWhy = `HTTP ${status}`;
  if (!wasOpen) log.warn(`[xor] circuit open for ${Math.round(ms / 1000)}s after ${breakerWhy}`);
}

/** Test/ops helper — close the breaker. */
export function resetXorBreaker(): void {
  breakerUntil = 0;
  breakerWhy = "";
}

export interface XorAskOptions {
  /** Label for the log line, so call sites are distinguishable. */
  purpose: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type XorAnswers = Record<string, SystemOneAnswer>;
export type XorAsk = (
  state: string,
  questions: Record<string, SystemOneQuestion>,
  opts: XorAskOptions,
) => Promise<XorAnswers | null>;

export const xorAsk: XorAsk = async (state, questions, opts) => {
  if (!xorEnabled()) return null;
  if (xorBreakerOpen()) {
    log.info(`[xor] purpose=${opts.purpose} skipped — circuit open (${breakerWhy})`);
    return null;
  }
  const verdict = validateSystemOneRequest({ state, questions });
  if (!verdict.ok) {
    log.warn(
      `[xor] purpose=${opts.purpose} refused before sending: ${verdict.reason} ` +
        `ids=${Object.keys(questions).slice(0, 12).join(",")}`,
    );
    return null;
  }

  const timeoutMs = opts.timeoutMs ?? xorTimeoutMs();
  const count = Object.keys(questions).length;
  const started = Date.now();
  const call = async (): Promise<XorAnswers | null> => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const res = await fetch(xorUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env("XOR_API_KEY")}`,
      },
      body: JSON.stringify({ state, model: xorModel(), questions }),
      signal,
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      // Status only: the body of a Grid 429 echoes the key's hash.
      log.warn(`[xor] purpose=${opts.purpose} questions=${count} HTTP ${res.status} ms=${ms}`);
      if (res.status >= 400 && res.status < 500) tripBreaker(res.status);
      return null;
    }
    const json = (await res.json()) as { answers?: XorAnswers };
    if (!json.answers || typeof json.answers !== "object") {
      log.warn(`[xor] purpose=${opts.purpose} questions=${count} response had no answers ms=${ms}`);
      return null;
    }
    log.info(`[xor] purpose=${opts.purpose} questions=${count} ok ms=${ms}`);
    return json.answers;
  };

  try {
    return await withGlobalLlmSlot(
      { key: SLOT_KEY, cap: xorMaxParallel(), waitMs: 1_000, ttlMs: timeoutMs + 2_000, label: "xor" },
      call,
    );
  } catch (err) {
    log.warn(`[xor] purpose=${opts.purpose} questions=${count} unavailable after ${Date.now() - started}ms: ${errMsg(err)}`);
    return null;
  }
};
