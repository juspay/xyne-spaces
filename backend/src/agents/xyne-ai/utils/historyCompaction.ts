/**
 * History Compaction Utility
 *
 * Session-level pre-flight check before every LLM invocation. If the built
 * messages payload is too big, iteratively drop the oldest USER–ASSISTANT
 * turn pairs until the payload fits under the configured target. DB-persisted
 * messages are never mutated — compaction is purely in-memory for the current
 * LLM call.
 *
 * Mirrors the trim-until-it-fits loop from `tools/utils/tokenBudget.ts` but at
 * the history level rather than the tool-output level.
 */

import type { Message } from '@juspay-jaf/jaf';
import { logger } from '../../../utils/logger.js';
import { tokenCount } from '../tools/utils/tokenBudget.js';

/**
 * Fixed per-attachment token estimate. Vision models tokenize an image at
 * ~1000–1600 tokens regardless of its base64 byte count, so counting base64
 * characters would wildly overestimate and trigger false-positive compaction.
 */
export const ATTACHMENT_TOKEN_ESTIMATE = 1600;

/**
 * Never drop below this many most-recent turn pairs. Guarantees the agent has
 * conversational context even when one recent message is pathologically large.
 */
export const MIN_PRESERVED_TURNS = 2;

/**
 * Fixed overhead the model sees on every turn that isn't in the `messages`
 * array: system prompt (~8–15k), tool schemas (~3–8k), and JAF metadata.
 * Folding it in here makes the estimator's output directly comparable to the
 * `input_tokens` a provider/Langfuse trace will report for the call, and gives
 * us a single place to adjust if the baseline drifts (new tools, bigger prompt).
 */
export const AGENT_BASELINE_TOKEN_ESTIMATE = 16000;

export interface CompactionThresholds {
  /** Start trimming once estimated tokens reach this. */
  trigger: number;
  /** Stop trimming once estimated tokens fall to this. */
  target: number;
}

export interface CompactionResult {
  messages: Message[];
  compacted: boolean;
  droppedTurns: number;
  tokensBefore: number;
  tokensAfter: number;
}

function estimateMessageTokens(msg: Message): number {
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
  const attachmentCount = Array.isArray(msg.attachments) ? msg.attachments.length : 0;
  return tokenCount(content) + attachmentCount * ATTACHMENT_TOKEN_ESTIMATE;
}

/** Raw sum of per-message tokens — no baseline. Used for sub-array math inside
 * compaction so we don't double-count overhead. */
