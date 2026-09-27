import type { JsonValue } from '@openfeature/server-sdk';
import { config as envConfig } from '@/config/env';
import { logger } from '@/utils/logger';
import { superpositionClient } from '@/services/superpositionClient';
import type { TransformedSearchResult } from '@/services/vespaSearch/resultTransform';
import {
  askJev,
  isJevConfigured,
  type JevAnswer,
  type JevNoulQuestion,
  type JevQuestion,
} from '@/services/queryIntent/jevClient';
import {
  retrieveCandidates,
  type Candidate,
  type CandidateKind,
  type RetrievalContext,
} from './retrieval';

/** How an existing item relates to what someone is typing. */
export type RelatedLabel = 'answers_it' | 'same_question' | 'related_discussion';

export interface RelatedItem {
  id: string;
  kind: CandidateKind;
  label: RelatedLabel;
  /** P(the item is about the same thing as the draft), from Jev. For ordering and tuning. */
  confidence: number;
  /** The search result to open, in the shape cmd+K navigation takes. */
  result: TransformedSearchResult;
}

export interface RelatedContext {
  items: RelatedItem[];
  /**
   * Whether the draft was ready to search. False means it was not searched — cut off
   * mid-sentence, or nothing to look up — rather than searched with nothing found.
   * Absent when that could not be decided (Jev did not answer).
   */
  ready?: boolean;
  /**
   * The lookup failed — Jev or the search did not answer. Nothing to show for now, but
   * not an answer to remember: the next pause is worth asking again.
   */
  failed?: boolean;
}

/** Who is typing (their full ACL context) and the thread they are typing in, if any. */
export type RelatedContextRequest = RetrievalContext;

/**
 * Superposition object, merged over the defaults below so a partial override (say,
 * `{ "enabled": true }` for one workspace) keeps every other value.
 */
const CONFIG_KEY = 'chat_related_context_config';

interface RelatedContextConfig {
  enabled: boolean;
  /** Drafts shorter than this are acknowledgements and names, not questions. */
  minWords: number;
  /** Longer drafts are cut here before search and classification. */
  maxDraftChars: number;
  /**
   * Message hits fetched before they are collapsed into threads. Several replies of
   * one thread come back as separate hits, so this runs well above perKind to leave
   * enough distinct threads.
   */
  messageHits: number;
  /**
   * Candidates kept per kind (threads, tickets, canvases, calls). This bounds the
   * pool Jev judges — two questions each, all in one request, which takes longer the
   * more it carries — not what is shown: every candidate that clears minRelevance
   * comes back.
   */
  perKind: number;
  /** P(the draft is a finished thought worth searching) needed to search at all. */
  completeThreshold: number;
  /**
   * P(the candidate is about the same thing) needed to show it. On jev-trained over
   * the seeded scenarios, matches scored 0.53-0.96 and look-alikes 0.01-0.12.
   */
  minRelevance: number;
  /**
   * Per Jev request. There are two, one after the other: whether the draft is ready
   * to search, then — after the search — the verdicts on what it found.
   */
  timeoutMs: number;
}

const DEFAULT_CONFIG: RelatedContextConfig = {
  enabled: false,
  minWords: 4,
  maxDraftChars: 600,
  messageHits: 50,
  perKind: 10,
  completeThreshold: 0.5,
  minRelevance: 0.4,
  timeoutMs: 5000,
};

const getConfig = async (req: RelatedContextRequest): Promise<RelatedContextConfig> => {
  const remote = (await superpositionClient.getObjectValue(CONFIG_KEY, {} as JsonValue, {
    userId: req.auth.userId,
    workspaceId: req.auth.workspaceId,
  })) as Partial<RelatedContextConfig> | null;
  return { ...DEFAULT_CONFIG, ...remote };
};

/**
 * Drafts not worth a search: short ones, slash commands, and ones that are only
 * mentions, links or emoji. Most keystroke pauses end here, at no cost.
 */
const isWorthLookingUp = (draft: string, minWords: number): boolean => {
  if (draft.startsWith('/')) return false;
  const words = draft
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/\s+/)
    .filter((word) => /\p{L}{2,}/u.test(word) && !word.startsWith('@'));
  return words.length >= minWords;
};

/**
 * Whether the draft says enough to look anything up. Not whether it is a question: an
 * update or a decision relates to earlier work as much as a question does. What
 * fails is the unfinished and the empty — the pause mid-sentence, the "sounds good".
 * Plain wording with an example per side, as the cmd+K intent question learned.
 */
