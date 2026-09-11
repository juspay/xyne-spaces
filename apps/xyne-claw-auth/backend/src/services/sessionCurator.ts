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
import { errMsg } from "../lib/errors.js";
import { createLogger, createTraceId } from "../logger.js";
import type { MemoryProvider, SessionTranscriptForCurator, SubsystemUpdate } from "xyne-claw-shared";

const logger = createLogger("session-curator-client", createTraceId());

const CURATE_TIMEOUT_MS = Number(process.env["MEMORY_CURATOR_TIMEOUT_MS"] ?? 600_000);

export type { SessionTranscriptForCurator, SubsystemUpdate } from "xyne-claw-shared";

export interface ClassifySessionSubsystemArgs {
  sessionId: string;
  agentSlug: string;
  agentName: string;
  task: string;
  transcript: string;
  taxonomy: Array<{ name: string; memoryCount: number }>;
}

/** One cheap claw-side curator call. Any failure returns null (ingest proceeds). */
export async function classifySessionSubsystem(args: ClassifySessionSubsystemArgs): Promise<string | null> {
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/curator/classify-subsystem`;
  if (!CONFIG.xyneClawS2sKey) {
    logger.warn("[curator-client] XYNE_CLAW_S2S_KEY not set — subsystem classification skipped", { sessionId: args.sessionId });
    return null;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify({ ...args, transcript: args.transcript.slice(0, 4_000) }),
      signal: AbortSignal.timeout(Math.min(CURATE_TIMEOUT_MS, 60_000)),
    });
    if (!res.ok) {
      logger.warn("[curator-client] subsystem classification returned non-OK", { sessionId: args.sessionId, status: res.status });
      return null;
    }
    const data = (await res.json()) as { success?: boolean; subsystem?: unknown };
    if (!data.success || typeof data.subsystem !== "string") return null;
    const subsystem = data.subsystem.trim().toLowerCase();
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subsystem) && subsystem.length <= 40 ? subsystem : null;
  } catch (err) {
    logger.warn("[curator-client] subsystem classification failed open", {
      sessionId: args.sessionId,
      err: errMsg(err),
    });
    return null;
  }
}

// Taxonomy scans page the whole bank (up to ~100 list calls on a large one),
// and cron/backfill classify many sessions back-to-back against the same bank.
// A short cache keeps that to one scan per bank per burst; 5 min staleness
// only delays a brand-new subsystem name appearing in the prompt's taxonomy.
const TAXONOMY_CACHE_TTL_MS = 5 * 60_000;
const taxonomyCache = new Map<string, { at: number; taxonomy: Array<{ name: string; memoryCount: number }> }>();

/** Auth-side taxonomy helper, shaped like claw's listSubsystemTaxonomy. */
export async function listBankSubsystems(
  provider: MemoryProvider,
  bankId: string,
): Promise<Array<{ name: string; memoryCount: number }>> {
  const cached = taxonomyCache.get(bankId);
  if (cached && Date.now() - cached.at < TAXONOMY_CACHE_TTL_MS) return cached.taxonomy;
  const counts = new Map<string, number>();
  const pageSize = 200;
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const page = await provider.listMemories(bankId, { limit: pageSize, offset });
    for (const item of page.memories) {
      const tag = (item.tags ?? []).find((candidate) => candidate.startsWith("subsystem:"));
      const name = tag?.slice("subsystem:".length).trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (page.memories.length < pageSize || (typeof page.total === "number" && offset + pageSize >= page.total)) break;
  }
  const taxonomy = Array.from(counts, ([name, memoryCount]) => ({ name, memoryCount }))
    .sort((a, b) => b.memoryCount - a.memoryCount);
  taxonomyCache.set(bankId, { at: Date.now(), taxonomy });
  return taxonomy;
}

/** Fetch taxonomy then classify; absorbs taxonomy and LLM failures alike. */
export async function classifySessionSubsystemForBank(
  provider: MemoryProvider,
  bankId: string,
  args: Omit<ClassifySessionSubsystemArgs, "taxonomy">,
): Promise<string | null> {
  try {
    const taxonomy = await listBankSubsystems(provider, bankId);
    return await classifySessionSubsystem({ ...args, taxonomy });
  } catch (err) {
    logger.warn("[curator-client] subsystem taxonomy/classification failed open", {
      sessionId: args.sessionId,
      bankId,
      err: errMsg(err),
    });
    return null;
  }
}

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
      err: errMsg(err),
    });
    return [];
  }
}

export interface DistillSessionFileArgs {
  sessionId: string;
  agentSlug: string;
  userId: string;
  filename: string;
  source?: "claude" | "opencode" | "codex" | (string & {});
  /** Raw uploaded Claude/OpenCode/Codex export. */
  rawSession: string;
}

/**
 * POST a raw uploaded Claude session to claw's /internal/curator/distill-session.
 * claw parses + normalizes the export and runs the map-reduce distill (chunked
 * so large sessions aren't truncated). Returns SubsystemUpdate candidates, or
 * [] on any failure — the caller simply creates no review rows.
 *
 * Slow by design (N per-chunk LLM calls): uses the same long curator timeout
 * and must be called off the user's request path.
 */
/**
 * Parse-only variant: claw parses + cleans the uploaded Claude export
 * (format detect, turn normalization, harness-scaffolding strip) and returns
 * the cleaned transcript WITHOUT any LLM work. Used by the session-ingest
 * upload path (2026-07-17): the transcript is retained directly and the
 * memory provider's tuned extraction produces the facts. Returns null on any
 * failure — the caller logs and creates nothing.
 */
export async function parseSessionFile(
  args: DistillSessionFileArgs,
): Promise<{ transcript: string; meta: { format?: string; turnCount?: number; conversationCount?: number; toolsUsed?: string[]; task?: string } } | null> {
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/curator/distill-session`;
  if (!CONFIG.xyneClawS2sKey) {
    logger.warn("[curator-client] XYNE_CLAW_S2S_KEY not set — refusing to call claw without auth", { sessionId: args.sessionId });
    return null;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify({ ...args, parseOnly: true }),
      signal: AbortSignal.timeout(CURATE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("[curator-client] claw parse-only returned non-OK", { sessionId: args.sessionId, status: res.status, body: body.slice(0, 300) });
      return null;
    }
    const data = (await res.json()) as { success?: boolean; transcript?: unknown; meta?: Record<string, unknown> };
    if (!data.success || typeof data.transcript !== "string" || !data.transcript.trim()) {
      logger.warn("[curator-client] claw parse-only returned no transcript", { sessionId: args.sessionId });
      return null;
    }
    return { transcript: data.transcript, meta: (data.meta ?? {}) as { format?: string; turnCount?: number; conversationCount?: number; toolsUsed?: string[]; task?: string } };
  } catch (err) {
    logger.error("[curator-client] parse-only call failed", { sessionId: args.sessionId, err: errMsg(err) });
    return null;
  }
}

export async function distillSessionFile(args: DistillSessionFileArgs): Promise<SubsystemUpdate[]> {
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/curator/distill-session`;

  if (!CONFIG.xyneClawS2sKey) {
    logger.warn("[curator-client] XYNE_CLAW_S2S_KEY not set — refusing to call claw without auth", {
      sessionId: args.sessionId,
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
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(CURATE_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("[curator-client] claw distill-session returned non-OK", {
        sessionId: args.sessionId,
        status: res.status,
        body: body.slice(0, 300),
      });
      return [];
    }

    const data = (await res.json()) as { success?: boolean; updates?: unknown; error?: string };
    if (!data.success || !Array.isArray(data.updates)) {
      logger.warn("[curator-client] claw distill-session returned unexpected payload", {
        sessionId: args.sessionId,
        error: data.error,
      });
      return [];
    }

    logger.info("[curator-client] received candidates from claw (session file)", {
      sessionId: args.sessionId,
      agentSlug: args.agentSlug,
      count: data.updates.length,
    });

    return data.updates as SubsystemUpdate[];
  } catch (err) {
    logger.error("[curator-client] distill-session call failed", {
      sessionId: args.sessionId,
      err: errMsg(err),
    });
    return [];
  }
}
