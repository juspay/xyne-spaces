import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import {
  askJev,
  isJevConfigured,
  type JevChoiceQuestion,
  type JevFailure,
  type JevNoulQuestion,
} from '@/services/queryIntent/jevClient';
import type {
  ParsedTransitions,
  ParserInput,
  ParserOperation,
} from '@/services/radar/radarParser';

/**
 * Jev for Radar's two parser calls, behind RADAR_JEV_* (run / log / replace).
 *
 * The two calls differ in what Jev can take over:
 *
 *  - A WINDOW parse writes new items — titles, summaries, owners — and Jev writes no text,
 *    so it cannot replace that parse. What it can do is answer whether the window holds
 *    anything trackable at all. Most windows do not: the parser's own prompt calls an empty
 *    answer the normal one. Replacing means skipping the parse on a confident "no".
 *
 *  - A REACTION pass may only resolve, and only one of a short list of open items. That is
 *    a closed choice, so Jev answers it whole and replacing means no parser call at all.
 *
 * Called from radarParser.parseWindow right before the model, with the very input the
 * model is about to be sent, so both judge the same pass from the same facts.
 *
 * Jev's yes/no answers are probabilities, so every decision below is a threshold on one.
 * Thresholds are tuned per JEV_MODEL — re-tune them against the logs when it changes.
 */

/**
 * A window Jev rates at or below this is skipped without a parse. Deliberately low: a
 * skipped real ask is never tracked, while an unneeded parse only costs a call.
 */
const WINDOW_SKIP_THRESHOLD = 0.15;

/** The reaction's emoji must assert completion at least this strongly… */
const REACTION_COMPLETION_THRESHOLD = 0.5;

/** …and one item must be this clearly the one settled. Above 0.5, no other item can tie,
 *  which is the parser's rule: two items fitting equally well settle neither. */
const REACTION_ITEM_THRESHOLD = 0.6;

const JEV_TIMEOUT_MS = 8_000;

/** The option standing for "this reaction settles nothing". Not a possible item id. */
const NONE = 'none';

/** Jev's limit on the options in one choice question, one kept for NONE. */
const MAX_ITEM_OPTIONS = 254;

const TAG = '[RADAR-JEV]';

/**
 * Radar text includes DMs and private channels, so it only goes to a Jev that was pointed
 * at explicitly — never the default public endpoint — and only on a named model, since the
 * thresholds above are tuned per model. Same rule as the duplicate scorer.
 */
const isRadarJevActive = (): boolean =>
  config.radar.jev.enabled && isJevConfigured() && !!config.jev.url && !!config.jev.model;

const failureReason = (failure: JevFailure | undefined): string =>
  failure?.kind === 'status' ? `status ${failure.status}` : (failure?.kind ?? 'unknown');

// ─── Window: is anything trackable? ─────────────────────────────────────────────

type WindowCheck =
  | { ok: true; probability: number; skip: boolean }
  | { ok: false; reason: string };

const WINDOW_QUESTION: JevNoulQuestion = {
  type: 'noul',
  instructions:
    'A workplace chat tracks asks: concrete requests or commitments where someone must ' +
    'act, and who holds the ball. Consider ONLY `new_messages` — `context_messages` were ' +
    'handled earlier. Does any new message raise a new ask (including a direct question ' +
    'put to a specific person, or a bare @mention handing someone shared content), claim ' +
    'or hand off an item in `open_items`, bounce one back to its requester, or settle one ' +
    '(the thing delivered, confirmed or withdrawn)? Greetings, thanks, acknowledgements, ' +
    'FYIs, cc-only mentions and volunteered status updates do not count.',
  criteria: {
    true: 'something here must be tracked or changes an open item',
    false: 'chatter — nothing to track',
  },
};

/** Never throws. `input` is exactly what the parser is sent for this window. */
async function checkWindow(input: ParserInput): Promise<WindowCheck> {
  try {
    let failure: JevFailure | undefined;
    const answers = await askJev({ ...input }, { trackable: WINDOW_QUESTION }, JEV_TIMEOUT_MS, undefined, {
      onFailure: f => {
        failure = f;
      },
    });
    const answer = answers?.trackable;
    if (!answer || answer.type !== 'noul') return { ok: false, reason: failureReason(failure) };
    return {
      ok: true,
      probability: answer.noul,
      skip: answer.noul <= WINDOW_SKIP_THRESHOLD,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : 'unknown' };
  }
}

/**
 * What Jev said beside what the parser did — or, on a skip, that the parser never ran.
 * Ids and counts only: never message text, which can come from DMs.
 */
