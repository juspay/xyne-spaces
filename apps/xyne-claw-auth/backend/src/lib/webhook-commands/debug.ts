import { agentRunRepository } from "../../repositories/agentRunRepository.js";
import { gcsService } from "../../services/storageService.js";
import { getSlotOwner } from "../message-queue.js";
import { postGeneratedMarkdownFile } from "../spaces-generated-file.js";
import {
  renderDebugTraceHtml,
  renderDebugTraceBundleHtml,
  type DebugTraceBundleEntry,
  type DebugTraceRun,
} from "../debug-trace-html.js";
import type { WebhookCommandCtx } from "./context.js";

const REPLY_LABEL = "Failed to post /debug reply";
const DEBUG_RUN_PREFIX = "claw-debug-runs";
const NO_TRACE =
  "🧵 **Debug** — no execution trace has been checkpointed for this run yet — try again in a minute or after it finishes.";

interface ResolvedRun {
  sessionId: string;
  status: string;
  agentSlug: string;
  conversationId: string;
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
  };
}

function epochOf(name: string): number {
  const match = /^debug-run-(\d+)-/.exec(name);
  return match ? Number(match[1]) : 0;
}

interface PickedFile {
  name: string;
  matchedSession: boolean;
}

/** Newest checkpoint per session, newest session first. */
interface SessionSnapshot {
  name: string;
  sessionId: string;
  checkpointMs: number;
}

// How many sessions `/debug all` renders. Each is a full trace; the renderer
// also enforces a page-size cap, so this is the cheap upstream bound (fewer
// GCS downloads), not the safety one.
const MAX_BUNDLE_SESSIONS = 10;

function snapshotNames(paths: string[], prefix: string): string[] {
  return paths
    .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p))
    .filter((n) => n.startsWith("debug-run-") && n.endsWith(".json"));
}

/**
 * Group every checkpoint in the thread's store by session, keeping only the
 * newest checkpoint of each (a long run is checkpointed repeatedly under the
 * same session id). Filenames are `debug-run-<epochMs>-<sessionId>.json`.
 */
function listSessions(names: string[]): SessionSnapshot[] {
  const newestBySession = new Map<string, SessionSnapshot>();
  for (const name of names) {
    const match = /^debug-run-(\d+)-(.+)\.json$/.exec(name);
    if (!match?.[1] || !match[2]) continue;
    const snap: SessionSnapshot = {
      name,
      sessionId: match[2],
      checkpointMs: Number(match[1]),
    };
    const seen = newestBySession.get(snap.sessionId);
    if (!seen || snap.checkpointMs > seen.checkpointMs) {
      newestBySession.set(snap.sessionId, snap);
    }
  }
  return [...newestBySession.values()].sort((a, b) => b.checkpointMs - a.checkpointMs);
}

async function pickNewestSnapshot(storeKey: string, sessionId: string): Promise<PickedFile | null> {
  const prefix = `${DEBUG_RUN_PREFIX}/${storeKey}/`;
  const paths = await gcsService.listFiles(prefix);
  const names = snapshotNames(paths, prefix);
  if (names.length === 0) return null;
  const byEpoch = (a: string, b: string): number => epochOf(b) - epochOf(a) || b.localeCompare(a);
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const matching = names.filter((n) => n.includes(safeSessionId)).sort(byEpoch);
  if (matching[0]) return { name: matching[0], matchedSession: true };
  const newest = [...names].sort(byEpoch)[0];
  return newest ? { name: newest, matchedSession: false } : null;
}

export async function handleDebug(
  ctx: WebhookCommandCtx,
  scope: "latest" | "all" = "latest",
): Promise<void> {
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

  const storeKey = `${run.conversationId}_${run.agentSlug}`;
  if (scope === "all") {
    await postSessionBundle(ctx, run, storeKey);
    return;
  }
  let picked: PickedFile | null = null;
  try {
    picked = await pickNewestSnapshot(storeKey, run.sessionId);
  } catch (err) {
    ctx.log.warn("/debug snapshot listing failed", { error: errMsg(err), storeKey });
  }
  if (!picked) {
    await ctx.reply(NO_TRACE, REPLY_LABEL);
    return;
  }

  let snapshot: DebugTraceRun;
  try {
    const buffer = await gcsService.getFileBuffer(`${DEBUG_RUN_PREFIX}/${storeKey}/${picked.name}`);
    snapshot = JSON.parse(buffer.toString("utf8")) as DebugTraceRun;
  } catch (err) {
    ctx.log.warn("/debug snapshot download failed", { error: errMsg(err), file: picked.name });
    await ctx.reply(NO_TRACE, REPLY_LABEL);
    return;
  }

  const html = renderDebugTraceHtml(snapshot);
  const shortId = run.sessionId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 8);
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
    (notes.length > 0 ? ` — ${notes.join(" · ")}` : "") +
    `\n_Earlier sessions in this thread: \`/debug all\`._`;

  await attach(ctx, filename, html, summary);
}

async function attach(ctx: WebhookCommandCtx, filename: string, html: string, summary: string): Promise<void> {
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

/**
 * `/debug all` — every checkpointed session for this thread+agent in one page,
 * newest first, each expandable. The snapshots already exist in the store (the
 * single-run path just discards all but one), so this is a wider read, not new
 * bookkeeping.
 */
async function postSessionBundle(ctx: WebhookCommandCtx, run: ResolvedRun, storeKey: string): Promise<void> {
  const prefix = `${DEBUG_RUN_PREFIX}/${storeKey}/`;
  let sessions: SessionSnapshot[] = [];
  try {
    sessions = listSessions(snapshotNames(await gcsService.listFiles(prefix), prefix));
  } catch (err) {
    ctx.log.warn("/debug all snapshot listing failed", { error: errMsg(err), storeKey });
  }
  if (sessions.length === 0) {
    await ctx.reply(NO_TRACE, REPLY_LABEL);
    return;
  }

  const total = sessions.length;
  const wanted = sessions.slice(0, MAX_BUNDLE_SESSIONS);

  const entries: DebugTraceBundleEntry[] = [];
  for (const session of wanted) {
    try {
      const buffer = await gcsService.getFileBuffer(`${prefix}${session.name}`);
      // Status is best-effort per session: the snapshot records the trace, the
      // AgentRun row records how the run ended.
      const status = await agentRunRepository
        .findBySessionId(session.sessionId)
        .then((row) => row?.status)
        .catch(() => undefined);
      entries.push({
        run: JSON.parse(buffer.toString("utf8")) as DebugTraceRun,
        sessionId: session.sessionId,
        status,
        checkpointMs: session.checkpointMs,
      });
    } catch (err) {
      // One unreadable snapshot must not sink the whole bundle.
      ctx.log.warn("/debug all snapshot download failed", { error: errMsg(err), file: session.name });
    }
  }
  if (entries.length === 0) {
    await ctx.reply(NO_TRACE, REPLY_LABEL);
    return;
  }

  const omitted = total - entries.length;
  const summary =
    `🧵 **Debug traces** — ${ctx.agent.slug} · ${entries.length} session${entries.length === 1 ? "" : "s"}, newest first\n` +
    `Open the file and click a session to expand its timeline.` +
    (omitted > 0 ? ` _(${omitted} older session${omitted === 1 ? "" : "s"} not included.)_` : "");

  await attach(ctx, `debug-${run.agentSlug}-sessions.html`, renderDebugTraceBundleHtml(entries), summary);
}
