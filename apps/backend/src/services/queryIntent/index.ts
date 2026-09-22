import { superpositionClient } from '@/services/superpositionClient';
import { askJevNoul, isJevConfigured, type JevNoulQuestion } from './jevClient';

/** How the cmd+K palette should treat a query. */
export type QueryMode = 'lexical' | 'ai';

/** Classification sent to the client alongside search results. */
export interface QueryIntent {
  mode: QueryMode;
  /** Probability that the query needs AI, from Jev. Kept for analytics and tuning. */
  pAI: number;
}

export interface QueryIntentContext {
  userId: string;
  workspaceId: string;
}

/** Superposition boolean; turns classification (and so the cmd+K AI overview) on or off. */
const FEATURE_FLAG = 'cmdk_ai_overview_enabled';

/** P(AI) strictly above this puts the query in AI mode. */
const AI_MODE_THRESHOLD = 0.8;

/**
 * Jev measured 1-5s end to end. Classification runs in its own request, alongside search,
 * so waiting this long only delays the AI overview, never the search results.
 */
const TIMEOUT_MS = 5000;

// Plain wording beats search jargon: "meaning search vs lexical search" caught 0-5 of 12
// questions, while "carries a meaning" with one example per side caught 11-12. Naming
// "asking for some information" lifted lookups like "what is pragati link" from 0.77 to 0.93.
const NEEDS_AI: JevNoulQuestion = {
  type: 'noul',
  instructions:
    'Does this search query carry a meaning to understand (a question, a request, or asking ' +
    'for some information), rather than just keywords to match?',
  criteria: {
    true:
      'It has a meaning: a question, a request, or asking for some information, like ' +
      '"how to deploy vespa db", "why is settlement failing" or "what is the vpn link"',
    false: 'Just keywords, a name or a title, like "vespa db" or "settlement report pdf"',
  },
};

/**
 * Queries that are unambiguously keyword lookups: names and ticket keys (<= 2 words),
 * an exact phrase, a typed filter (`type:`, `from:`, …) or a palette prefix. They go
 * straight to lexical search, so the most common queries cost no Jev call.
 */
const isClearlyLexical = (query: string): boolean => {
  const q = query.trim();
  return (
    q === '' ||
    q.split(/\s+/).length <= 2 ||
    q.includes('"') ||
    /\b\w+:/.test(q) ||
    /^[/@#]/.test(q)
  );
};

const isEnabledFor = (ctx: QueryIntentContext): Promise<boolean> =>
  superpositionClient
    .getBooleanValue(FEATURE_FLAG, false, { userId: ctx.userId, workspaceId: ctx.workspaceId })
    .catch(() => false);

/**
 * Decides whether a cmd+k query is a keyword lookup or needs AI.
 *
 * Returns null when there is no verdict: feature off, Jev not configured, the query
 * is clearly lexical, or Jev failed. Callers treat null as "lexical". Never throws.
 */
export const classifyQueryIntent = async (
  query: string,
  ctx: QueryIntentContext
): Promise<QueryIntent | null> => {
  if (!isJevConfigured() || isClearlyLexical(query)) return null;
  if (!(await isEnabledFor(ctx))) return null;

  const pAI = await askJevNoul(query.trim(), NEEDS_AI, TIMEOUT_MS);
  if (pAI === null) return null;
  return { mode: pAI > AI_MODE_THRESHOLD ? 'ai' : 'lexical', pAI };
};
