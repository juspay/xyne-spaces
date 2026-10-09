import { redisService } from "../../../redis.js";
import { createLogger } from "../../../logger.js";
import { errMsg } from "../../../lib/errors.js";
import { REDIS_PREFIX } from "../const.js";

const log = createLogger("channel-threads-registry");

const TASK_TTL_S = 6 * 60 * 60;
const MSGMAP_TTL_S = 24 * 60 * 60;
const MAX_OPEN_TASKS = 6;

export interface ChatTask {
  conversationId: string;
  agentSlug: string;
  label: string;
  originMessageId: string;
  createdAt: number;
}

function tasksKey(accountId: string, chatId: string): string {
  return `${REDIS_PREFIX}:threads:tasks:${accountId}:${chatId}`;
}
/** WhatsApp message ids (wamid…) are globally unique, so the sent-message →
 *  conversation map needs no account/chat in its key. */
function msgMapKey(waMessageId: string): string {
  return `${REDIS_PREFIX}:threads:msg:${waMessageId}`;
}

export async function openTasks(accountId: string, chatId: string): Promise<ChatTask[]> {
  try {
    const raw = await redisService.getConnection().hvals(tasksKey(accountId, chatId));
    return raw
      .map((entry) => {
        try {
          return JSON.parse(entry) as ChatTask;
        } catch {
          return null;
        }
      })
      .filter((task): task is ChatTask => task !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch (err) {
    log.warn(`[threads-registry] list failed account=${accountId} chat=${chatId}: ${errMsg(err)}`);
    return [];
  }
}

export async function createTask(accountId: string, chatId: string, task: ChatTask): Promise<void> {
  try {
    const key = tasksKey(accountId, chatId);
    await redisService
      .getConnection()
      .multi()
      .hset(key, task.conversationId, JSON.stringify(task))
      .expire(key, TASK_TTL_S)
      .exec();
  } catch (err) {
    log.warn(`[threads-registry] create failed account=${accountId} chat=${chatId}: ${errMsg(err)}`);
  }
}

export async function closeTask(accountId: string, chatId: string, conversationId: string): Promise<void> {
  try {
    await redisService.getConnection().hdel(tasksKey(accountId, chatId), conversationId);
  } catch (err) {
    log.warn(`[threads-registry] close failed account=${accountId} chat=${chatId}: ${errMsg(err)}`);
  }
}

/** /new: every open task in the chat is from before the fresh start. */
export async function forgetChatTasks(accountId: string, chatId: string): Promise<void> {
  try {
    await redisService.getConnection().del(tasksKey(accountId, chatId));
  } catch (err) {
    log.warn(`[threads-registry] forget failed account=${accountId} chat=${chatId}: ${errMsg(err)}`);
  }
}

export async function atOpenTaskCap(accountId: string, chatId: string): Promise<boolean> {
  const tasks = await openTasks(accountId, chatId);
  return tasks.length >= MAX_OPEN_TASKS;
}

/** Record that an outbound message we sent belongs to a task's conversation,
 *  so a WhatsApp quote-reply to it routes straight back to that task. */
export async function mapSentMessage(waMessageId: string, conversationId: string): Promise<void> {
  if (!waMessageId) return;
  try {
    await redisService.getConnection().set(msgMapKey(waMessageId), conversationId, "EX", MSGMAP_TTL_S);
  } catch (err) {
    log.warn(`[threads-registry] map failed msg=${waMessageId}: ${errMsg(err)}`);
  }
}

/** The task a person's quote-reply continues, by the id of the message they
 *  replied to. null when it is not a reply to a message we tracked. */
export async function taskForReply(
  accountId: string,
  chatId: string,
  waMessageId: string | undefined,
): Promise<ChatTask | null> {
  if (!waMessageId) return null;
  try {
    const conversationId = await redisService.getConnection().get(msgMapKey(waMessageId));
    if (!conversationId) return null;
    const raw = await redisService.getConnection().hget(tasksKey(accountId, chatId), conversationId);
    return raw ? (JSON.parse(raw) as ChatTask) : null;
  } catch (err) {
    log.warn(`[threads-registry] reply lookup failed account=${accountId} chat=${chatId}: ${errMsg(err)}`);
    return null;
  }
}
