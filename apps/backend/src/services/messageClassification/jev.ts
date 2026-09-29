import type { ThreadTypeEntry } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import {
  askJev,
  isJevConfigured,
  type JevAnswer,
  type JevChoiceQuestion,
  type JevFailure,
  type JevNoulQuestion,
} from '@/services/queryIntent/jevClient';
import type { Classification, ClassifierInput } from './index';

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
 * Thresholds are tuned per JEV_MODEL — re-tune them against the shadow logs when it changes.
 */

/** A type at or above this probability applies to the thread. */
const THREAD_TYPE_THRESHOLD = 0.5;

/** A message at or above this probability is evidence for a type. */
const CITATION_THRESHOLD = 0.3;

/** Per call. Classification runs in a background worker, so this can be generous. */
const JEV_TIMEOUT_MS = 15_000;

/** Each option carries its message's text, so a pasted log dump is cut to this. */
const OPTION_TEXT_CHARS = 400;

/** Citations kept per type — the same cap the LLM is given (MAX_SOURCES_PER_TYPE). */
const MAX_SOURCES_PER_TYPE = 3;

const TAG = '[MSG-TAG][JEV]';

/**
 * Thread text includes DMs and private channels, so it only goes to a Jev that was pointed
 * at explicitly — never the default public endpoint — and only on a named model, since the
 * thresholds above are tuned per model. Same rule as the Radar duplicate check.
 */
const isJevClassificationActive = (): boolean =>
  config.messageClassification.jev.enabled &&
  isJevConfigured() &&
  !!config.jev.url &&
  !!config.jev.model;

type JevClassificationResult =
  | {
      ok: true;
      classification: Classification;
      /** Jev's probability for every type it was asked about, for the log. */
      typeScores: Record<string, number>;
    }
  | { ok: false; reason: string };

const SCOPE =
  'Classify the chat thread in `thread_messages`. `ticket`, when present, was written ' +
  'deliberately and states the thread\'s purpose. `preceding_messages`, when present, is ' +
  'earlier DM context only — it is not part of the thread. A definition phrased as ' +
  '"Done = …" is about the thread as a piece of work; any other is about whether the thread ' +
  'itself contains that answer — judge what it answers, not what it discusses.';

const failureReason = (failure: JevFailure | undefined): string =>
  failure?.kind === 'status' ? `status ${failure.status}` : (failure?.kind ?? 'unknown');

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
    if (!typeAnswers) return { ok: false, reason: `types: ${failureReason(typeFailure)}` };
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
    const passing = ranked.filter(([, p]) => p >= THREAD_TYPE_THRESHOLD);
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

    const options = Object.fromEntries(
      messages.map(m => [m.id, `${m.author_display_name}: ${m.text.slice(0, OPTION_TEXT_CHARS)}`]),
    );
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
            'message that contains the answer.',
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
      return { ok: false, reason: `evidence: ${failureReason(evidenceFailure)}` };
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
        .filter(([id, p]) => p >= CITATION_THRESHOLD && Object.prototype.hasOwnProperty.call(options, id))
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

interface LogMeta {
  conversationId: string;
  workspaceId: string;
}

/**
 * One line per thread: Jev's answer, and the LLM's beside it when both ran.
 *
 * Names, ids and scores only — never message text, which can come from DMs.
 */
function logJevClassification(
  meta: LogMeta,
  jev: JevClassificationResult,
  llm: Classification | null,
  mode: 'shadow' | 'replace',
): void {
  const jevModel = config.jev.model;
  const llmModel = config.messageClassification.model;

  if (!jev.ok) {
    logger.info(`${TAG} ${meta.conversationId}  NO ANSWER (${jev.reason})  [${mode}]`, {
      ...meta,
      mode,
      reason: jev.reason,
      jevModel,
    });
    return;
  }

  const jevTypes = jev.classification.threadTypes;
  const scores = Object.entries(jev.typeScores)
    .sort(([, a], [, b]) => b - a)
    .map(([name, p]) => `${name} ${p.toFixed(2)}`)
    .join(' · ');

  if (!llm) {
    logger.info(
      `${TAG} ${meta.conversationId}  [${mode}] jev ${jevTypes.map(t => t.name).join(',')}  (${scores})`,
      { ...meta, mode, jevModel, jev: jevTypes, typeScores: jev.typeScores },
    );
    return;
  }

  const llmByName = new Map(llm.threadTypes.map(t => [t.name, t]));
  const jevByName = new Map(jevTypes.map(t => [t.name, t]));
  const agreed = jevTypes.filter(t => llmByName.has(t.name)).map(t => t.name);
  const llmOnly = llm.threadTypes.filter(t => !jevByName.has(t.name)).map(t => t.name);
  const jevOnly = jevTypes.filter(t => !llmByName.has(t.name)).map(t => t.name);

  // For the types both chose: do they point at the same evidence? Both citing nothing
  // counts as agreeing — the type came from the ticket for both.
  const citationsAgreed = agreed.filter(name => {
    const a = llmByName.get(name)?.sourceMessageIds ?? [];
    const b = jevByName.get(name)?.sourceMessageIds ?? [];
    return a.length === 0 && b.length === 0 ? true : a.some(id => b.includes(id));
  });

  const union = new Set([...llmByName.keys(), ...jevByName.keys()]).size;
  logger.info(
    `${TAG} ${meta.conversationId}  types ${agreed.length}/${union} agree  ` +
      `citations ${citationsAgreed.length}/${agreed.length} agree  [${llmModel} vs ${jevModel}]  ` +
      `llm ${llm.threadTypes.map(t => t.name).join(',') || '(none)'} | ` +
      `jev ${jevTypes.map(t => t.name).join(',')}  (${scores})`,
    {
      ...meta,
      mode,
      llmModel,
      jevModel,
      agreed,
      llmOnly,
      jevOnly,
      citationsAgreed,
      llm: llm.threadTypes,
      jev: jevTypes,
      typeScores: jev.typeScores,
    },
  );
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

  const pending = classifyThreadWithJev(input, vocabulary);
  if (!replace) {
    return {
      answer: null,
      afterLlm: llm => {
        if (logEnabled) void pending.then(jev => logJevClassification(meta, jev, llm, 'shadow'));
      },
    };
  }

  const jev = await pending;
  if (logEnabled) logJevClassification(meta, jev, null, 'replace');
  if (jev.ok) return { answer: jev.classification, afterLlm: () => {} };
  // Logged whatever the log switch says: that switch hides comparisons, not breakage.
  logger.warn(`${TAG} Jev had no answer, falling back to the LLM`, { ...meta, reason: jev.reason });
  return { answer: null, afterLlm: () => {} };
}
