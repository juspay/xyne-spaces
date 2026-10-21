import { buildSandboxStoreKey } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { errMsg } from "./errors.js";
import { cloneBranchSession } from "../routes/lib/branching.js";

export const FORK_SUMMARY_MAX_CHARS = 20_000;

export type ForkTarget = { conversationId: string } | { channelId: string };

export interface ForkRequest {
  target: ForkTarget;
  summary: string;
}

export interface ForkSource {
  conversationId: string;
  channelId?: string;
  agentSlug: string;
  userId: string;
}

export interface ForkDeps {
  post: (body: Record<string, unknown>) => Promise<{ conversationId?: string }>;
  clone?: typeof cloneBranchSession;
}

export type ForkResult =
  | { ok: true; message: string; conversationId: string; link: string | null; memoryCopied: boolean }
  | { ok: false; error: string };

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function parseForkRequest(params: Record<string, unknown>): { ok: true; value: ForkRequest } | { ok: false; error: string } {
  const conversationId = str(params["conversationId"]);
  const channelId = str(params["channelId"]);
  const summary = str(params["summary"]);
  if (!!conversationId === !!channelId) {
    return { ok: false, error: "provide exactly one target: conversationId for an existing thread or channelId for a new thread" };
  }
  if (!summary) return { ok: false, error: "summary is required" };
  if (summary.length > FORK_SUMMARY_MAX_CHARS) return { ok: false, error: `summary must be at most ${FORK_SUMMARY_MAX_CHARS} characters` };
  return { ok: true, value: { target: conversationId ? { conversationId } : { channelId }, summary } };
}

export function spacesThreadLink(channelId: string | undefined, conversationId: string | undefined): string | null {
  const base = CONFIG.spacesAppUrl?.replace(/\/+$/, "");
  if (!base || !channelId || !conversationId) return null;
  return `${base}/chat/dir/${encodeURIComponent(channelId)}/${encodeURIComponent(conversationId)}`;
}

export function forkMessage(summary: string, sourceLink: string | null): string {
  const source = sourceLink ? `[an earlier thread](${sourceLink})` : "an earlier thread";
  return `**Forked from ${source}.** I carried my context over from that conversation. Here is what I know:\n\n${summary}`;
}

export async function applyConversationFork(
  params: Record<string, unknown>,
  source: ForkSource,
  deps: ForkDeps,
): Promise<ForkResult> {
  const parsed = parseForkRequest(params);
  if (!parsed.ok) return parsed;
  const { target, summary } = parsed.value;
  if ("conversationId" in target && target.conversationId === source.conversationId) {
    return { ok: false, error: "the target is this same thread; pick another thread or a channel" };
  }

  const sourceLink = spacesThreadLink(source.channelId, source.conversationId);
  let posted: { conversationId?: string };
  try {
    posted = await deps.post({ ...target, markdownText: forkMessage(summary, sourceLink) });
  } catch (err) {
    return { ok: false, error: `could not post in the target: ${errMsg(err)}` };
  }
  const targetConversationId = "conversationId" in target ? target.conversationId : str(posted.conversationId);
  if (!targetConversationId) return { ok: false, error: "the target did not return a conversation id" };

  const sourceKey = buildSandboxStoreKey(source.userId, source.conversationId, source.agentSlug);
  const targetKey = buildSandboxStoreKey(source.userId, targetConversationId, source.agentSlug);
  let memory: "copied" | "kept" | "failed" = "failed";
  if (sourceKey && targetKey) {
    const clone: { success: boolean; targetExisted?: boolean } = await (deps.clone ?? cloneBranchSession)({
      sourceConversationId: sourceKey,
      targetConversationId: targetKey,
      branchMode: "full",
    }).catch((err: unknown) => ({ success: false, error: errMsg(err) }));
    if (clone.success) memory = clone.targetExisted ? "kept" : "copied";
  }

  const link = "channelId" in target ? spacesThreadLink(target.channelId, targetConversationId) : null;
  const where = link ? `[the new thread](${link})` : "the target thread";
  const detail = {
    copied: "and copied my memory of this thread",
    kept: "I already had a conversation there, so I kept that memory and the summary adds this thread's context",
    failed: "My memory of this thread was not copied, so the new thread starts from the summary",
  }[memory];
  const message = memory === "copied"
    ? `Forked to ${where}: posted the handoff summary ${detail}.`
    : `Forked to ${where}: posted the handoff summary. ${detail}.`;
  return { ok: true, message, conversationId: targetConversationId, link, memoryCopied: memory === "copied" };
}
