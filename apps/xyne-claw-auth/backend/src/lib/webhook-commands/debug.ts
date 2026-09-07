import { agentRunRepository } from "../../repositories/agentRunRepository.js";
import { gcsService } from "../../services/storageService.js";
import { CONFIG } from "../../config.js";
import { getSlotOwner } from "../message-queue.js";
import { postGeneratedMarkdownFile } from "../spaces-generated-file.js";
import { renderDebugTraceHtml, type DebugTraceRun } from "../debug-trace-html.js";
import type { WebhookCommandCtx } from "./context.js";

const REPLY_LABEL = "Failed to post /debug reply";
const DEBUG_RUN_PREFIX = "claw-debug-runs";
/** Discovery markers, written at run START: `_index/<convId>/<runId>~<storeKey>.json`. */
const DEBUG_INDEX_PREFIX = `${DEBUG_RUN_PREFIX}/_index`;
/** A conversation with many runs still only needs the newest handful. */
const MAX_INDEX_DOWNLOADS = 5;
/** Claw inlines each run's transcript; we render exactly one, newest-first. */
const CLAW_RUN_LIMIT = 10;
const NO_TRACE =
  "🧵 **Debug** — no execution trace has been checkpointed for this run yet — try again in a minute or after it finishes.";

interface ResolvedRun {
  sessionId: string;
  status: string;
  agentSlug: string;
  conversationId: string;
  userId?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function resolveRun(ctx: WebhookCommandCtx): Promise<ResolvedRun | null> {
  const conversationId = ctx.payload.conversationId;
  if (!conversationId) return null;
  let sessionId: string | undefined;
  try {
    const owner = await getSlotOwner(conversationId, ctx.agent.slug);
    sessionId = owner?.sessionId;
  } catch {
    sessionId = undefined;
  }
  const row =
    (sessionId ? await agentRunRepository.findBySessionId(sessionId) : null) ??
    (await agentRunRepository.findLatestByConversation(conversationId, ctx.agent.slug));
  if (!row) return null;
  return {
    sessionId: row.sessionId,
    status: row.status,
    agentSlug: row.agentSlug ?? ctx.agent.slug,
    conversationId,
    // The userId hint lets claw (and the archive restore behind it) reach the
    // key shapes that fold a user id in — agent-chat's `<userId>_<conv>_<slug>`
    // and the Digital-Twin `<conv>-<userId>_<slug>`.
    ...(row.userId ? { userId: row.userId } : {}),
  };
}

function epochOf(name: string): number {
  const match = /^debug-run-(\d+)-/.exec(name);
  return match ? Number(match[1]) : 0;
}

function safeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

interface PickedRun {
  name: string;
  snapshot: DebugTraceRun;
  matchedSession: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pick the snapshot for THIS session, falling back to the thread's newest.
 *
 * A run's own `sessionId` is authoritative; the file name only carries a
 * sanitized token of it, so it is the second-best match.
 */
function pickSnapshot(
  candidates: Array<{ name: string; snapshot: DebugTraceRun }>,
  sessionId: string,
): PickedRun | null {
  if (candidates.length === 0) return null;
  const byEpoch = (a: { name: string }, b: { name: string }): number =>
    epochOf(b.name) - epochOf(a.name) || b.name.localeCompare(a.name);
  const sorted = [...candidates].sort(byEpoch);
  const token = safeToken(sessionId);
  const exact = sorted.find((c) => c.snapshot.sessionId === sessionId);
  const byName = exact ?? sorted.find((c) => c.name.includes(token));
  if (byName) return { ...byName, matchedSession: true };
  const newest = sorted[0];
  return newest ? { ...newest, matchedSession: false } : null;
}

/**
 * Ask xyne-claw for the conversation's debug bundle.
 *
 * Preferred over reading GCS here: claw resolves runs from the run index (and
 * its own PVC), so branch keys, Digital-Twin per-user keys and userId-prefixed
 * agent-chat keys all resolve without this command re-guessing the shape — the
 * guess is exactly what used to make `/debug` say "no trace" for those threads.
 */
async function fetchFromClaw(ctx: WebhookCommandCtx, run: ResolvedRun): Promise<PickedRun | null> {
  const url =
    `${CONFIG.xyneClawUrl.replace(/\/+$/, "")}/internal/sessions/${encodeURIComponent(run.conversationId)}/debug` +
    `?agentSlug=${encodeURIComponent(run.agentSlug)}&limit=${CLAW_RUN_LIMIT}` +
    `${run.userId ? `&userId=${encodeURIComponent(run.userId)}` : ""}`;
  const res = await fetch(url, {
    headers: { ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}) },
    signal: AbortSignal.timeout(Number(process.env["DEBUG_PROXY_TIMEOUT_MS"] ?? 30_000)),
  });
  if (!res.ok) {
    if (res.status !== 404) {
      ctx.log.warn("/debug claw lookup failed", { status: res.status, conversationId: run.conversationId });
    }
    return null;
  }
  const body = (await res.json()) as { data?: { runs?: unknown } };
  const rows = Array.isArray(body?.data?.runs) ? body.data.runs : [];
  const candidates = rows.flatMap((row) => {
    if (!isRecord(row) || typeof row["fileName"] !== "string" || !isRecord(row["data"])) return [];
    return [{ name: row["fileName"], snapshot: row["data"] as DebugTraceRun }];
  });
  return pickSnapshot(candidates, run.sessionId);
}

