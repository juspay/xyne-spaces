import { redisService } from "../../../redis.js";
import { createLogger } from "../../../logger.js";
import { errMsg } from "../../../lib/errors.js";
import { REDIS_PREFIX } from "../const.js";

const log = createLogger("channel-threads-state");

const STATE_TTL_S = 6 * 60 * 60;
const MAX_SLOTS = 40;
const MAX_VALUE_CHARS = 400;

export interface ChatState {
  slots: Record<string, string>;
  updatedAt: number;
}

function stateKey(accountId: string, chatId: string): string {
  return `${REDIS_PREFIX}:threads:state:${accountId}:${chatId}`;
}

export async function loadChatState(accountId: string, chatId: string): Promise<ChatState> {
  try {
    const raw = await redisService.getConnection().get(stateKey(accountId, chatId));
    if (!raw) return { slots: {}, updatedAt: 0 };
    const parsed = JSON.parse(raw) as Partial<ChatState>;
    return { slots: parsed.slots ?? {}, updatedAt: parsed.updatedAt ?? 0 };
  } catch (err) {
    log.warn(`[threads-state] load failed account=${accountId} chat=${chatId}: ${errMsg(err)}`);
    return { slots: {}, updatedAt: 0 };
  }
}

/** Merge new slot values over the existing ones; empty strings clear a slot. */
export async function mergeChatState(
  accountId: string,
  chatId: string,
  updates: Record<string, string>,
): Promise<ChatState> {
  const current = await loadChatState(accountId, chatId);
  const slots = { ...current.slots };
  for (const [rawKey, rawValue] of Object.entries(updates ?? {})) {
    const key = rawKey.trim().slice(0, 60);
    if (!key) continue;
    const value = typeof rawValue === "string" ? rawValue.trim().slice(0, MAX_VALUE_CHARS) : "";
    if (!value) delete slots[key];
    else slots[key] = value;
  }
  // Keep the newest slots if the model over-produces, so the store cannot grow without bound.
  const trimmed = Object.fromEntries(Object.entries(slots).slice(-MAX_SLOTS));
  const next: ChatState = { slots: trimmed, updatedAt: Date.now() };
  try {
    await redisService
      .getConnection()
      .set(stateKey(accountId, chatId), JSON.stringify(next), "EX", STATE_TTL_S);
  } catch (err) {
    log.warn(`[threads-state] save failed account=${accountId} chat=${chatId}: ${errMsg(err)}`);
  }
  return next;
}

/** A compact, model-readable block of what this chat has already established,
 *  so a sibling task (hotels) inherits the trip the first task (flights) set. */
export function renderStateBlock(state: ChatState): string {
  const entries = Object.entries(state.slots);
  if (entries.length === 0) return "";
  const lines = entries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
  return `Known so far in this conversation (use it; do not re-ask what is already here):\n${lines}\n\n`;
}
