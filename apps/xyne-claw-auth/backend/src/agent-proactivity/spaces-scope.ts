/**
 * What a proactive run may read, answered by Spaces, which owns channels and their ACLs,
 * as the agent's bot. Any failure is a no: the run is refused the read, and a card
 * learns from nothing.
 */

import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { errMsg } from "../lib/errors.js";

const log = createLogger("agent-proactivity-scope");

export type SpacesScopeRef =
  | { kind: "channel"; id: string }
  | { kind: "conversation"; id: string }
  | { kind: "message"; id: string }
  | { kind: "ticket"; id: string };

/** The agent's bot in Spaces, whose channel access the answers are given with. */
export interface BotUser {
  userId: string;
  workspaceId: string;
}

async function ask<T>(path: string, body: unknown, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${CONFIG.spacesInternalUrl}/api/internal/proactivity/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": process.env["INTERNAL_S2S_KEY"] ?? "" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      log.warn(`[scope] ${path} returned ${res.status}`);
      return fallback;
    }
    return (await res.json()) as T;
  } catch (err) {
    log.warn(`[scope] ${path} failed: ${errMsg(err)}`);
    return fallback;
  }
}

/**
 * Every reference must be in the room, or in a public channel of its workspace; only the
 * room itself when a guest is in it.
 */
export async function roomAllows(bot: BotUser, roomChannelId: string, refs: SpacesScopeRef[]): Promise<boolean> {
  const { allowed } = await ask("room-allows", { ...bot, roomChannelId, refs }, { allowed: false });
  return allowed === true;
}

/** Which of these channels are public. */
export async function publicChannels(bot: BotUser, channelIds: string[]): Promise<Set<string>> {
  if (channelIds.length === 0) return new Set();
  const { channelIds: ids } = await ask("public-channels", { ...bot, channelIds }, { channelIds: [] as string[] });
  return new Set(Array.isArray(ids) ? ids : []);
}
