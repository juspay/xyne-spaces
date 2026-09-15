/**
 * Pure ranking primitives for the channel @-mention picker.
 * See: Spec "Channel @ Mention Picker — Ranking & Cohort Logic" (2026-05-05).
 *
 * All numeric weights/scores come from MentionRankingCacConfig so they can be
 * tuned via Superposition without a code release.
 */

import type { MentionRankingCacConfig } from '../config/mentionRankingCacConfig.js';
import type { MentionResult } from '../types/mention.js';
import { matchesAllTokens } from './tokenMatch.js';

export type MatchKind = 'prefix' | 'substring' | 'tokens' | 'fuzzy' | 'none';

export type SpecialMentionKind = 'channel' | 'here';

export interface SpecialMentionDescriptor {
  id: string;
  literal: SpecialMentionKind;
  description: string;
}

const SPECIAL_DESCRIPTIONS: Record<SpecialMentionKind, SpecialMentionDescriptor> = {
  channel: {
    id: 'special-channel',
    literal: 'channel',
    description: 'Notify all members in this channel',
  },
  here: {
    id: 'special-here',
    literal: 'here',
    description: 'Notify all online members',
  },
};

function fuzzyContains(haystack: string, needle: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

export function matchKind(text: string, query: string): MatchKind {
  if (!query) return 'none';
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.startsWith(q)) return 'prefix';
  if (t.includes(q)) return 'substring';
  // Reordered / partial multi-word match ('prasad siva' → 'Bannala Siva Prasad'). Sits above
  // fuzzy so these deliberate matches aren't dropped as matchQuality 0 by rankCandidates.
  if (matchesAllTokens(t, q)) return 'tokens';
  if (fuzzyContains(t, q)) return 'fuzzy';
  return 'none';
}

export function matchQuality(
  fields: Array<string | null | undefined>,
  query: string,
  config: MentionRankingCacConfig,
): number {
  if (!query) return 1;
  let best = 0;
  for (const raw of fields) {
    if (!raw) continue;
    const kind = matchKind(raw, query);
    // 'tokens' reuses the substring weight — a reordered/partial match is treated as strong as
    // a contiguous substring match, and always outranks a pure fuzzy (subsequence) match.
    const score =
      kind === 'prefix'
        ? config.matchPrefix
        : kind === 'substring' || kind === 'tokens'
          ? config.matchSubstring
          : kind === 'fuzzy'
            ? config.matchFuzzy
            : 0;
    if (score > best) best = score;
  }
  return best;
}

export function isPrefixMatch(fields: Array<string | null | undefined>, query: string): boolean {
  if (!query) return false;
  return fields.some(f => f && matchKind(f, query) === 'prefix');
}

export function normalizeAffinity(rankedIds: string[]): Map<string, number> {
  const m = new Map<string, number>();
  const n = rankedIds.length;
  if (n === 0) return m;
  if (n === 1) {
    m.set(rankedIds[0]!, 1);
    return m;
  }
  for (let i = 0; i < n; i++) {
    m.set(rankedIds[i]!, 1 - i / (n - 1));
  }
  return m;
}

export interface ScoreInputs {
  matchQuality: number;
  isChannelMember: boolean;
  isEngagedInContext: boolean;
  affinityScore: number;
  isSpecialMention: boolean;
  isGroupMatchingName: boolean;
}

export function scoreCandidate(s: ScoreInputs, config: MentionRankingCacConfig): number {
  return (
    s.matchQuality +
    (s.isChannelMember ? config.weightChannelMember : 0) +
    (s.isEngagedInContext ? config.weightEngagedInContext : 0) +
    s.affinityScore * config.weightAffinity +
    (s.isSpecialMention ? config.weightSpecialMention : 0) +
    (s.isGroupMatchingName ? config.weightGroupMatch : 0)
  );
}

export interface EligibleSpecialsOpts {
  isDMChannel: boolean;
  shouldSearch: boolean;
}

export function eligibleSpecials(opts: EligibleSpecialsOpts): SpecialMentionDescriptor[] {
  if (opts.isDMChannel) return [];
  if (!opts.shouldSearch) return [];
  return [SPECIAL_DESCRIPTIONS.channel, SPECIAL_DESCRIPTIONS.here];
}

export interface ScoredCandidate {
  score: number;
  result: MentionResult;
  tieKey: string;
}

export interface RankableCandidate {
  matchFields: Array<string | null | undefined>;
  scoreInputs: Omit<ScoreInputs, 'matchQuality'>;
  result: MentionResult;
  tieKey: string;
}

export function rankCandidates(
  candidates: RankableCandidate[],
  query: string,
  cap: number,
  config: MentionRankingCacConfig,
): MentionResult[] {
  const shouldSearch = query.trim().length > 0;
  const scored: ScoredCandidate[] = [];
  for (const c of candidates) {
    const mq = shouldSearch ? matchQuality(c.matchFields, query, config) : 1;
    if (mq === 0) continue;
    scored.push({
      score: scoreCandidate({ matchQuality: mq, ...c.scoreInputs }, config),
      result: c.result,
      tieKey: c.tieKey,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.tieKey.localeCompare(b.tieKey));
  return scored.slice(0, cap).map(s => s.result);
}