const IS_COMPLETE: JevNoulQuestion = {
  type: 'noul',
  instructions:
    'Is `draft` a finished thought with a clear subject that earlier conversations, ' +
    'tickets or documents could be about?',
  criteria: {
    true:
      'A complete question, problem, request, update or decision, like "how do I get ' +
      'staging VPN access", "the settlement report is late again" or "we are moving ' +
      'the release to Friday"',
    false:
      'Cut off mid-sentence, or nothing to look up, like "can you check why the", ' +
      '"ok sounds good, thanks" or "haha nice one"',
  },
};

/** The gate: the cleanest signal Jev gives here, far cleaner than the label's own score. */
const RELEVANT_CRITERIA = {
  true: 'The same problem or topic, even in different words',
  false: 'A different subject, even if some words match',
};

const RELATION_CRITERIA = {
  answers_it: 'It contains the answer, the fix or the steps for what the draft asks or reports.',
  same_question:
    'Someone already asked the same question or reported the same problem there, but it gives no answer.',
  related_discussion: 'It discusses the same topic or problem, without a direct answer.',
  unrelated: 'It is about something else, even if some words match.',
};

const KIND_NAMES: Record<CandidateKind, string> = {
  thread: 'chat thread',
  ticket: 'ticket',
  canvas: 'document',
  call: 'call',
};

const LABELS: RelatedLabel[] = ['answers_it', 'same_question', 'related_discussion'];

/**
 * A candidate as one fenced quote. Any run of three or more quote marks is taken out
 * of the text in one pass, so nothing left over can close the fence early.
 */
const quoteCandidate = (candidate: Candidate): string =>
  `Candidate ${KIND_NAMES[candidate.kind]}:\n"""\n${candidate.text.replace(/"{3,}/g, '"')}\n"""`;

/**
 * Every candidate's questions, for one Jev request. Jev answers each question on its
 * own, seeing only the state and that question's instructions — so with just the
 * draft in the state and each candidate quoted into its own two questions, every
 * verdict weighs the draft against that one candidate. (Candidates put side by side
 * in the state bled into each other's answers: a VPN guide scored as "the answer" to
 * a double charge because the charge runbook sat next to it.)
 *
 * The price of this shape: other people's text sits in the instructions, so a message
 * written to argue its own relevance could get itself shown. Every candidate came from
 * the reader's own permission-filtered search, so the worst it can do is show up where
 * it doesn't belong.
 */
const verdictQuestions = (candidates: Candidate[]): Record<string, JevQuestion> =>
  Object.fromEntries(
    candidates.flatMap((candidate, i): Array<[string, JevQuestion]> => {
      const quoted = quoteCandidate(candidate);
      return [
        [
          `relevant${i}`,
          {
            type: 'noul',
            instructions: `${quoted}\nIs this candidate about the same problem or topic as \`draft\`?`,
            criteria: RELEVANT_CRITERIA,
          },
        ],
        [
          `relation${i}`,
          {
            type: 'choice',
            instructions: `${quoted}\nHow does this candidate relate to what \`draft\` asks or reports?`,
            criteria: RELATION_CRITERIA,
          },
        ],
      ];
    })
  );

/**
 * How an on-topic candidate relates. The likeliest of the three related answers, since
 * once an item is on topic "unrelated" is not a choice left to make; when Jev gave no
 * probabilities for them, its own choice, and failing that the mildest claim.
 */
const labelOf = (relation: Extract<JevAnswer, { type: 'choice' }>): RelatedLabel => {
  const scored = LABELS.filter((label) => relation.probabilities[label] !== undefined);
  if (scored.length > 0) {
    return scored.reduce((best, next) =>
      (relation.probabilities[next] ?? 0) > (relation.probabilities[best] ?? 0) ? next : best
    );
  }
  const chosen = LABELS.find((label) => label === relation.choice);
  return chosen ?? 'related_discussion';
};

/**
 * The candidates that are about what the draft is about, most relevant first, each
 * with how it relates; null when Jev could not say. Relevance decides whether it
 * shows. A candidate whose answers came back unusable is skipped on its own; the
 * others still count.
 */
