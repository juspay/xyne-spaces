import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import type { PlannedLoopInput } from "./schedule.js";
import { serviceAuthHeaders, serviceSigningConfigured } from "../lib/service-assertion.js";

const log = createLogger("proactive-claw-client");

const TRIAGE_TIMEOUT_MS = Number(process.env["PROACTIVE_TRIAGE_TIMEOUT_MS"] ?? 60_000);
const EXTRACT_TIMEOUT_MS = Number(process.env["PROACTIVE_EXTRACT_TIMEOUT_MS"] ?? 120_000);

export interface TriageScores {
  needsReply: number | null;
  hasDeadline: number | null;
  importance: number | null;
  kind: "ask" | "deadline" | "reply" | "fyi" | "noise" | null;
}

export interface ExtractRequest {
  now: string;
  timezone: string;
  userName?: string;
  userAddress?: string;
  subject?: string;
  messages: Array<{ from: string; at: string; fromUser: boolean; text: string }>;
}

export interface ExtractResponse {
  summary: string;
  loops: PlannedLoopInput[];
}

export interface InterruptResponse {
  decision: "ignore" | "later" | "text";
  confidence: number;
}

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T | null> {
  if (!serviceSigningConfigured()) return null;
  try {
    const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...serviceAuthHeaders("xyne-claw", "POST", url) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      if (res.status !== 503) log.warn(`[proactive] ${path} → ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { success?: boolean } & T;
    return data.success ? data : null;
  } catch (err) {
    log.warn(`[proactive] ${path} failed: ${errMsg(err)}`);
    return null;
  }
}

export async function triageViaClaw(
  items: Array<{ key: string; state: string }>,
): Promise<Record<string, TriageScores | null> | null> {
  if (items.length === 0) return {};
  const data = await post<{ results?: Record<string, TriageScores | null> }>("/inbox/triage", { items }, TRIAGE_TIMEOUT_MS);
  return data?.results ?? null;
}

export async function extractViaClaw(req: ExtractRequest): Promise<ExtractResponse | null> {
  const data = await post<ExtractResponse>("/inbox/extract", req, EXTRACT_TIMEOUT_MS);
  return data && Array.isArray(data.loops) ? { summary: data.summary ?? "", loops: data.loops } : null;
}

export async function interruptViaClaw(state: string): Promise<InterruptResponse | null> {
  const data = await post<InterruptResponse>("/inbox/interrupt", { state }, TRIAGE_TIMEOUT_MS);
  return data?.decision ? { decision: data.decision, confidence: data.confidence ?? 0 } : null;
}
