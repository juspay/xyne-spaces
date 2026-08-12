/**
 * S2S client for claw's instant-ask completion endpoint.
 *
 * The completion itself runs on xyne-claw, where LITELLM_API_KEY lives —
 * claw-auth holds no LLM credentials (same arrangement as
 * entityExtraction/entityLlmClient.ts and sessionCurator.ts). This side owns
 * everything that isn't the credential: KB search, prompt assembly, and
 * citation shaping (see lib/instant-ask.ts).
 */

import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { consumeClawStream } from "../lib/consume-claw-stream.js";

const log = createLogger("instant-ask-client");

/** Matches claw-side INSTANT_ASK_TIMEOUT_MS plus slack for retries. */
const CLAW_TIMEOUT_MS = Number(process.env["INSTANT_ASK_TIMEOUT_MS"] ?? 60_000) + 15_000;

export interface InstantAskChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** An agent's own resolved "bring your own key" LiteLLM credential — see
 *  lib/agent-provider-config.ts's resolveAgentProviderConfigs. Forwarded to
 *  claw over the already-S2S-authenticated channel; never touches the
 *  browser. */
export interface InstantAskCredential {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** One raw completion via claw's S2S instant-ask endpoint. */
export async function completeInstantViaClaw(
  messages: InstantAskChatMessage[],
  purpose?: string,
  opts?: { model?: "classify"; jsonMode?: boolean; credential?: InstantAskCredential },
): Promise<string> {
  if (!CONFIG.xyneClawS2sKey) {
    throw new Error("XYNE_CLAW_S2S_KEY not set — instant ask cannot reach claw");
  }

  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/instant/complete`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify({
        messages,
        ...(purpose ? { purpose } : {}),
        ...(opts?.model ? { model: opts.model } : {}),
        ...(opts?.jsonMode ? { jsonMode: true } : {}),
        ...(opts?.credential ? { credential: opts.credential } : {}),
      }),
      signal: AbortSignal.timeout(CLAW_TIMEOUT_MS),
    });
  } catch (err) {
    log.error(`[instant-ask-client] failed to reach claw at ${url}: ${err instanceof Error ? err.message : String(err)}`);
    throw new Error("Failed to reach claw for instant completion");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`claw instant-ask ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { success?: boolean; content?: unknown; error?: unknown };
  if (!data.success || typeof data.content !== "string") {
    throw new Error(`claw instant-ask returned no content: ${String(data.error ?? "unknown")}`);
  }
  return data.content;
}

/**
 * Streaming variant — hits claw's `/internal/instant/stream` SSE endpoint
 * (instant-ask.ts on claw) and forwards each token chunk to `onTextDelta`
 * as it arrives, same live behavior as a normal agentic run's `event: delta`
 * frames. Reuses consumeClawStream — the exact same SSE consumer run-stream.ts
 * uses for the full agentic dispatch — since claw's instant stream route
 * emits the identical ClawStreamEvent wire format (frameSseEvent).
 */
export async function streamInstantViaClaw(
  messages: InstantAskChatMessage[],
  opts: {
    sessionId: string;
    purpose?: string;
    credential?: InstantAskCredential;
    onTextDelta: (delta: string) => void;
  },
): Promise<string> {
  if (!CONFIG.xyneClawS2sKey) {
    throw new Error("XYNE_CLAW_S2S_KEY not set — instant ask cannot reach claw");
  }

  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/instant/stream`;
  let accumulated = "";
  let streamError: string | undefined;

  const result = await consumeClawStream({
    url,
    body: {
      messages,
      sessionId: opts.sessionId,
      ...(opts.purpose ? { purpose: opts.purpose } : {}),
      ...(opts.credential ? { credential: opts.credential } : {}),
    },
    s2sKey: CONFIG.xyneClawS2sKey,
    signal: AbortSignal.timeout(CLAW_TIMEOUT_MS),
    handlers: {
      onTextDelta: (_sid, delta) => {
        if (!delta) return;
        accumulated += delta;
        opts.onTextDelta(delta);
      },
      onError: (_sid, error) => {
        streamError = error;
      },
    },
  }).catch((err: unknown) => {
    log.error(`[instant-ask-client] stream failed reaching claw at ${url}: ${err instanceof Error ? err.message : String(err)}`);
    throw new Error("Failed to reach claw for instant stream completion");
  });

  if (streamError) {
    throw new Error(`claw instant-ask stream error: ${streamError}`);
  }
  if (!result.result || result.result.status !== "completed") {
    throw new Error(`claw instant-ask stream ended without completion (lastEvent=${result.lastEventName ?? "none"})`);
  }
  // Prefer claw's own authoritative final text (the `content` field on its
  // done payload) over what we accumulated locally from delta chunks — same
  // value in practice (frames arrive strictly in order), but this is immune
  // to a throwing onTextDelta handler silently under-counting `accumulated`.
  const doneContent = result.result["content"];
  return typeof doneContent === "string" ? doneContent : accumulated;
}