interface IndexEntry {
  runId: string;
  storeKey: string;
  startedAtMs: number;
}

/** `_index/<convId>/<runId>~<storeKey>.json` — `~` can appear in neither half. */
function parseIndexMarker(objectName: string): IndexEntry | null {
  const leaf = objectName.slice(objectName.lastIndexOf("/") + 1);
  if (!leaf.endsWith(".json")) return null;
  const body = leaf.slice(0, -".json".length);
  const sep = body.indexOf("~");
  if (sep <= 0) return null;
  const runId = body.slice(0, sep);
  const storeKey = body.slice(sep + 1);
  if (!runId || !storeKey) return null;
  const dash = runId.indexOf("-");
  const startedAtMs = dash > 0 ? Number(runId.slice(0, dash)) : Number.NaN;
  return { runId, storeKey, startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : 0 };
}

async function downloadSnapshot(storeKey: string, name: string): Promise<DebugTraceRun | null> {
  const buffer = await gcsService.getFileBuffer(`${DEBUG_RUN_PREFIX}/${storeKey}/${name}`);
  const parsed: unknown = JSON.parse(buffer.toString("utf8"));
  return isRecord(parsed) ? (parsed as DebugTraceRun) : null;
}

/**
 * Index-driven discovery, for when claw is unreachable.
 *
 * The marker NAME carries the storeKey the run was actually written under, so
 * this stays a lookup rather than a fourth guess at the key shape.
 */
async function fetchFromIndex(ctx: WebhookCommandCtx, run: ResolvedRun): Promise<PickedRun | null> {
  const prefix = `${DEBUG_INDEX_PREFIX}/${run.conversationId}/`;
  const entries = (await gcsService.listFiles(prefix))
    .map(parseIndexMarker)
    .filter((e): e is IndexEntry => e !== null)
    .sort((a, b) => b.startedAtMs - a.startedAtMs || (a.runId < b.runId ? 1 : -1));
  if (entries.length === 0) return null;

  const token = `-${safeToken(run.sessionId)}`;
  const mine = entries.filter((e) => e.runId.endsWith(token));
  // This session's runs first; otherwise the newest few, so one missing object
  // (a marker whose snapshot upload lost the race) doesn't end the search.
  const ordered = [...mine, ...entries.filter((e) => !mine.includes(e))].slice(0, MAX_INDEX_DOWNLOADS);
  for (const entry of ordered) {
    const name = `debug-run-${entry.runId}.json`;
    try {
      const snapshot = await downloadSnapshot(entry.storeKey, name);
      if (snapshot) return { name, snapshot, matchedSession: entry.runId.endsWith(token) };
    } catch (err) {
      ctx.log.warn("/debug indexed snapshot download failed", {
        error: errMsg(err),
        storeKey: entry.storeKey,
        runId: entry.runId,
      });
    }
  }
  return null;
}