function logWindowCheck(
  meta: { conversationId: string; windowSize: number },
  check: WindowCheck,
  parser: ParserOperation[] | 'skipped',
): void {
  const mode = config.radar.jev.replace ? 'replace' : 'shadow';
  if (!check.ok) {
    logger.info(`${TAG} window ${meta.conversationId}  NO ANSWER (${check.reason})  [${mode}]`, {
      ...meta,
      mode,
      reason: check.reason,
    });
    return;
  }
  const p = check.probability.toFixed(2);
  if (parser === 'skipped') {
    logger.info(`${TAG} window ${meta.conversationId}  SKIPPED parse  jev ${p}  [${mode}]`, {
      ...meta,
      mode,
      probability: check.probability,
      skipped: true,
    });
    return;
  }
  const ops = parser;
  // The case that matters for the threshold: Jev would have skipped a window the parser
  // found work in. Every one of these is a real ask that replace mode would drop.
  const verdict = !check.skip ? 'kept' : ops.length > 0 ? 'WOULD-MISS' : 'would-skip';
  logger.info(
    `${TAG} window ${meta.conversationId}  jev ${p} ${verdict}  parser ${ops.length} op(s)` +
      `${ops.length > 0 ? ` [${ops.map(op => op.op).join(',')}]` : ''}  [${mode}]`,
    {
      ...meta,
      mode,
      probability: check.probability,
      verdict,
      parserOps: ops.map(op => ({ op: op.op, itemId: op.itemId, sourceMessageId: op.sourceMessageId })),
    },
  );
}

// ─── Reaction: which item, if any, does it settle? ──────────────────────────────

type ReactionCheck =
  | {
      ok: true;
      /** The resolve to apply — none when the reaction settles nothing. */
      operations: ParserOperation[];
      completion: number;
      itemId: string;
      itemProbability: number;
      assessment: string;
    }
  | { ok: false; reason: string };

/**
 * Never throws. `input` is exactly what the parser is sent for this reaction pass: the
 * reacted message as the one entry in new_messages, the items the reactor is party to,
 * and who reacted with what.
 */
async function checkReaction(input: ParserInput): Promise<ReactionCheck> {
  try {
    const message = input.new_messages[0];
    const emoji = input.reaction?.emoji;
    if (!message || !emoji) return { ok: false, reason: 'not a reaction pass' };
    const items = input.open_items.slice(0, MAX_ITEM_OPTIONS);
    const name = (id: string) => input.known_users[id] ?? id;

    const completion: JevNoulQuestion = {
      type: 'noul',
      instructions:
        'Does the emoji in `reaction.emoji` assert that something is COMPLETE — a tick, a ' +
        'check mark, done, shipped, fixed? Seen, received or in progress (eyes, on-it, ' +
        'checking, reviewing, a thumbs-up) is not; nor is a celebration, a joke or a heart; ' +
        'nor a negation such as not-done. Judge the emoji name only.',
      criteria: { true: 'asserts completion', false: 'acknowledgement or anything else' },
    };

    const settles: JevChoiceQuestion = {
      type: 'choice',
      instructions:
        '`reaction.by` reacted to the one message in `new_messages`. Which item in ' +
        '`open_items` does that message settle — the thing asked for delivered, the outcome ' +
        'confirmed, or the ask withdrawn? `requested_by` is who is waiting on an item and ' +
        '`pending_on` who must act; `known_users` names them. The requester ticking an ' +
        'answer is the strongest confirmation there is. An item whose source_message_id ' +
        'equals the message id was RAISED by that message, and a completion reaction on it ' +
        'finishes that item. Topical overlap is not settlement. Answer ' +
        `"${NONE}" when no item is settled.`,
      criteria: {
        ...Object.fromEntries(
          items.map(item => [
            item.id,
            `${item.title}${item.context ? ` — ${item.context}` : ''}` +
              ` (requested by ${item.requested_by.map(name).join(', ') || 'nobody'}; ` +
              `pending on ${item.pending_on.map(name).join(', ') || 'nobody'})` +
              (item.source_message_id === message.id ? ' (raised by this message)' : ''),
          ]),
        ),
        [NONE]: 'the message settles none of these items',
      },
    };

    let failure: JevFailure | undefined;
    const answers = await askJev({ ...input }, { completion, settles }, JEV_TIMEOUT_MS, undefined, {
      onFailure: f => {
        failure = f;
      },
    });
    // All-or-nothing: a resolve needs both answers, and one alone decides nothing.
    const c = answers?.completion;
    const s = answers?.settles;
    if (!c || c.type !== 'noul' || !s || s.type !== 'choice') {
      return { ok: false, reason: failureReason(failure) };
    }
    // A choice with no probability for what it chose cannot be held to the threshold.
    // Scoring it 0 would quietly resolve nothing in replace mode; failing hands the
    // reaction to the parser instead.
    if (!Object.prototype.hasOwnProperty.call(s.probabilities, s.choice)) {
      return { ok: false, reason: 'unusable' };
    }

    const itemProbability = s.probabilities[s.choice];
    const resolves =
      c.noul >= REACTION_COMPLETION_THRESHOLD &&
      s.choice !== NONE &&
      itemProbability >= REACTION_ITEM_THRESHOLD;
    const scores = `completion ${c.noul.toFixed(2)}, item ${s.choice} ${itemProbability.toFixed(2)}`;

    return {
      ok: true,
      operations: resolves
        ? [
            {
              op: 'resolve',
              itemId: s.choice,
              sourceMessageId: message.id,
              reason: `Jev: ${emoji} asserts completion of this item (${scores}).`,
            },
          ]
        : [],
      completion: c.noul,
      itemId: s.choice,
      itemProbability,
      // The run log's one-line read, so "I reacted and nothing happened" stays answerable
      // in the debug panel when Jev decided it.
      assessment: resolves
        ? `Jev: ${emoji} settles an item (${scores}).`
        : `Jev: ${emoji} settles nothing (${scores}).`,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : 'unknown' };
  }
}

