import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";
import { createLogger, createTraceId } from "../logger.js";
import {
  chatConversationMetaRepository,
  chatMessageRepository,
} from "../repositories/index.js";

const logger = createLogger("chat-title-client", createTraceId());

const CHAT_TITLE_TIMEOUT_MS = Number(process.env["CHAT_TITLE_TIMEOUT_MS"] ?? 45_000);

export const MANUAL_CHAT_TITLE_MAX_CHARS = 100;

export interface ChatTitleRequest {
  firstUserMessage: string;
  assistantReply?: string;
}

export async function generateChatTitleViaClaw(req: ChatTitleRequest): Promise<string | null> {
  if (!CONFIG.xyneClawS2sKey) {
    logger.warn("[chat-title-client] XYNE_CLAW_S2S_KEY not set — refusing call");
    return null;
  }
  const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/chat-title/generate`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": CONFIG.xyneClawS2sKey },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(CHAT_TITLE_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("[chat-title-client] non-OK from claw", {
        status: res.status,
        body: body.slice(0, 200),
      });
      return null;
    }
    const data = (await res.json()) as { success?: boolean; title?: unknown };
    if (!data.success || typeof data.title !== "string" || !data.title.trim()) return null;
    return data.title.trim();
  } catch (err) {
    logger.error("[chat-title-client] call failed", { err: errMsg(err) });
    return null;
  }
}

function isMachineConversation(conversationId: string): boolean {
  return (
    conversationId.startsWith("app_") ||
    conversationId.startsWith("a2a_") ||
    conversationId.startsWith("scheduled_")
  );
}

export async function maybeGenerateConversationTitle(args: {
  conversationId: string;
  agentSlug: string;
  userId: string;
  orgId: string;
  assistantReply?: string;
}): Promise<void> {
  if (!CONFIG.chatTitleGenerationEnabled) return;
  if (isMachineConversation(args.conversationId)) return;

  const existing = await chatConversationMetaRepository.find(args.conversationId);
  if (existing?.title) return;

  const messages = await chatMessageRepository.findByConversation(args.conversationId);
  const firstUserMessage = messages.find((m) => m.role === "user")?.content ?? "";
  if (!firstUserMessage.trim()) return;

  const title = await generateChatTitleViaClaw({
    firstUserMessage,
    ...(args.assistantReply?.trim() ? { assistantReply: args.assistantReply } : {}),
  });
  if (!title) return;

  await chatConversationMetaRepository.upsertTitle({
    conversationId: args.conversationId,
    userId: args.userId,
    agentSlug: args.agentSlug,
    orgId: args.orgId,
    title,
  });
  logger.info("[chat-title-client] named conversation", {
    conversationId: args.conversationId,
    title,
  });
}