/**
 * Pre-index runs only. They predate the discovery markers, so the shared-thread
 * storeKey is the sole way to reach them — and the only shape they ever used.
 */
async function fetchLegacyStoreKey(ctx: WebhookCommandCtx, run: ResolvedRun): Promise<PickedRun | null> {
  const storeKey = `${run.conversationId}_${run.agentSlug}`;
  const prefix = `${DEBUG_RUN_PREFIX}/${storeKey}/`;
  const names = (await gcsService.listFiles(prefix))
    .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p))
    .filter((n) => n.startsWith("debug-run-") && n.endsWith(".json"))
    .sort((a, b) => epochOf(b) - epochOf(a) || b.localeCompare(a));
  const token = safeToken(run.sessionId);
  const name = names.find((n) => n.includes(token)) ?? names[0];
  if (!name) return null;
  try {
    const snapshot = await downloadSnapshot(storeKey, name);
    return snapshot ? { name, snapshot, matchedSession: name.includes(token) } : null;
  } catch (err) {
    ctx.log.warn("/debug legacy snapshot download failed", { error: errMsg(err), storeKey, name });
    return null;
  }
}

export async function handleDebug(ctx: WebhookCommandCtx): Promise<void> {
  let run: ResolvedRun | null = null;
  try {
    run = await resolveRun(ctx);
  } catch (err) {
    ctx.log.warn("/debug run lookup failed", { error: errMsg(err) });
  }
  if (!run) {
    await ctx.reply(NO_TRACE, REPLY_LABEL);
    return;
  }

  const resolved = run;
  let picked: PickedRun | null = null;
  for (const lookup of [fetchFromClaw, fetchFromIndex, fetchLegacyStoreKey]) {
    try {
      picked = await lookup(ctx, resolved);
    } catch (err) {
      ctx.log.warn("/debug snapshot lookup failed", { error: errMsg(err), via: lookup.name });
      picked = null;
    }
    if (picked) break;
  }
  if (!picked) {
    await ctx.reply(NO_TRACE, REPLY_LABEL);
    return;
  }

  const snapshot = picked.snapshot;
  const html = renderDebugTraceHtml(snapshot);
  const shortId = safeToken(run.sessionId).slice(0, 8);
  const filename = `debug-${run.agentSlug}-${shortId}.html`;

  const eventList = Array.isArray(snapshot.events) ? (snapshot.events as Array<Record<string, unknown>>) : [];
  const toolCalls = eventList.filter((e) => e?.["kind"] === "tool_execution_start").length;
  const llmTurns = eventList.filter((e) => e?.["kind"] === "assistant_turn_end").length;
  const compactions = eventList.filter((e) => e?.["kind"] === "compaction_start").length;
  const checkpointMs = epochOf(picked.name);
  const checkpointAt = checkpointMs > 0 ? new Date(checkpointMs).toISOString() : null;

  const notes = [
    run.status === "running" && checkpointAt ? `trace as of ${checkpointAt} — run still in progress` : "",
    picked.matchedSession ? "" : "no checkpoint matched this session — showing the newest trace for this thread",
  ].filter(Boolean);

  const summary =
    `🧵 **Debug trace** — ${ctx.agent.slug} · session \`${shortId}\` · ${run.status}\n` +
    `${toolCalls} tool calls · ${llmTurns} LLM turns · ${compactions} compactions` +
    (notes.length > 0 ? ` — ${notes.join(" · ")}` : "");

  try {
    await postGeneratedMarkdownFile({
      channelId: ctx.payload.channelId,
      conversationId: ctx.payload.conversationId,
      userId: ctx.agent.spacesAppUserId,
      appToken: ctx.agent.appToken,
      filename,
      markdown: html,
      mimeType: "text/html",
      summary,
    });
  } catch (err) {
    ctx.log.warn("/debug trace upload failed", { error: errMsg(err) });
    await ctx.reply(`${summary}\n\n⚠️ _Couldn't attach ${filename} (upload failed)._`, REPLY_LABEL);
  }
}