async function classify(
  draft: string,
  candidates: Candidate[],
  config: RelatedContextConfig,
  signal: AbortSignal | undefined
): Promise<RelatedItem[] | null> {
  const started = Date.now();
  const answers = await askJev({ draft }, verdictQuestions(candidates), config.timeoutMs, signal, {
    partial: true,
  });
  const ms = Date.now() - started;
  logger.info('[RelatedContext] jev verdicts', {
    candidates: candidates.length,
    ok: answers !== null,
    ms,
  });
  if (!answers) {
    // The status or timeout is in jevClient's warning just before this.
    if (!signal?.aborted) {
      logger.error('[RelatedContext] jev verdict call failed', {
        candidates: candidates.length,
        ms,
      });
    }
    return null;
  }

  const items = candidates.flatMap((candidate, i): RelatedItem[] => {
    const relevant = answers[`relevant${i}`];
    const relation = answers[`relation${i}`];
    if (relevant?.type !== 'noul' || relation?.type !== 'choice') return [];
    if (relevant.noul < config.minRelevance) return [];
    return [
      {
        id: candidate.id,
        kind: candidate.kind,
        label: labelOf(relation),
        confidence: relevant.noul,
        result: candidate.result,
      },
    ];
  });
  // Everything that clears the threshold, most relevant first — no cap.
  return items.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Finds conversations, tickets, documents and calls a draft relates to, and how:
 * where it is answered, where it was asked before, where it was discussed.
 *
 * First, whether the draft is ready to search: a finished thought — a question, but
 * also an update or a decision — not a half-typed sentence or a "sounds good". Only
 * a ready draft is searched (one search per kind, all at once), and what the search
 * finds goes to Jev in one call. A draft that is not ready comes back
 * `{ items: [], ready: false }`, so "not searched" is never mistaken for "nothing
 * found".
 *
 * Returns null only when the feature is off for this user (not configured, or turned
 * off in Superposition) — the client stops asking for a while. Anything that fails
 * for this one draft (Jev down or slow, every search erroring) is
 * `{ items: [], failed: true }`: nothing to show now, but not an answer to keep — the
 * next pause in typing is worth trying. Never throws.
 *
 * `signal` is the caller's client going away — they typed on, or left. Work that has
 * not started yet is skipped and a Jev call in flight is cancelled.
 *
 * Drafts include DMs and private channels, so like radar dedup this only runs
 * against a Jev that was pointed at explicitly (JEV_URL and JEV_MODEL set), never
 * the public default endpoint.
 */
export async function findRelatedContext(
  text: string,
  req: RelatedContextRequest,
  signal?: AbortSignal
): Promise<RelatedContext | null> {
  if (!isJevConfigured() || !envConfig.jev.url || !envConfig.jev.model) return null;
  let config: RelatedContextConfig;
  try {
    config = await getConfig(req);
  } catch (error) {
    // The flag store is down: treat the feature as off rather than guessing it is on.
    logger.warn('[RelatedContext] config unavailable', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
  if (!config.enabled) return null;

  const nothing: RelatedContext = { items: [] };
  const failed: RelatedContext = { items: [], failed: true };
  const started = Date.now();
  try {
    const draft = text.trim().replace(/\s+/g, ' ').slice(0, config.maxDraftChars);
    if (!isWorthLookingUp(draft, config.minWords)) return { items: [], ready: false };

    const gate = await askJev({ draft }, { is_complete: IS_COMPLETE }, config.timeoutMs, signal);
    const jevGateMs = Date.now() - started;
    if (signal?.aborted) return nothing;
    if (!gate) {
      logger.error('[RelatedContext] jev is_complete call failed', { ms: jevGateMs });
      logger.info('[RelatedContext] lookup', { jevGateMs, outcome: 'jev_failed' });
      return failed;
    }
    const isComplete = gate.is_complete;
    if (isComplete.type !== 'noul' || isComplete.noul < config.completeThreshold) {
      logger.info('[RelatedContext] lookup', { jevGateMs, outcome: 'not_ready' });
      return { items: [], ready: false };
    }

    const retrievalStarted = Date.now();
    const found = await retrieveCandidates(draft, req, {
      messageHits: config.messageHits,
      perKind: config.perKind,
    });
    const retrievalMs = Date.now() - retrievalStarted;
    const candidates = found ?? [];
    // One line per lookup: where the time went and how it ended. Never the draft.
    const summary = (extra: Record<string, unknown>): void => {
      logger.info('[RelatedContext] lookup', {
        jevGateMs,
        retrievalMs,
        candidates: candidates.length,
        totalMs: Date.now() - started,
        ...extra,
      });
    };
    const searched = (items: RelatedItem[]): RelatedContext => ({ items, ready: true });

    if (signal?.aborted) {
      summary({ outcome: 'abandoned' });
      return nothing;
    }
    if (!found) {
      summary({ outcome: 'search_failed' });
      return { ...failed, ready: true };
    }
    if (candidates.length === 0) {
      summary({ outcome: 'no_candidates' });
      return searched([]);
    }

    const items = await classify(draft, candidates, config, signal);
    if (signal?.aborted) {
      summary({ outcome: 'abandoned' });
      return nothing;
    }
    if (!items) {
      summary({ outcome: 'jev_failed' });
      return { ...failed, ready: true };
    }
    summary({ outcome: 'ok', items: items.length });
    return searched(items);
  } catch (error) {
    // The error's name only: its message can carry the draft.
    logger.error('[RelatedContext] lookup failed', {
      error: error instanceof Error ? error.name : 'unknown',
      totalMs: Date.now() - started,
    });
    return failed;
  }
}
