import { redisService } from "../../redis.js";
import { activeRun, describeElapsed } from "./commands.js";
import { REDIS_PREFIX } from "./const.js";
import { enqueueOutbound } from "./delivery.js";
import type { ChannelDeliveryTarget } from "./plugin.js";

export const CHECKPOINT_FIRST_AFTER_MS = 45_000;
export const CHECKPOINT_EVERY_MS = 60_000;
export const CHECKPOINT_MAX = 5;
const CHECKPOINT_TTL_S = 60 * 60;
const GENERIC_LABEL = /^(working on it|executing tools|thinking)\b/i;

const gateKey = (sessionId: string): string => `${REDIS_PREFIX}:checkpoint:gate:${sessionId}`;
const countKey = (sessionId: string): string => `${REDIS_PREFIX}:checkpoint:count:${sessionId}`;

export function checkpointText(toolLabel: string, startedAt: number): string {
  const step = toolLabel.replace(/\s+/g, " ").trim().slice(0, 80);
  const elapsed = describeElapsed(startedAt);
  return step && !GENERIC_LABEL.test(step)
    ? `⏳ Still on it (${elapsed}) — ${step}`
    : `⏳ Still working on it (${elapsed}).`;
}

export async function maybeSendCheckpoint(sessionId: string, target: ChannelDeliveryTarget, toolLabel: string): Promise<boolean> {
  const run = await activeRun(target.connectedSurfaceId, target.chatId);
  if (!run || run.sessionId !== sessionId) return false;
  if (Date.now() - run.startedAt < CHECKPOINT_FIRST_AFTER_MS) return false;
  const redis = redisService.getConnection();
  const gate = await redis.set(gateKey(sessionId), "1", "PX", CHECKPOINT_EVERY_MS, "NX");
  if (gate !== "OK") return false;
  const sent = await redis.incr(countKey(sessionId));
  await redis.expire(countKey(sessionId), CHECKPOINT_TTL_S);
  if (sent > CHECKPOINT_MAX) return false;
  await enqueueOutbound(target.connectedSurfaceId, { kind: "text", chatId: target.chatId, text: checkpointText(toolLabel, run.startedAt) });
  return true;
}

export async function stopCheckpoints(sessionId: string): Promise<void> {
  await redisService
    .getConnection()
    .set(countKey(sessionId), String(CHECKPOINT_MAX), "EX", CHECKPOINT_TTL_S)
    .catch(() => undefined);
}