function estimateContentTokens(messages: Message[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

/**
 * Public estimator: baseline + per-message content. The returned number should
 * be directly comparable to the `input_tokens` a provider reports for the call.
 */
export function estimateMessagesTokens(messages: Message[]): number {
  return AGENT_BASELINE_TOKEN_ESTIMATE + estimateContentTokens(messages);
}

export function formatCompactionNotice(droppedTurns: number): string {
  return `[Earlier context compacted: ${droppedTurns} turn${droppedTurns === 1 ? '' : 's'} dropped to fit context. Ask about them explicitly if needed.]`;
}

/**
 * Split the pre-built messages array into three segments:
 *   - `droppable`: older messages that can be trimmed (oldest first).
 *   - `floor`: the most-recent MIN_PRESERVED_TURNS complete pairs — never dropped.
 *   - `tail`: trailing messages after the last complete pair (normally the
 *     current unpaired user query). Never dropped.
 *
 * A "complete pair" is a USER immediately followed by an ASSISTANT. We walk
 * from the end backward so we can identify the N most-recent pairs even when
 * the array has an unpaired tail.
 */
function partition(messages: Message[]): { droppable: Message[]; floor: Message[]; tail: Message[] } {
  // Walk from the end, accumulating pairs into `floor` until we have N.
  const floor: Message[] = [];
  const tail: Message[] = [];
  let i = messages.length - 1;
  let pairsCollected = 0;

  // Trailing unpaired messages (usually just the current user query) go into tail.
  while (i >= 0 && !(messages[i].role === 'assistant' && i - 1 >= 0 && messages[i - 1].role === 'user')) {
    tail.unshift(messages[i]);
    i--;
  }

  while (i >= 1 && pairsCollected < MIN_PRESERVED_TURNS) {
    if (messages[i].role === 'assistant' && messages[i - 1].role === 'user') {
      floor.unshift(messages[i]);
      floor.unshift(messages[i - 1]);
      pairsCollected++;
      i -= 2;
    } else {
      // Odd shape — stop here and treat the rest as droppable.
      break;
    }
  }

  const droppable = messages.slice(0, i + 1);
  return { droppable, floor, tail };
}

/**
 * Trim from the oldest end of `droppable`. Prefers dropping USER+ASSISTANT
 * pairs together (keeps structure coherent — an orphaned reply is worse than
 * losing a whole turn), but falls back to single-message drops on odd shapes.
 * Returns the number of turn pairs (or stray messages, counted as pairs) that
 * were removed, and the new total estimate.
 */
function trimToTarget(
  droppable: Message[],
  startingTokens: number,
  target: number,
): { remaining: Message[]; dropped: Message[]; tokensAfter: number; droppedTurns: number } {
  let running = startingTokens;
  let droppedTurns = 0;
  const dropped: Message[] = [];
  const remaining = [...droppable];

  while (running > target && remaining.length > 0) {
    const first = remaining[0];
    const second = remaining[1];

    if (first.role === 'user' && second?.role === 'assistant') {
      running -= estimateMessageTokens(first) + estimateMessageTokens(second);
      dropped.push(first, second);
      remaining.splice(0, 2);
    } else {
      // Orphan (e.g. a user with no assistant reply, or an unexpected role).
      // Drop one at a time to make progress.
      running -= estimateMessageTokens(first);
      dropped.push(first);
      remaining.splice(0, 1);
    }
    droppedTurns++;
  }

  return { remaining, dropped, tokensAfter: running, droppedTurns };
}

/**
 * Compact `messages` if the estimated token count is at or above `trigger`.
 * Drops oldest pairs iteratively until the estimate falls to `target`, never
 * going below the floor. Pure function — no I/O, no mutation of inputs beyond
 * the returned array.
 */
export function compactHistoryIfNeeded(
  messages: Message[],
  thresholds: CompactionThresholds,
  sessionId?: string,
): CompactionResult {
  const tokensBefore = estimateMessagesTokens(messages);

  if (tokensBefore < thresholds.trigger) {
    return { messages, compacted: false, droppedTurns: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  const { droppable, floor, tail } = partition(messages);
  // Sub-array math must use the raw content estimator — otherwise the baseline
  // gets added per sub-group and the trim target collapses.
  const floorAndTailTokens = estimateContentTokens(floor) + estimateContentTokens(tail);
  const droppableTokens = estimateContentTokens(droppable);

  // Trim target is the *content-only* budget: total target minus baseline and
  // minus the protected floor/tail content.
  const contentTarget = Math.max(
    0,
    thresholds.target - AGENT_BASELINE_TOKEN_ESTIMATE - floorAndTailTokens,
  );

  const { remaining, dropped, tokensAfter: droppableAfter, droppedTurns } = trimToTarget(
    droppable,
    droppableTokens,
    contentTarget,
  );

  const tokensAfter = AGENT_BASELINE_TOKEN_ESTIMATE + floorAndTailTokens + droppableAfter;

  if (dropped.length === 0) {
    // Nothing to drop (session is already at the floor).
    logger.warn(
      `[HistoryCompaction]${sessionId ? ` [${sessionId}]` : ''} over trigger but no droppable turns ` +
        `(tokens=${tokensBefore}, trigger=${thresholds.trigger}, target=${thresholds.target}, ` +
        `floorAndTailTokens=${floorAndTailTokens})`,
    );
    return { messages, compacted: false, droppedTurns: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  const notice: Message = { role: 'assistant', content: formatCompactionNotice(droppedTurns) };
  const compacted = [notice, ...remaining, ...floor, ...tail];

  if (tokensAfter > thresholds.target) {
    // We dropped everything we could above the floor but still didn't reach target.
    // Log a warning but return what we have — the result is still smaller than the
    // input and smaller than trigger once the notice overhead is negligible.
    logger.warn(
      `[HistoryCompaction]${sessionId ? ` [${sessionId}]` : ''} hit floor before reaching target ` +
        `(tokensBefore=${tokensBefore}, tokensAfter=${tokensAfter}, target=${thresholds.target}, ` +
        `droppedTurns=${droppedTurns})`,
    );
  }

  return { messages: compacted, compacted: true, droppedTurns, tokensBefore, tokensAfter };
}
