import type { ThreadTypeEntry } from '@xyne/shared';
import { config } from '@/config/env';
import { AgentsConfig } from '@/agents/config';
import {
  askJev,
  isJevConfigured,
  type JevAnswer,
  type JevChoiceQuestion,
  type JevFailure,
  type JevNoulQuestion,
} from '@/services/queryIntent/jevClient';
import {
  describeJevFailure,
  logJevComparison,
  logJevDecision,
  logJevNoAnswer,
  type JevComparison,
} from '@/services/queryIntent/jevShadowLog';
import type { Classification, ClassifierInput } from './index';
import { MAX_SOURCES_PER_TYPE } from './prompt';

/**
 * Thread-type classification with Jev instead of the LLM.
 *
 * Jev answers questions with probabilities and writes no text, so the LLM's single JSON
 * answer is rebuilt from two calls:
 *
 *  1. Thread types — one yes/no question per APPROVED vocabulary entry, worded from the
 *     entry's own description. Every type at or above the threshold applies.
 *  2. Evidence — for each type that applied, one choice question whose options are the
 *     thread's message ids. The likeliest messages become its citations, exactly what the
 *     LLM's sourceMessageIds are.
 *
 * The result has the LLM's shape, so the caller writes thread and message tags through the
 * same code whichever model answered.
 *
 * Where the data goes: the whole thread — DMs and private channels included — is sent to
 * JEV_URL, which is TypeSafe's hosted Jev unless the env points elsewhere.
 *
 * The two thresholds come from CAC (message_classification_jev_type_threshold,
 * message_classification_jev_citation_threshold), like ticket_duplicate_jev_threshold, so
 * they can be tuned against the shadow logs without a deploy. They are only valid for the
 * JEV_MODEL they were tuned on.
 */

interface Thresholds {
  /** A type at or above this probability applies to the thread. */
  type: number;
  /** A message at or above this probability is evidence for a type. */
  citation: number;
}

const readThresholds = async (): Promise<Thresholds> => {
  const cac = await AgentsConfig.fetch();
  return {
    type: cac.messageClassificationJevTypeThreshold,
    citation: cac.messageClassificationJevCitationThreshold,
  };
};

/** Per call. Classification runs in a background worker, so this can be generous. */
const JEV_TIMEOUT_MS = 15_000;

/** Each option carries its message's text, so a pasted log dump is cut to this. */
const OPTION_TEXT_CHARS = 400;

/** The evidence option meaning "no message". Message ids are uuids, so it cannot collide. */
const NO_EVIDENCE = 'none';

const SHADOW_TAG = '[MSG-TAG][SHADOW]';
const REPLACE_TAG = '[MSG-TAG][REPLACE]';

/** RUN is on and Jev has a key. JEV_URL / JEV_MODEL always have values (TypeSafe's by default). */
const isJevClassificationActive = (): boolean =>
  config.messageClassification.jev.enabled && isJevConfigured();

type JevClassificationResult =
  | {
      ok: true;
      classification: Classification;
      /** Jev's probability for every type it was asked about, for the log. */
      typeScores: Record<string, number>;
    }
  | { ok: false; reason: string; failure?: JevFailure };

const SCOPE =
  'Classify the chat thread in `thread_messages`. `ticket`, when present, was written ' +
  'deliberately and states the thread\'s purpose. `preceding_messages`, when present, is ' +
  'earlier DM context only — it is not part of the thread. A definition phrased as ' +
  '"Done = …" is about the thread as a piece of work; any other is about whether the thread ' +
  'itself contains that answer — judge what it answers, not what it discusses.';

/**
 * The keys of `questions` that did not come back as a usable answer of the type asked.
 *
 * Both batches are all-or-nothing. A classification built from part of a batch is not a
 * smaller classification but a wrong one: a type whose question went unanswered silently
 * drops out, and a type whose evidence went unanswered cites nothing — and the write path
 * reconciles every message in the thread against what comes back, so either would strip
 * tags the model had applied instead of falling back to it. askJev without `partial`
 * already returns null in that case; this re-checks it here, where the write depends on it.
 */
