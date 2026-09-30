import { config } from '@/config/env';
import { AgentsConfig } from '@/agents/config';
import {
  askJev,
  isJevConfigured,
  type JevChoiceQuestion,
  type JevFailure,
  type JevNoulQuestion,
} from '@/services/queryIntent/jevClient';
import {
  logJevComparison,
  logJevDecision,
  logJevNoAnswer,
} from '@/services/queryIntent/jevShadowLog';
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
 * Where the data goes: the parser's input — messages from DMs and private channels
 * included — is sent to JEV_URL, which is TypeSafe's hosted Jev unless the env points
 * elsewhere.
 *
 * Jev's yes/no answers are probabilities, so every decision below is a threshold on one.
 * The thresholds come from CAC (radar_jev_window_skip_threshold,
 * radar_jev_reaction_completion_threshold, radar_jev_reaction_item_threshold), like
 * ticket_duplicate_jev_threshold, so they can be tuned against the logs without a deploy.
 * They are only valid for the JEV_MODEL they were tuned on.
 */

interface Thresholds {
  /** A window Jev rates at or below this is skipped without a parse. Deliberately low: a
   *  skipped real ask is never tracked, while an unneeded parse only costs a call. */
  windowSkip: number;
  /** The reaction's emoji must assert completion at least this strongly… */
  reactionCompletion: number;
  /** …and one item must be this clearly the one settled. Above 0.5, no other item can
   *  tie, which is the parser's rule: two items fitting equally well settle neither. */
  reactionItem: number;
}

/** AgentsConfig.fetch falls back to the defaults rather than throwing. */
const readThresholds = async (): Promise<Thresholds> => {
  const cac = await AgentsConfig.fetch();
  return {
    windowSkip: cac.radarJevWindowSkipThreshold,
    reactionCompletion: cac.radarJevReactionCompletionThreshold,
    reactionItem: cac.radarJevReactionItemThreshold,
  };
};

const JEV_TIMEOUT_MS = 8_000;

/** The option standing for "this reaction settles nothing". Not a possible item id. */
const NONE = 'none';

const SHADOW_TAG = '[RADAR][SHADOW]';
const REPLACE_TAG = '[RADAR][REPLACE]';

/** RUN is on and Jev has a key. JEV_URL / JEV_MODEL always have values (TypeSafe's by default). */
const isRadarJevActive = (): boolean => config.radar.jev.enabled && isJevConfigured();

// ─── Window: is anything trackable? ─────────────────────────────────────────────

