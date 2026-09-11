import { redisService } from "../redis.js";
import { errMsg } from "./errors.js";
import { createLogger } from "../logger.js";

const FAST_MODE_PREFIX = "fast-mode:";
const FAST_MODE_TTL_SECONDS = 90 * 24 * 60 * 60;
const log = createLogger("fast-mode");

function fastModeKey(conversationId: string, agentSlug: string): string {
  return `${FAST_MODE_PREFIX}${conversationId} ${agentSlug}`;
}

export function agentConfigFastMode(config?: unknown): boolean {
  const cfg = (config as Record<string, unknown> | null) ?? null;
  return cfg?.["fastMode"] === true || cfg?.["fastMode"] === "true";
}

export async function setFastModeOverride(
  conversationId: string,
  agentSlug: string,
  enabled: boolean,
): Promise<void> {
  const redis = redisService.getConnection();
  await redis.set(fastModeKey(conversationId, agentSlug), enabled ? "1" : "0", "EX", FAST_MODE_TTL_SECONDS);
}

export async function resolveFastMode(
  conversationId: string | undefined | null,
  agentSlug: string | undefined | null,
  agentConfig?: unknown,
): Promise<boolean> {
  if (conversationId && agentSlug) {
    try {
      const redis = redisService.getConnection();
      const key = fastModeKey(conversationId, agentSlug);
      const raw = await redis.get(key);
      if (raw === "1" || raw === "0") {
        await redis.expire(key, FAST_MODE_TTL_SECONDS).catch((err) => {
          log.warn("Failed to refresh fast mode override TTL", { error: errMsg(err) });
        });
        return raw === "1";
      }
    } catch (err) {
      log.warn("Failed to read fast mode override; falling back to agent config", {
        conversationId,
        agentSlug,
        error: errMsg(err),
      });
    }
  }
  return agentConfigFastMode(agentConfig);
}