const unanswered = (
  questions: Record<string, JevNoulQuestion | JevChoiceQuestion>,
  answers: Record<string, JevAnswer>,
): string[] =>
  Object.entries(questions)
    .filter(([key, question]) => {
      const answer = answers[key];
      if (!answer || answer.type !== question.type) return true;
      // A choice with no probability for what it chose cannot rank citations.
      return (
        answer.type === 'choice' &&
        !Object.prototype.hasOwnProperty.call(answer.probabilities, answer.choice)
      );
    })
    .map(([key]) => key);

/** The thread as Jev's state: the same object the LLM is sent. */
const toState = (input: ClassifierInput): Record<string, unknown> => ({ ...input });

/**
 * Classify a thread with Jev. Never throws: any failure comes back as `ok: false`, and in
 * that case nothing about the thread should be written from it.
 */
async function classifyThreadWithJev(
  input: ClassifierInput,
  vocabulary: readonly ThreadTypeEntry[],
  thresholds: Thresholds,
): Promise<JevClassificationResult> {
  try {
    const state = toState(input);

    // ─── Call 1: which types apply ───────────────────────────────────────────────
    const typeQuestions = Object.fromEntries(
      vocabulary.map((entry): [string, JevNoulQuestion] => [
        entry.name,
        {
          type: 'noul',
          instructions: `${SCOPE}\n\nDoes this thread type apply?\n${entry.name} — ${entry.description}`,
          criteria: { true: `the thread is ${entry.label}`, false: `the thread is not ${entry.label}` },
        },
      ]),
    );

    let typeFailure: JevFailure | undefined;
    const typeAnswers = await askJev(state, typeQuestions, JEV_TIMEOUT_MS, undefined, {
      onFailure: failure => {
        typeFailure = failure;
      },
    });
    if (!typeAnswers) {
      return { ok: false, reason: `types: ${describeJevFailure(typeFailure)}`, failure: typeFailure };
    }
    const missingTypes = unanswered(typeQuestions, typeAnswers);
    if (missingTypes.length > 0) {
      return { ok: false, reason: `types: ${missingTypes.length} unanswered` };
    }

    const typeScores: Record<string, number> = {};
    for (const [name, answer] of Object.entries(typeAnswers)) {
      if (answer.type === 'noul') typeScores[name] = answer.noul;
    }
    const ranked = Object.entries(typeScores).sort(([, a], [, b]) => b - a);
    if (ranked.length === 0) return { ok: false, reason: 'types: no vocabulary' };

    // Never empty, as the LLM is told: when nothing clears the bar, the likeliest type
    // stands. The vocabulary's own catch-all (DISCUSSION in the standard set) is worded to
    // score highest exactly then, so no name is special-cased here.
    const passing = ranked.filter(([, p]) => p >= thresholds.type);
    const chosen = (passing.length > 0 ? passing : ranked.slice(0, 1)).map(([name]) => name);

    // ─── Call 2: which messages are the evidence ─────────────────────────────────
    // A thread opened from a ticket may have no messages at all: its types come from the
    // ticket and cite nothing, as the LLM is told to do.
    const messages = input.thread_messages;
    if (messages.length === 0) {
      return {
        ok: true,
        classification: { threadTypes: chosen.map(name => ({ name, sourceMessageIds: [] })) },
        typeScores,
      };
    }

    // "none" is always an option: Jev requires at least two, so a one-message thread would
    // otherwise be rejected outright, and it lets Jev say no message is the evidence — a
    // type that came from the ticket, which the LLM is told to cite nothing for.
    const options = {
      ...Object.fromEntries(
        messages.map(m => [m.id, `${m.author_display_name}: ${m.text.slice(0, OPTION_TEXT_CHARS)}`]),
      ),
      [NO_EVIDENCE]: 'no single message is the evidence — it comes from the ticket or the thread as a whole',
    };
    const byName = new Map(vocabulary.map(entry => [entry.name, entry]));
    const evidenceQuestions = Object.fromEntries(
      chosen.map((name): [string, JevChoiceQuestion] => [
        name,
        {
          type: 'choice',
          instructions:
            `The thread is ${name} — ${byName.get(name)?.description ?? ''}\n\n` +
            'Which message in `thread_messages` is the evidence for that? Pick the message ' +
            'that CAUSED it, not one that merely mentions the topic: for what the thread is ' +
            'for, usually the message that raised it; for what the thread teaches, the ' +
            `message that contains the answer. Answer "${NO_EVIDENCE}" when no message is.`,
          criteria: options,
        },
      ]),
    );

    let evidenceFailure: JevFailure | undefined;
    const evidenceAnswers = await askJev(state, evidenceQuestions, JEV_TIMEOUT_MS, undefined, {
      onFailure: failure => {
        evidenceFailure = failure;
      },
    });
    // Types without their evidence would clear every message tag in the thread, so a
    // failed or partial second call fails the whole answer rather than writing half of one.
    if (!evidenceAnswers) {
      return {
        ok: false,
        reason: `evidence: ${describeJevFailure(evidenceFailure)}`,
        failure: evidenceFailure,
      };
    }
    const missingEvidence = unanswered(evidenceQuestions, evidenceAnswers);
    if (missingEvidence.length > 0) {
      return { ok: false, reason: `evidence: ${missingEvidence.length} unanswered` };
    }

    const threadTypes = chosen.map(name => {
      const answer = evidenceAnswers[name];
      // Guaranteed by the check above; narrows the type.
      if (answer.type !== 'choice') return { name, sourceMessageIds: [] };
      // No message clearing the bar means the type came from the ticket or the thread as a
      // whole — cite nothing rather than guess, as the LLM is told to.
      const sourceMessageIds = Object.entries(answer.probabilities)
        .filter(
          ([id, p]) =>
            p >= thresholds.citation &&
            id !== NO_EVIDENCE &&
            Object.prototype.hasOwnProperty.call(options, id),
        )
        .sort(([, a], [, b]) => b - a)
        .slice(0, MAX_SOURCES_PER_TYPE)
        .map(([id]) => id);
      return { name, sourceMessageIds };
    });

    return { ok: true, classification: { threadTypes }, typeScores };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : 'unknown' };
  }
}

