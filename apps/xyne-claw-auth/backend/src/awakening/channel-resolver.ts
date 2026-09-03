/**
 * Turns an agent's channel RULES into the concrete set of Spaces channels a
 * wake will read, with a short-TTL cache in front.
 *
 * Resolved on every wake, never once at config time: channels get created,
 * renamed, archived, and the bot gets added to and removed from them. A
 * snapshot taken at save time rots silently, and a backbone must not depend
 * on one. The cache key includes a hash of the rules, so editing them
 * invalidates instantly with no explicit bust.
 *
 * Rule semantics live in channel-rules.ts; this module owns only the I/O.
 */

import { redisService } from "../redis.js";
import { boundedInteract } from "./spaces-read.js";
import { hashChannelRules, type AwakeningChannelRules } from "./config.js";
import { applyChannelRules, type ChannelRuleResult } from "./channel-rules.js";
import type { AgentSpacesIdentity, ResolvedChannel } from "./types.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-channels");

const CACHE_TTL_MAX_MS = 15 * 60_000;
const MEMBERSHIP_PAGE = 1000;

interface CachedResolution extends ChannelRuleResult {
  resolvedAtMs: number;
}

function cacheKey(agentId: string, rules: AwakeningChannelRules): string {
  return `claw:awk:chan:${agentId}:${hashChannelRules(rules)}`;
}

/**
 * The bot's channel memberships, as full rows.
 *
 * No `select` on either query: the Spaces query AST (QueryASTSchema in
 * apps/backend/src/services/pythonQuery/validator.ts) defines only
 * model/operation/where/orderBy/take/skip, so a `select` is silently stripped
 * and the row comes back whole. Projecting here would be a lie about what the
 * wire actually carries.
 */
async function fetchMemberships(identity: AgentSpacesIdentity): Promise<ResolvedChannel[]> {
  const auth = { token: identity.appToken, workspaceId: identity.workspaceId };

  const participants = await boundedInteract<Array<{ channelId: string }>>(
    {
      model: "channelParticipant",
      operation: "findMany",
      where: { userId: { equals: identity.spacesAppUserId } },
      take: MEMBERSHIP_PAGE,
    },
    auth,
  );

  const ids = [...new Set(participants.map((p) => p.channelId).filter(Boolean))];
  if (ids.length === 0) return [];

  const channels = await boundedInteract<Array<{ id: string; name: string; lastActivityAt: string }>>(
    {
      model: "channel",
      operation: "findMany",
      where: {
        id: { in: ids },
        isArchived: { equals: false },
        scopeType: { equals: "DEFAULT" },
      },
      orderBy: [{ lastActivityAt: "desc" }],
      take: MEMBERSHIP_PAGE,
    },
    auth,
  );

  return channels.map((c) => ({
    id: c.id,
    name: c.name ?? "",
    lastActivityAt: new Date(c.lastActivityAt).getTime() || 0,
  }));
}

/**
 * Resolve the watched channel set.
 *
 * Stale-ok on failure: if Spaces is unreachable we return the last cached
 * value even past its TTL, because a stale channel list is enormously better
 * than a skipped wake. Only a cold cache plus a failed fetch throws — and the
 * caller must then NOT advance the watermark.
 */
export async function resolveAwakeningChannels(
  agentId: string,
  rules: AwakeningChannelRules,
  identity: AgentSpacesIdentity,
  periodMs: number,
): Promise<ChannelRuleResult & { stale: boolean }> {
  const redis = redisService.getConnection();
  const key = cacheKey(agentId, rules);
  const freshnessMs = Math.min(periodMs, CACHE_TTL_MAX_MS);

  const cached = await redis.get(key).catch(() => null);
  let parsed: CachedResolution | null = null;
  if (cached) {
    try {
      parsed = JSON.parse(cached) as CachedResolution;
    } catch {
      parsed = null;
    }
  }
  if (parsed && Date.now() - parsed.resolvedAtMs < freshnessMs) {
    return { channels: parsed.channels, truncated: parsed.truncated, stale: false };
  }

  try {
    const resolved = applyChannelRules(await fetchMemberships(identity), rules);
    const payload: CachedResolution = { ...resolved, resolvedAtMs: Date.now() };
    // TTL is generous relative to the freshness check above so the value
    // survives as a stale fallback well past the point we stop trusting it.
    await redis.set(key, JSON.stringify(payload), "PX", freshnessMs * 4).catch(() => undefined);
    return { ...resolved, stale: false };
  } catch (err) {
    if (parsed) {
      log.warn(
        `[awakening] channel resolution failed for agent=${agentId}; serving stale set of ${parsed.channels.length}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { channels: parsed.channels, truncated: parsed.truncated, stale: true };
    }
    throw err;
  }
}
