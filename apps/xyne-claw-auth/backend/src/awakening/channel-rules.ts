/**
 * The pure part of channel resolution: applying an agent's include/exclude
 * rules to the set of channels its bot is actually a member of.
 *
 * Split from channel-resolver.ts (which owns the Redis cache and the Spaces
 * queries) so the rule semantics — the part with all the edge cases — can be
 * tested without a database, a cache or an env file.
 *
 * The membership list passed in is the ACL gate. Rules can only ever narrow
 * it, so a catch-all pattern like ".*" widens to exactly what the bot can
 * already read and never to a channel nobody added it to.
 */

import type { AwakeningChannelRules } from "./config.js";
import type { ResolvedChannel } from "./types.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-channel-rules");

/** Wall-clock budget for regex matching, so a pathological pattern cannot stall the tick. */
const MATCH_BUDGET_MS = 50;

function compile(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const src of patterns) {
    try {
      out.push(new RegExp(src, "i"));
    } catch {
      log.warn(`[awakening] dropping uncompilable channel pattern: ${src.slice(0, 80)}`);
    }
  }
  return out;
}

export interface ChannelRuleResult {
  channels: ResolvedChannel[];
  /** True when maxChannels cut the set short. Surfaced to the agent in the artifact. */
  truncated: boolean;
}

export function applyChannelRules(
  memberships: ResolvedChannel[],
  rules: AwakeningChannelRules,
): ChannelRuleResult {
  const includeIds = new Set(rules.include);
  const includePatterns = compile(rules.includePattern);
  const excludeIds = new Set(rules.exclude);
  const excludePatterns = compile(rules.excludePattern);
  const deadline = Date.now() + MATCH_BUDGET_MS;
  let budgetExhausted = false;

  const matches = (name: string, patterns: RegExp[]): boolean => {
    if (patterns.length === 0 || budgetExhausted) return false;
    if (Date.now() > deadline) {
      budgetExhausted = true;
      log.warn("[awakening] channel pattern matching exceeded its budget; remaining patterns skipped");
      return false;
    }
    return patterns.some((re) => re.test(name));
  };

  // No include rule at all means "every channel the bot is in" — the useful
  // default for an agent that was simply added to the channels it should watch.
  const hasIncludeRule = includeIds.size > 0 || includePatterns.length > 0;

  const selected = memberships.filter((c) => {
    if (excludeIds.has(c.id)) return false;
    if (matches(c.name, excludePatterns)) return false;
    if (!hasIncludeRule) return true;
    return includeIds.has(c.id) || matches(c.name, includePatterns);
  });

  // Sorted by recency so the cap deterministically drops the least active.
  selected.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const truncated = selected.length > rules.maxChannels;
  return { channels: selected.slice(0, rules.maxChannels), truncated };
}
