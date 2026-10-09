import type { JsonValue } from '@openfeature/server-sdk';
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

/**
 * Superposition object for the cmd+K AI overview, so it can be switched and tuned without a
 * deploy. Shape: { enabled, question: { type, instructions, criteria }, threshold }.
 */
const INTENT_CONFIG_KEY = 'cmdk_ai_intent_config';

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

interface IntentConfig {
  /** Turns classification (and so the cmd+K AI overview) on or off. */
  enabled: boolean;
  question: JevNoulQuestion;
  threshold: number;
}

const DEFAULT_INTENT_CONFIG: IntentConfig = {
  enabled: false,
  question: NEEDS_AI,
  threshold: AI_MODE_THRESHOLD,
};

/** The intent config from Superposition, or the defaults above (feature off). */
const getIntentConfig = async (ctx: QueryIntentContext): Promise<IntentConfig> =>
  (await superpositionClient.getObjectValue(
    INTENT_CONFIG_KEY,
    DEFAULT_INTENT_CONFIG as unknown as JsonValue,
    { userId: ctx.userId, workspaceId: ctx.workspaceId }
  )) as unknown as IntentConfig;

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
  const config = await getIntentConfig(ctx);
  if (!config.enabled) return null;

  const pAI = await askJevNoul(query.trim(), config.question, TIMEOUT_MS);
  if (pAI === null) return null;
  return { mode: pAI > config.threshold ? 'ai' : 'lexical', pAI };
};
