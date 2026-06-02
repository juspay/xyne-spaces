/**
 * Session Curator (HTTP client).
 *
 * The actual curator logic + LLM call lives on xyne-claw (where
 * LITELLM_API_KEY is). This thin client just POSTs the transcript and
 * returns the SubsystemUpdate array claw produces.
 *
 * Keeping the curator on claw means:
 *   - LITELLM_API_KEY stays scoped to one pod
 *   - claw-auth has no LLM credentials at all
 *   - "All LLM calls happen on claw" stays a clean invariant
 *
 * Failure modes (claw down, S2S mismatch, timeout, bad JSON) → return [].
 * Cron skips the session, logs the error; no batch fails.
 */

import { CONFIG } from "../config.js";
import { createLogger, createTraceId } from "../logger.js";
import type { SessionTranscriptForCurator, SubsystemUpdate } from "xyne-claw-shared";

const logger = createLogger("session-curator-client", createTraceId());

const CURATE_TIMEOUT_MS = Number(process.env["MEMORY_CURATOR_TIMEOUT_MS"] ?? 120_000);

export type { SessionTranscriptForCurator, SubsystemUpdate } from "xyne-claw-shared";

/**
 * POST transcript to claw's /internal/curator/distill and return the
 * SubsystemUpdate candidates. Returns [] on any failure.
 */
export async function distillSession(t: SessionTranscriptForCurator): Promise<SubsystemUpdate[]> {
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/curator/distill`;

  if (!CONFIG.xyneClawS2sKey) {
    logger.warn("[curator-client] XYNE_CLAW_S2S_KEY not set — refusing to call claw without auth", {
      sessionId: t.sessionId,
    });
    return [];
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-s2s-key": CONFIG.xyneClawS2sKey,
      },
      body: JSON.stringify(t),
      signal: AbortSignal.timeout(CURATE_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("[curator-client] claw returned non-OK", {
        sessionId: t.sessionId,
        status: res.status,
        body: body.slice(0, 300),
      });
      return [];
    }

    const data = (await res.json()) as { success?: boolean; updates?: unknown; error?: string };
    if (!data.success || !Array.isArray(data.updates)) {
      logger.warn("[curator-client] claw returned unexpected payload", {
        sessionId: t.sessionId,
        error: data.error,
      });
      return [];
    }

    logger.info("[curator-client] received candidates from claw", {
      sessionId: t.sessionId,
      agentSlug: t.agentSlug,
      count: data.updates.length,
    });

    return data.updates as SubsystemUpdate[];
  } catch (err) {
    logger.error("[curator-client] curator call failed", {
      sessionId: t.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