type WindowCheck =
  | { ok: true; probability: number; skip: boolean }
  | { ok: false; reason?: string; failure?: JevFailure };

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
async function checkWindow(input: ParserInput, thresholds: Thresholds): Promise<WindowCheck> {
  try {
    let failure: JevFailure | undefined;
    const answers = await askJev({ ...input }, { trackable: WINDOW_QUESTION }, JEV_TIMEOUT_MS, undefined, {
      onFailure: f => {
        failure = f;
      },
    });
    const answer = answers?.trackable;
    if (!answer || answer.type !== 'noul') return { ok: false, failure };
    return {
      ok: true,
      probability: answer.noul,
      skip: answer.noul <= thresholds.windowSkip,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : 'unknown' };
  }
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
  | { ok: false; reason?: string; failure?: JevFailure };

/**
 * Never throws. `input` is exactly what the parser is sent for this reaction pass: the
 * reacted message as the one entry in new_messages, the items the reactor is party to,
 * and who reacted with what.
 */
async function checkReaction(input: ParserInput, thresholds: Thresholds): Promise<ReactionCheck> {
  try {
    const message = input.new_messages[0];
    const emoji = input.reaction?.emoji;
    if (!message || !emoji) return { ok: false, reason: 'not a reaction pass' };
    const items = input.open_items;
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
      return { ok: false, failure };
    }
    // A choice with no probability for what it chose cannot be held to the threshold.
    // Scoring it 0 would quietly resolve nothing in replace mode; failing hands the
    // reaction to the parser instead.
    if (!Object.prototype.hasOwnProperty.call(s.probabilities, s.choice)) {
      return { ok: false, reason: 'unusable' };
    }

    const itemProbability = s.probabilities[s.choice];
    const resolves =
      c.noul >= thresholds.reactionCompletion &&
      s.choice !== NONE &&
      itemProbability >= thresholds.reactionItem;
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

interface LogContext {
  meta: Record<string, unknown> & { conversationId: string };
  /** Size of what Jev was sent, for the log. */
  stateChars: number;
}

const noAnswer = (
  tag: string,
  ctx: LogContext,
  check: { reason?: string; failure?: JevFailure },
  categories: string[],
  level: 'info' | 'warn',
  note?: string,
): void =>
  logJevNoAnswer(tag, ctx.meta.conversationId, {
    failure: check.failure,
    reason: check.reason,
    timeoutMs: JEV_TIMEOUT_MS,
    stateChars: ctx.stateChars,
    categories,
    meta: ctx.meta,
    level,
    note,
  });

/**
 * Window: did the parser find work (primary) and would Jev have let it through (shadow)?
 * `trackable yes != no (0.05)` is the one that matters — a real ask replace mode would drop.
 */
function logWindow(tag: string, ctx: LogContext, check: WindowCheck & { ok: true }, llm: ParsedTransitions): void {
  const found = llm.operations.length > 0;
  const verdict = !check.skip ? 'kept' : found ? 'WOULD-MISS' : 'would-skip';
  logJevComparison(tag, ctx.meta.conversationId, {
    primaryModel: config.radar.parserModel,
    shadowModel: config.jev.model,
    stateChars: ctx.stateChars,
    comparison: [
      {
        category: 'trackable',
        primary: [found ? 'yes' : 'no'],
        shadow: check.skip ? 'no' : 'yes',
        confidence: check.probability,
        agreed: found === !check.skip,
      },
    ],
    meta: {
      ...ctx.meta,
      verdict,
      parserOps: llm.operations.map(op => ({ op: op.op, itemId: op.itemId, sourceMessageId: op.sourceMessageId })),
    },
    note: `→ ${verdict}  parser ${llm.operations.length} op(s)` +
      (found ? ` [${llm.operations.map(op => op.op).join(',')}]` : ''),
  });
}

/** Reaction: which item the parser resolved (primary) and which Jev would (shadow). */
function logReaction(tag: string, ctx: LogContext, check: ReactionCheck & { ok: true }, llm: ParsedTransitions): void {
  const parserResolved = resolvedIds(llm);
  const jevResolved = check.operations.map(op => op.itemId as string);
  logJevComparison(tag, ctx.meta.conversationId, {
    primaryModel: config.radar.parserModel,
    shadowModel: config.jev.model,
    stateChars: ctx.stateChars,
    comparison: [
      {
        category: 'resolves',
        primary: parserResolved,
        shadow: jevResolved[0] ?? NONE,
        confidence: check.itemProbability,
        agreed:
          parserResolved.length === jevResolved.length &&
          parserResolved.every(id => jevResolved.includes(id)),
      },
    ],
    meta: { ...ctx.meta, completion: check.completion, jevChoice: check.itemId },
    note: `completion ${check.completion.toFixed(2)}`,
  });
}

// ─── Entry point: the step right before the model ───────────────────────────────

/**
 * Jev's part of one parse, per RADAR_JEV_*. Null when Jev is off, and the caller calls the
 * model as it always has. A reaction pass is the one carrying `input.reaction`.
 *
 *  - shadow (replace off): Jev runs alongside the model and is only logged — started here,
 *    not awaited, so it costs the parse no time.
 *  - replace: Jev is awaited. A window it rates as chatter comes back as an empty answer,
 *    which is what the model returns for chatter; a reaction comes back resolved or not.
 *    When Jev has no answer, or the window may hold something, the model runs as usual.
 *
 * Every call is logged (with RADAR_JEV_LOG_ENABLED): the comparison when both ran, Jev's
 * decision when it replaced the model, and NO ANSWER when it gave none. A fallback to the
 * parser is logged as a warning either way.
 */
export async function runJevBeforeLlm(
  input: ParserInput,
  conversationId: string,
): Promise<JevBeforeLlm | null> {
  if (!isRadarJevActive()) return null;
  const { replace, logEnabled } = config.radar.jev;
  const stateChars = JSON.stringify(input).length;
  // The CAC read is part of Jev's work, so in shadow mode it too runs off the parser's path.
  const thresholdsRead = readThresholds();

  if (input.reaction) {
    const emoji = input.reaction.emoji;
    // Every line records the thresholds that produced it, so the logs can be re-read
    // against other values when tuning.
    const contextFor = (thresholds: Thresholds): LogContext => ({
      meta: { conversationId, pass: 'reaction', emoji, candidates: input.open_items.length, thresholds },
      stateChars,
    });
    const categories = ['completion', 'settles'];
    const pending = thresholdsRead.then(async thresholds => ({
      ctx: contextFor(thresholds),
      check: await checkReaction(input, thresholds),
    }));
    if (!replace) {
      return {
        answer: null,
        afterLlm: llm => {
          if (!logEnabled) return;
          void pending.then(({ ctx, check }) =>
            check.ok
              ? logReaction(SHADOW_TAG, ctx, check, llm)
              : noAnswer(SHADOW_TAG, ctx, check, categories, 'info'),
          );
        },
      };
    }
    const { ctx, check } = await pending;
    if (check.ok) {
      if (logEnabled) {
        logJevDecision(REPLACE_TAG, conversationId, {
          shadowModel: config.jev.model,
          stateChars,
          decisions: [
            {
              category: 'resolves',
              shadow: check.operations[0]?.itemId ?? NONE,
              confidence: check.itemProbability,
            },
          ],
          meta: { ...ctx.meta, completion: check.completion, jevChoice: check.itemId },
          note: `completion ${check.completion.toFixed(2)}`,
        });
      }
      return {
        answer: { operations: check.operations, assessment: check.assessment, decidedBy: 'jev' },
        afterLlm: () => {},
      };
    }
    // Logged whatever the log switch says: that switch hides comparisons, not breakage.
    noAnswer(REPLACE_TAG, ctx, check, categories, 'warn', '→ falling back to the parser');
    return { answer: null, afterLlm: () => {} };
  }

  const contextFor = (thresholds: Thresholds): LogContext => ({
    meta: { conversationId, pass: 'window', windowSize: input.new_messages.length, thresholds },
    stateChars,
  });
  const categories = ['trackable'];
  const pending = thresholdsRead.then(async thresholds => ({
    ctx: contextFor(thresholds),
    check: await checkWindow(input, thresholds),
  }));
  if (!replace) {
    return {
      answer: null,
      afterLlm: llm => {
        if (!logEnabled) return;
        void pending.then(({ ctx, check }) =>
          check.ok ? logWindow(SHADOW_TAG, ctx, check, llm) : noAnswer(SHADOW_TAG, ctx, check, categories, 'info'),
        );
      },
    };
  }
  const { ctx, check } = await pending;
  if (check.ok && check.skip) {
    if (logEnabled) {
      logJevDecision(REPLACE_TAG, conversationId, {
        shadowModel: config.jev.model,
        stateChars,
        decisions: [{ category: 'trackable', shadow: 'no', confidence: check.probability }],
        meta: ctx.meta,
        note: '→ parse skipped',
      });
    }
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
    noAnswer(REPLACE_TAG, ctx, check, categories, 'warn', '→ falling back to the parser');
    return { answer: null, afterLlm: () => {} };
  }
  // Jev let the window through: the parser runs, and the two are compared.
  return {
    answer: null,
    afterLlm: llm => {
      if (logEnabled) logWindow(REPLACE_TAG, ctx, check, llm);
    },
  };
}