type LogMeta = {
  conversationId: string;
  workspaceId: string;
};

interface LogContext {
  meta: LogMeta & { thresholds: Thresholds };
  vocabulary: readonly ThreadTypeEntry[];
  /** Size of what Jev was sent, for the log. */
  stateChars: number;
}

/**
 * Shadow mode: every type in the vocabulary, the LLM's answer beside Jev's —
 * `ISSUE yes == yes (0.91)` — plus which messages each cited as evidence.
 */
function logComparison(tag: string, ctx: LogContext, jev: JevClassificationResult & { ok: true }, llm: Classification): void {
  const llmByName = new Map(llm.threadTypes.map(t => [t.name, t]));
  const jevByName = new Map(jev.classification.threadTypes.map(t => [t.name, t]));

  const comparison: Array<JevComparison & { primaryEvidence: string[]; shadowEvidence: string[] }> =
    ctx.vocabulary.map(({ name }) => {
      const inLlm = llmByName.has(name);
      const inJev = jevByName.has(name);
      return {
        category: name,
        primary: [inLlm ? 'yes' : 'no'],
        shadow: inJev ? 'yes' : 'no',
        confidence: jev.typeScores[name],
        agreed: inLlm === inJev,
        primaryEvidence: llmByName.get(name)?.sourceMessageIds ?? [],
        shadowEvidence: jevByName.get(name)?.sourceMessageIds ?? [],
      };
    });

  // For the types both chose: do they point at the same evidence? Both citing nothing
  // counts as agreeing — the type came from the ticket for both.
  const both = comparison.filter(c => c.primary[0] === 'yes' && c.shadow === 'yes');
  const citationsAgreed = both.filter(c =>
    c.primaryEvidence.length === 0 && c.shadowEvidence.length === 0
      ? true
      : c.primaryEvidence.some(id => c.shadowEvidence.includes(id)),
  ).length;

  logJevComparison(tag, ctx.meta.conversationId, {
    primaryModel: config.messageClassification.model,
    shadowModel: config.jev.model,
    stateChars: ctx.stateChars,
    comparison,
    meta: { ...ctx.meta, citationsAgreed, citationsCompared: both.length },
    note: `citations ${citationsAgreed}/${both.length} agree`,
  });
}

