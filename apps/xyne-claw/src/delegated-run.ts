/**
 * delegated-run.ts — records an A2A delegation as a first-class run.
 *
 * A `call-agent` callee runs in-process here, never passing through claw-auth's
 * `startRun`, so without these it leaves no row in the runs panel. Best-effort:
 * bookkeeping must never fail a delegation.
 */

import { SERVER } from "./config.js";
import { createLogger } from "./logger.js";
import type { LatencyMetrics, TokenUsage, ToolInvocation } from "./debug/index.js";

const log = createLogger("delegated-run");

const REPORT_TIMEOUT_MS = 10_000;

export interface DelegatedRunStart {
  sessionId: string;
  userId: string;
  agentSlug: string;
  task: string;
  /** The callee's OWN thread — never the caller's. Its transcript lives here,
   *  so this is what the runs panel opens. */
  conversationId: string;
  parentSessionId: string;
  parentAgentSlug?: string | undefined;
  parentToolCallId: string;
}

export interface DelegatedRunFinish {
  sessionId: string;
  status: "completed" | "failed" | "cancelled";
  result?: string | undefined;
  error?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  toolsUsed?: string[] | undefined;
  toolInvocations?: ToolInvocation[] | undefined;
  tokenUsage?: TokenUsage | undefined;
  latency?: LatencyMetrics | undefined;
}

async function post(path: string, body: unknown): Promise<void> {
  const base = SERVER.authServiceUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/claw/api/v1/internal/delegated-run/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Opens the child's row as "running" so the panel shows it while it works. */
export async function reportDelegatedRunStart(input: DelegatedRunStart): Promise<void> {
  await post("start", input).catch((err: unknown) => {
    log.warn(`start failed for ${input.agentSlug}: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/** Closes the child's row with the same payload a top-level run reports. */
export async function reportDelegatedRunFinish(input: DelegatedRunFinish): Promise<void> {
  await post("finish", input).catch((err: unknown) => {
    log.warn(`finish failed for ${input.sessionId}: ${err instanceof Error ? err.message : String(err)}`);
  });
}
