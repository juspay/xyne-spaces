import type { DecideQuestion } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";
import { createLogger, createTraceId } from "../logger.js";

const logger = createLogger("xor-try-client", createTraceId());
const TIMEOUT_MS = 30_000;

export interface XorTryAnswer {
  value: string | number | boolean | null;
  confidence: number | null;
  unsure: boolean;
  ok?: boolean;
}

export type XorTryResult =
  | { ok: true; answers: Record<string, XorTryAnswer>; unavailable: boolean; ms: number }
  | { ok: false; status: number; error: string };

export async function tryChecksViaClaw(req: {
  questions: DecideQuestion[];
  item: { text?: string; image?: string };
  context?: string;
}): Promise<XorTryResult> {
  if (!CONFIG.xyneClawS2sKey) return { ok: false, status: 503, error: "claw is not reachable from this deployment" };
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/xor-decide/try`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      answers?: Record<string, XorTryAnswer>;
      unavailable?: boolean;
      ms?: number;
    };
    if (!res.ok || !data.success || !data.answers) {
      logger.warn("[xor-try-client] non-OK from claw", { status: res.status, error: data.error });
      return { ok: false, status: res.status >= 400 && res.status < 500 ? res.status : 502, error: data.error ?? "xor try failed" };
    }
    return { ok: true, answers: data.answers, unavailable: data.unavailable === true, ms: data.ms ?? 0 };
  } catch (err) {
    logger.error("[xor-try-client] call failed", { err: errMsg(err) });
    return { ok: false, status: 502, error: "xor try failed — claw did not answer" };
  }
}