/** Replace mode: Jev's answer for every type, which is what gets written. */
function logDecision(ctx: LogContext, jev: JevClassificationResult & { ok: true }): void {
  const jevByName = new Map(jev.classification.threadTypes.map(t => [t.name, t]));
  logJevDecision(REPLACE_TAG, ctx.meta.conversationId, {
    shadowModel: config.jev.model,
    stateChars: ctx.stateChars,
    decisions: ctx.vocabulary.map(({ name }) => ({
      category: name,
      shadow: jevByName.has(name) ? 'yes' : 'no',
      confidence: jev.typeScores[name],
      evidence: jevByName.get(name)?.sourceMessageIds ?? [],
    })),
    meta: ctx.meta,
  });
}

function logNoAnswer(
  tag: string,
  ctx: LogContext,
  jev: JevClassificationResult & { ok: false },
  level: 'info' | 'warn',
  note?: string,
): void {
  logJevNoAnswer(tag, ctx.meta.conversationId, {
    failure: jev.failure,
    reason: jev.reason,
    timeoutMs: JEV_TIMEOUT_MS,
    stateChars: ctx.stateChars,
    categories: ctx.vocabulary.map(entry => entry.name),
    meta: ctx.meta,
    level,
    note,
  });
}

// ─── Entry point: the step right before the model ───────────────────────────────

export interface JevBeforeLlm {
  /** Replace mode's answer, when Jev gave one: return it instead of calling the model. */
  answer: Classification | null;
  /** Hand it the model's answer once the model has run, to log the two side by side. */
  afterLlm(llm: Classification): void;
}

/**
 * Jev's part of one classification, per MESSAGE_CLASSIFICATION_JEV_*. Null when Jev is off,
 * and the caller calls the model as it always has.
 *
 *  - shadow (replace off): Jev runs alongside the model and is only logged — started here,
 *    not awaited, so it costs the job no time.
 *  - replace: Jev is awaited and its answer is the classification. When Jev has no answer
 *    the model runs as usual, so the thread is still classified.
 */
export async function runJevBeforeLlm(
  input: ClassifierInput,
  vocabulary: readonly ThreadTypeEntry[],
  meta: LogMeta,
): Promise<JevBeforeLlm | null> {
  if (!isJevClassificationActive()) return null;
  const { replace, logEnabled } = config.messageClassification.jev;
  const stateChars = JSON.stringify(input).length;

  // The CAC read is part of Jev's work, so in shadow mode it too runs off the model's path.
  // AgentsConfig.fetch falls back to the defaults rather than throwing.
  const pending = readThresholds().then(async thresholds => ({
    thresholds,
    jev: await classifyThreadWithJev(input, vocabulary, thresholds),
  }));
  // Every line records the thresholds that produced it, so the logs can be re-read against
  // other values when tuning.
  const contextFor = (thresholds: Thresholds): LogContext => ({
    meta: { ...meta, thresholds },
    vocabulary,
    stateChars,
  });

  if (!replace) {
    return {
      answer: null,
      afterLlm: llm => {
        if (!logEnabled) return;
        void pending.then(({ thresholds, jev }) => {
          const ctx = contextFor(thresholds);
          if (jev.ok) logComparison(SHADOW_TAG, ctx, jev, llm);
          else logNoAnswer(SHADOW_TAG, ctx, jev, 'info');
        });
      },
    };
  }

  const { thresholds, jev } = await pending;
  const ctx = contextFor(thresholds);
  if (jev.ok) {
    if (logEnabled) logDecision(ctx, jev);
    return { answer: jev.classification, afterLlm: () => {} };
  }
  // Logged whatever the log switch says: that switch hides comparisons, not breakage.
  logNoAnswer(REPLACE_TAG, ctx, jev, 'warn', '→ falling back to the LLM');
  return { answer: null, afterLlm: () => {} };
}
