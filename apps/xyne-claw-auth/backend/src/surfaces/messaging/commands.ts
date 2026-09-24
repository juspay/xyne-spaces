/**
 * Control commands: the things a person needs to say ABOUT a conversation
 * rather than to the agent.
 *
 * Kept apart from agent routing because they behave differently at every
 * stage — they never start a run, and the two that change something do so
 * through the platform's own endpoints rather than any state of ours.
 */
import { CONFIG } from "../../config.js";
import { errMsg } from "../../lib/errors.js";
import { createLogger } from "../../logger.js";
import { redisService } from "../../redis.js";
import { ACTIVE_RUN_TTL_S, REDIS_PREFIX } from "./const.js";
import { enqueueOutbound, typingCancelled } from "./delivery.js";
import { channelConversationId } from "./ids.js";
import type { ChannelAccount } from "./plugin.js";

const log = createLogger("channel-commands");

export type ControlCommand = "new" | "stop" | "status";

const COMMANDS: ReadonlyArray<readonly [RegExp, ControlCommand]> = [
  // `/clear` is what the same command is called in Spaces; accept it here so
  // one person does not have to remember two names for one thing.
  [/^[@/](new|reset|clear)\s*$/i, "new"],
  [/^[@/](stop|cancel|abort)\s*$/i, "stop"],
  [/^[@/]status\s*$/i, "status"],
];

export function parseControlCommand(text: string): ControlCommand | null {
  const trimmed = text.trim();
  for (const [pattern, command] of COMMANDS) {
    if (pattern.test(trimmed)) return command;
  }
  return null;
}

// ── the run currently working in a chat ──

interface ActiveRun {
  sessionId: string;
  agentSlug: string;
  startedAt: number;
}

function runKey(accountId: string, chatId: string): string {
  return `${REDIS_PREFIX}:run:${accountId}:${chatId}`;
}

/** Remember what is running here, so /stop and /status have something to act
 *  on from any pod. Best-effort: losing it costs the two commands, nothing
 *  else. */
export async function rememberActiveRun(accountId: string, chatId: string, run: ActiveRun): Promise<void> {
  try {
    await redisService.getConnection().set(runKey(accountId, chatId), JSON.stringify(run), "EX", ACTIVE_RUN_TTL_S);
  } catch (err) {
    log.warn(`[commands] could not record the active run account=${accountId}: ${errMsg(err)}`);
  }
}

export async function activeRun(accountId: string, chatId: string): Promise<ActiveRun | null> {
  try {
    const raw = await redisService.getConnection().get(runKey(accountId, chatId));
    return raw ? (JSON.parse(raw) as ActiveRun) : null;
  } catch {
    return null;
  }
}

export async function forgetActiveRun(accountId: string, chatId: string): Promise<void> {
  await redisService
    .getConnection()
    .del(runKey(accountId, chatId))
    .catch(() => undefined);
}

// ── the two that change something ──

/** Forget this conversation's transcript. The platform's own endpoint, the
 *  same one `/clear` uses in Spaces, so a thread cleared here is cleared
 *  everywhere it is keyed the same. */
export async function clearConversation(input: {
  userId: string;
  conversationId: string;
  agentSlug: string;
}): Promise<boolean> {
  try {
    const response = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/clear-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(input),
    });
    return response.ok;
  } catch (err) {
    log.warn(`[commands] clear-session failed for ${input.conversationId}: ${errMsg(err)}`);
    return false;
  }
}

export async function cancelRun(sessionId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(sessionId)}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
      },
    );
    return response.ok;
  } catch (err) {
    log.warn(`[commands] cancel failed for ${sessionId}: ${errMsg(err)}`);
    return false;
  }
}

/** "3 minutes", "40 seconds" — for /status, where a timestamp reads worse. */
export function describeElapsed(sinceMs: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - sinceMs) / 1000));
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * /new, /stop, /status. Each answers in one line: the person typed a command
 * because something is wrong or slow, and a paragraph is not what they want.
 */
export async function handleControlCommand(input: {
  command: ControlCommand;
  account: ChannelAccount;
  chatId: string;
  userId: string;
  agentSlug: string | null;
  reply: (text: string) => Promise<void>;
}): Promise<void> {
  const { command, account, chatId, userId, agentSlug, reply } = input;
  const running = await activeRun(account.id, chatId);

  if (command === "status") {
    await reply(
      running
        ? `Working on it — /${running.agentSlug} has been running for ${describeElapsed(running.startedAt)}. Send /stop to give up on it.`
        : "Nothing running. Send me something and I'll get to work.",
    );
    return;
  }

  if (command === "stop") {
    if (!running) {
      await reply("Nothing to stop.");
      return;
    }
    const stopped = await cancelRun(running.sessionId);
    await forgetActiveRun(account.id, chatId);
    // Whatever the outcome, the indicator has to go: leaving a number typing
    // after someone asked it to stop is the worst of both answers.
    // /stop means stop: forget the count rather than waiting for other runs.
    await typingCancelled(account.id, chatId);
    await enqueueOutbound(account.id, { kind: "typing", chatId, on: false });
    await reply(stopped ? "Stopped." : "Asked it to stop, but it may already have finished.");
    return;
  }

  if (!agentSlug) {
    await reply("This number has no agent assigned yet — ask your admin to bind one.");
    return;
  }
  const cleared = await clearConversation({
    userId,
    conversationId: channelConversationId(account.channel, account.accountKey, agentSlug, chatId),
    agentSlug,
  });
  await reply(
    cleared
      ? "Fresh start — I've forgotten what we were talking about."
      : "Couldn't clear the conversation. Please try again.",
  );
}
