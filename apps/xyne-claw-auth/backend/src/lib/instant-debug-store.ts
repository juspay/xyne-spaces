/**
 * Local + GCS debug-trace storage for the instant flow — claw-auth's own
 * version of claw's session-store.ts pattern (local dir as the fast/primary
 * path, GCS as the durable backing), scoped down to what instant mode
 * actually needs: ONE write per turn, no incremental checkpoints, no TTL
 * sweep (each conversation+agent's debug dir is tiny — a handful of JSON
 * files — so there's nothing here worth the eviction machinery claw's real
 * sessions need).
 *
 * Deliberately NOT the same storage claw uses. Claw and claw-auth are
 * separate pods with no shared filesystem — claw's `sessions-data` volume
 * is `emptyDir` in the live deployment (ephemeral, single-pod, genuinely
 * impossible to share, regardless of PVC access-mode). This is claw-auth's
 * own tree, entirely disjoint from claw's `data/sessions`, so there's no
 * storeKey collision risk with a real agentic session to design around —
 * unlike the discarded claw-side approach, no `__instant` suffix is needed.
 *
 * Local disk here is genuinely just a cache: claw-auth has no PVC either
 * (confirmed against the live deployment — no volumes at all), so every
 * write also goes to GCS, and every read falls back to GCS when the local
 * copy is missing (pod restarted, or served by a different replica than the
 * one that wrote it).
 */

