/**
 * HTTP client for laya-serve (`POST /v1/systemone`).
 * Loopback only — never expose outside claw-auth.
 */
import { createLogger } from "../logger.js";

const log = createLogger("laya-client");

export type LayaSuggestMode = "off" | "shadow" | "fast";

export function layaSuggestMode(): LayaSuggestMode {
  const raw = (process.env["LAYA_SUGGEST"] ?? "fast").trim().toLowerCase();
  if (raw === "off" || raw === "shadow" || raw === "fast") return raw;
  return "fast";
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

export async function layaHealth(): Promise<boolean> {
  if (layaSuggestMode() === "off") return false;
  try {
    const key = layaApiKey();
    // Real `laya` package serves GET /health; standalone `laya-serve` serves /healthz.
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
