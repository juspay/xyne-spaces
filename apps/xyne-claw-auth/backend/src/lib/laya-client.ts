/**
 * HTTP client for laya-serve (`POST /v1/systemone`).
 * Loopback only — never expose outside claw-auth.
 * Default LAYA_SUGGEST=shadow until golden eval beats stage C (see ship report).
 */
import { createLogger } from "../logger.js";

const log = createLogger("laya-client");

export type LayaSuggestMode = "off" | "shadow" | "fast";

export function layaSuggestMode(): LayaSuggestMode {
  const raw = (process.env["LAYA_SUGGEST"] ?? "shadow").trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "fast") return raw;
  return "shadow";
}

function layaUrl(): string {
  return (process.env["LAYA_URL"] ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
}

function layaApiKey(): string {
  return process.env["LAYA_API_KEY"] ?? "";
}

function layaTimeoutMs(): number {
  return Math.max(200, Number(process.env["LAYA_TIMEOUT_MS"] ?? 2_500));
}

export type LayaQuestion =
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: "score";
      instructions: string;
      criteria: string[];
    }
  | {
      type: "noul";
      instructions: string;
    };

export interface LayaSystemOneResponse {
  answers?: Record<
    string,
    {
      choice?: string;
      score?: number;
      noul?: number;
      confidence?: number;
      probabilities?: Record<string, number>;
    }
  >;
  routing?: { model?: string; latency_ms?: number };
}

function layaModel(): string {
  return (process.env["LAYA_MODEL"] ?? "laya").trim() || "laya";
}

const HEALTH_CACHE_MS = 30_000;
let healthCache: { at: number; ok: boolean } | null = null;

export async function layaHealth(): Promise<boolean> {
  if (layaSuggestMode() === "off") return false;
  try {
    const key = layaApiKey();
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    let res = await fetch(`${layaUrl()}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(layaTimeoutMs()),
      headers,
    });
    if (res.status === 404) {
      res = await fetch(`${layaUrl()}/healthz`, {
        method: "GET",
        signal: AbortSignal.timeout(layaTimeoutMs()),
        headers,
      });
    }
    return res.ok;
  } catch {
    return false;
  }
}

/** Cached health probe (30s) so parallel per-hub shortlists share one check. */
export async function layaHealthCached(): Promise<boolean> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_CACHE_MS) return healthCache.ok;
  const ok = await layaHealth();
  healthCache = { at: now, ok };
  return ok;
}

/** Test helper — clear health cache between cases. */
export function clearLayaHealthCache(): void {
  healthCache = null;
}

export async function layaSystemOne(
  state: string,
  questions: Record<string, LayaQuestion>,
): Promise<LayaSystemOneResponse | null> {
  if (layaSuggestMode() === "off") return null;
  if (Object.keys(questions).length === 0) return { answers: {} };
  try {
    const key = layaApiKey();
    const res = await fetch(`${layaUrl()}/v1/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ state, model: layaModel(), questions }),
      signal: AbortSignal.timeout(layaTimeoutMs()),
    });
    if (!res.ok) {
      log.warn(`[laya] systemone HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as LayaSystemOneResponse;
  } catch (err) {
    log.warn(`[laya] systemone failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