/** What Jev chose beside what the parser resolved, when both ran. Ids and scores only. */
function logReactionCheck(
  meta: { conversationId: string; emoji: string; candidates: number },
  check: ReactionCheck,
  parserResolved: string[] | null,
): void {
  const mode = config.radar.jev.replace ? 'replace' : 'shadow';
  if (!check.ok) {
    logger.info(`${TAG} reaction ${meta.conversationId}  NO ANSWER (${check.reason})  [${mode}]`, {
      ...meta,
      mode,
      reason: check.reason,
    });
    return;
  }
  const jevResolved = check.operations.map(op => op.itemId as string);
  const scores =
    `completion ${check.completion.toFixed(2)}, ` +
    `item ${check.itemId} ${check.itemProbability.toFixed(2)}`;
  const compared =
    parserResolved === null
      ? ''
      : `  ${
          jevResolved.length === parserResolved.length &&
          jevResolved.every(id => parserResolved.includes(id))
            ? 'agree'
            : 'DIFFER'
        }  parser [${parserResolved.join(',') || 'none'}]`;
  logger.info(
    `${TAG} reaction ${meta.conversationId}  ${meta.emoji}  jev [${jevResolved.join(',') || 'none'}]` +
      `${compared}  (${scores})  [${mode}]`,
    { ...meta, mode, jevResolved, parserResolved, completion: check.completion, itemId: check.itemId, itemProbability: check.itemProbability },
  );
}

// ─── Entry point: the step right before the model ───────────────────────────────

export interface JevBeforeLlm {
  /** Replace mode's answer, when Jev gave one: return it instead of calling the model. */
  answer: ParsedTransitions | null;
  /** Hand it the model's answer once the model has run, to log the two side by side. */
  afterLlm(llm: ParsedTransitions): void;
}

const resolvedIds = (transitions: ParsedTransitions): string[] =>
  transitions.operations
    .filter(op => op.op === 'resolve' && op.itemId)
    .map(op => op.itemId as string);

/**
 * Jev's part of one parse, per RADAR_JEV_*. Null when Jev is off, and the caller calls the
 * model as it always has. A reaction pass is the one carrying `input.reaction`.
 *
 *  - shadow (replace off): Jev runs alongside the model and is only logged — started here,
 *    not awaited, so it costs the parse no time.
 *  - replace: Jev is awaited. A window it rates as chatter comes back as an empty answer,
 *    which is what the model returns for chatter; a reaction comes back resolved or not.
 *    When Jev has no answer, or the window may hold something, the model runs as usual.
 */
export async function runJevBeforeLlm(
  input: ParserInput,
  conversationId: string,
): Promise<JevBeforeLlm | null> {
  if (!isRadarJevActive()) return null;
  const { replace, logEnabled } = config.radar.jev;

  if (input.reaction) {
    const meta = { conversationId, emoji: input.reaction.emoji, candidates: input.open_items.length };
    const pending = checkReaction(input);
    if (!replace) {
      return {
        answer: null,
        afterLlm: llm => {
          if (logEnabled) void pending.then(check => logReactionCheck(meta, check, resolvedIds(llm)));
        },
      };
    }
    const check = await pending;
    if (check.ok) {
      if (logEnabled) logReactionCheck(meta, check, null);
      return {
        answer: { operations: check.operations, assessment: check.assessment, decidedBy: 'jev' },
        afterLlm: () => {},
      };
    }
    // Logged whatever the log switch says: that switch hides comparisons, not breakage.
    logger.warn(`${TAG} reaction: Jev had no answer, falling back to the parser`, {
      conversationId,
      reason: check.reason,
    });
    return { answer: null, afterLlm: () => {} };
  }

  const meta = { conversationId, windowSize: input.new_messages.length };
  const pending = checkWindow(input);
  if (!replace) {
    return {
      answer: null,
      afterLlm: llm => {
        if (logEnabled) void pending.then(check => logWindowCheck(meta, check, llm.operations));
      },
    };
  }
  const check = await pending;
  if (check.ok && check.skip) {
    if (logEnabled) logWindowCheck(meta, check, 'skipped');
    return {
      answer: {
        operations: [],
        // The run log's answer to "why was nothing tracked here".
        assessment:
          `Jev rated this window ${check.probability.toFixed(2)} likely to hold anything ` +
          'trackable — parse skipped.',
        decidedBy: 'jev',
      },
      afterLlm: () => {},
    };
  }
  if (!check.ok) {
    logger.warn(`${TAG} window: Jev had no answer, parsing as usual`, {
      conversationId,
      reason: check.reason,
    });
  }
  return {
    answer: null,
    afterLlm: llm => {
      if (logEnabled) logWindowCheck(meta, check, llm.operations);
    },
  };
}
