import { CONFIG } from "../config.js";
import { isChatConversation } from "../lib/conversation-kind.js";
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

const GREETING_WORDS = new Set([
  "hi", "hii", "hello", "hey", "heyy", "yo", "hola", "namaste", "thanks", "thank", "you",
  "ok", "okay", "sure", "good", "morning", "afternoon", "evening", "there", "test", "ping",
]);

/**
 * Whether the first message alone says enough to name the chat. "hey" or
 * "hello there" do not, and naming them early produces titles like "Greeting"
 * that then block the better, reply-aware title (fillTitleIfEmpty keeps the
 * first one). Those chats are named after the first completed reply instead.
 */
export function isTitleWorthyFirstMessage(message: string): boolean {
  const words = message
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((word) => word.length > 1 || /\p{N}/u.test(word));
  const meaningful = words.filter((word) => !GREETING_WORDS.has(word));
  return meaningful.length >= 3;
}

export async function maybeGenerateConversationTitle(args: {
  conversationId: string;
  agentSlug: string;
  userId: string;
  orgId: string;
  assistantReply?: string;
  generateTitle?: boolean;
}): Promise<void> {
  if (!CONFIG.chatTitleGenerationEnabled) return;
  if (args.generateTitle === false) return;
  if (!isChatConversation(args.conversationId)) return;

  const key = {
    conversationId: args.conversationId,
    userId: args.userId,
    agentSlug: args.agentSlug,
  };
  const existing = await chatConversationMetaRepository.find(key);
  if (existing?.title) return;

  const messages = await chatMessageRepository.findByConversation(args.conversationId);
  const firstUserMessage =
    messages.find((m) => m.role === "user" && m.userId === args.userId)?.content ?? "";
  if (!firstUserMessage.trim()) return;
  // Before any reply exists, only name chats whose opener carries a subject.
  if (!args.assistantReply?.trim() && !isTitleWorthyFirstMessage(firstUserMessage)) return;

  const title = await generateChatTitleViaClaw({
    firstUserMessage,
    ...(args.assistantReply?.trim() ? { assistantReply: args.assistantReply } : {}),
  });
  if (!title) return;

  const named = await chatConversationMetaRepository.fillTitleIfEmpty({
    ...key,
    orgId: args.orgId,
    title,
  });
  if (!named) {
    logger.info("[chat-title-client] title already set, keeping it", {
      conversationId: args.conversationId,
    });
    return;
  }
  logger.info("[chat-title-client] named conversation", {
    conversationId: args.conversationId,
    title,
  });
}
