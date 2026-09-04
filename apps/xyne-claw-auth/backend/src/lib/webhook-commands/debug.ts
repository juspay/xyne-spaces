import { agentRunRepository } from "../../repositories/agentRunRepository.js";
import { gcsService } from "../../services/storageService.js";
import { getSlotOwner } from "../message-queue.js";
import { postGeneratedMarkdownFile } from "../spaces-generated-file.js";
import { renderDebugTraceHtml, type DebugTraceRun } from "../debug-trace-html.js";
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

async function pickNewestSnapshot(storeKey: string, sessionId: string): Promise<PickedFile | null> {
  const prefix = `${DEBUG_RUN_PREFIX}/${storeKey}/`;
  const paths = await gcsService.listFiles(prefix);
  const names = paths
    .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p))
    .filter((n) => n.startsWith("debug-run-") && n.endsWith(".json"));
  if (names.length === 0) return null;
  const byEpoch = (a: string, b: string): number => epochOf(b) - epochOf(a) || b.localeCompare(a);
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const matching = names.filter((n) => n.includes(safeSessionId)).sort(byEpoch);
  if (matching[0]) return { name: matching[0], matchedSession: true };
  const newest = [...names].sort(byEpoch)[0];
  return newest ? { name: newest, matchedSession: false } : null;
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

  const storeKey = `${run.conversationId}_${run.agentSlug}`;
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