import { mkdir, readdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { gcsService } from "../services/gcsService.js";
import { createLogger } from "../logger.js";

const log = createLogger("instant-debug-store");

const DATA_DIR = process.env["INSTANT_DEBUG_DATA_DIR"] ?? "./data/instant-debug";
const GCS_PREFIX = "instant-debug";

function storeKey(conversationId: string, agentSlug: string): string {
  return `${conversationId}_${agentSlug}`;
}

function debugDirFor(key: string): string {
  return path.join(DATA_DIR, key);
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Same shape as claw's own DebugSessionSnapshot (agent.ts) — kept
 *  structurally compatible so the dashboard debugger renders instant runs
 *  with the same fields it already knows how to read. */
export interface InstantDebugSnapshot {
  schemaVersion: 1;
  conversationId: string;
  sessionId?: string;
  agentSlug: string;
  userId?: string;
  startedAt: string;
  finishedAt: string;
  task: string;
  messages: unknown[];
  toolInvocations: unknown[];
  tokenUsage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  latency: {
    totalMs: number;
    llmDecodeMs: number;
    llmWaitMs: number;
    llmTotalMs: number;
    llmTurns: number;
    llmRetries: number;
  };
  lastAssistantText: string;
  events: unknown[];
}

/**
 * Write an instant run's debug trace — local dir + GCS, both best-effort.
 * Never throws: a failed write here must not fail the user-facing turn,
 * which has already completed and been returned to the browser by the time
 * this runs.
 */
export async function persistInstantDebugTrace(opts: {
  conversationId: string;
  agentSlug: string;
  userId: string;
  sessionId: string;
  task: string;
  startedAt: string;
  finishedAt: string;
  lastAssistantText: string;
  toolInvocations: unknown[];
  events: unknown[];
  totalMs: number;
}): Promise<boolean> {
  try {
    const key = storeKey(opts.conversationId, opts.agentSlug);
    const dir = debugDirFor(key);
    await mkdir(dir, { recursive: true });

    const snapshot: InstantDebugSnapshot = {
      schemaVersion: 1,
      conversationId: opts.conversationId,
      sessionId: opts.sessionId,
      agentSlug: opts.agentSlug,
      userId: opts.userId,
      startedAt: opts.startedAt,
      finishedAt: opts.finishedAt,
      task: opts.task,
      messages: [],
      toolInvocations: opts.toolInvocations,
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      latency: { totalMs: opts.totalMs, llmDecodeMs: 0, llmWaitMs: 0, llmTotalMs: 0, llmTurns: 0, llmRetries: 0 },
      lastAssistantText: opts.lastAssistantText,
      events: opts.events,
    };

    const safeSessionId = opts.sessionId.replace(/[^a-zA-Z0-9_-]/g, "-");
    const runFile = `debug-run-${Date.parse(opts.startedAt) || Date.now()}-${safeSessionId}.json`;
    const sessionJson = JSON.stringify(snapshot, null, 2);
    const eventsJson = JSON.stringify(opts.events, null, 2);
    const runJson = JSON.stringify(snapshot);

    // Local write first — cheap, and gives the SAME-pod fast path something
    // to read immediately without a GCS round trip.
    await Promise.all([
      writeFile(path.join(dir, "debug-session.json"), sessionJson, "utf8"),
      writeFile(path.join(dir, "debug-events.json"), eventsJson, "utf8"),
      writeFile(path.join(dir, runFile), runJson, "utf8"),
    ]).catch((err: unknown) => {
      log.warn(`[instant-debug-store] local write failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // GCS — the actual durable copy. All three uploaded (unlike claw, which
    // only sends debug-run-*.json to GCS) because claw-auth has no PVC at
    // all backing the local copy above — without this, a pod restart loses
    // debugSession/debugEvents outright, not just the "hot cache" claw has.
    const uploads = await Promise.allSettled([
      gcsService.uploadFile(Buffer.from(sessionJson, "utf8"), `${GCS_PREFIX}/${key}/debug-session.json`, "application/json"),
      gcsService.uploadFile(Buffer.from(eventsJson, "utf8"), `${GCS_PREFIX}/${key}/debug-events.json`, "application/json"),
      gcsService.uploadFile(Buffer.from(runJson, "utf8"), `${GCS_PREFIX}/${key}/${runFile}`, "application/json"),
    ]);
    const failed = uploads.filter((u) => u.status === "rejected").length;
    if (failed > 0) {
      log.warn(`[instant-debug-store] ${failed}/3 GCS uploads failed for ${key} — local copy still present on this pod`);
    } else {
      log.info(`[instant-debug-store] wrote debug trace for ${key} (local + GCS)`);
    }

    return true;
  } catch (err) {
    log.warn(`[instant-debug-store] persist failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export interface InstantDebugBundle {
  debugSession: InstantDebugSnapshot;
  debugEvents: unknown[];
  runs: Array<{ fileName: string; data: Record<string, unknown> }>;
}

/**
 * Read a run's debug bundle for the /debug route — local dir first (same
 * pod that just wrote it, the common case), GCS restore when missing (a
 * different replica, or this pod restarted since the write). Returns null
 * when nothing exists in either place.
 */
export async function readInstantDebugTrace(conversationId: string, agentSlug: string): Promise<InstantDebugBundle | null> {
  const key = storeKey(conversationId, agentSlug);
  const dir = debugDirFor(key);

  let debugSession = await readJsonIfExists<InstantDebugSnapshot>(path.join(dir, "debug-session.json"));
  let debugEvents = await readJsonIfExists<unknown[]>(path.join(dir, "debug-events.json"));

  if (!debugSession) {
    try {
      const buf = await gcsService.getFileBuffer(`${GCS_PREFIX}/${key}/debug-session.json`);
      debugSession = JSON.parse(buf.toString("utf8")) as InstantDebugSnapshot;
    } catch {
      // Genuinely nothing for this conversation+agent — fall through to null below.
    }
    if (!debugEvents) {
      try {
        const buf = await gcsService.getFileBuffer(`${GCS_PREFIX}/${key}/debug-events.json`);
        debugEvents = JSON.parse(buf.toString("utf8")) as unknown[];
      } catch {
        // Same as above.
      }
    }
  }

  if (!debugSession) return null;

  const runsByName = new Map<string, { fileName: string; data: Record<string, unknown> }>();
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      if (!name.startsWith("debug-run-") || !name.endsWith(".json")) continue;
      const data = await readJsonIfExists<Record<string, unknown>>(path.join(dir, name));
      if (data) runsByName.set(name, { fileName: name, data });
    }
  } catch {
    // Local dir may not exist (restored-from-GCS case above) — GCS listing below still runs.
  }

  try {
    const gcsPaths = await gcsService.listFiles(`${GCS_PREFIX}/${key}/`);
    for (const fullPath of gcsPaths) {
      const name = fullPath.split("/").pop() ?? "";
      if (!name.startsWith("debug-run-") || !name.endsWith(".json") || runsByName.has(name)) continue;
      try {
        const buf = await gcsService.getFileBuffer(fullPath);
        runsByName.set(name, { fileName: name, data: JSON.parse(buf.toString("utf8")) as Record<string, unknown> });
      } catch {
        // Skip an unreadable/partial object rather than failing the whole bundle.
      }
    }
  } catch (err) {
    log.warn(`[instant-debug-store] GCS listing failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { debugSession, debugEvents: debugEvents ?? [], runs: [...runsByName.values()] };
}
