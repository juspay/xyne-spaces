import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { AgentsConfig } from '@/agents/config';
import {
  askJev,
  isJevConfigured,
  type JevChoiceQuestion,
  type JevFailure,
} from '@/services/queryIntent/jevClient';

/**
 * Activity classification by XOR — the first step of XOR → LLM → the activity's fallback.
 *
 * Every activity is filed as ACTIONABLE or FYI (SKIP only for DMs, and it deletes the row).
 * That is a closed choice between two or three labels, so it is one XOR choice question.
 *
 * XOR answers with a probability per label, and two CAC thresholds decide whether that answer
 * is used. When it is not, the caller asks the LLM instead (activityClassificationLlm.ts):
 *  - activity_classification_xor_min_confidence — below it, XOR is unsure.
 *  - activity_classification_xor_skip_threshold — SKIP deletes the activity, so it needs more
 *    confidence than the other labels; below it XOR is treated as unsure.
 *
 * The thresholds are only valid for the JEV_MODEL they were tuned on.
 */

const XOR_TIMEOUT_MS = 10_000;
const TAG = '[ACTIVITY][XOR]';

export type ActivityLabel = 'ACTIONABLE' | 'FYI' | 'SKIP';

/** What is being classified: one message notification, an @channel audience, or an event. */
export type ActivityInputKind = 'message' | 'audience' | 'event';

/**
 * What each label means. XOR and the LLM fallback share this rulebook — keep it short and
 * concrete, and change it with the feed's owners.
 */
export const ACTIVITY_LABEL_CRITERIA: Record<ActivityLabel, string> = {
  ACTIONABLE:
    'the recipient is expected to do something or reply: a request or task put to them, a ' +
    'question addressed to them, a review, approval or decision they own, work assigned to ' +
    'them, a deadline that is theirs, or something that failed and needs them to fix it',
  FYI:
    'informational for the recipient, with nothing expected of them: an update, announcement ' +
    'or status change, a thanks or acknowledgement, a reaction to their own message, something ' +
    'shared with them, a job that completed, or a message addressed to others that only keeps ' +
    'them in the loop',
  SKIP:
    'not worth a notification at all: a greeting, an emoji or a one-word reply such as "ok" or ' +
    '"lol", or small talk with nothing to read or do',
};

export const activityInstructionsFor = (kind: ActivityInputKind): string => {
  if (kind === 'event') {
    return (
      'Something happened that notified the user in `recipient`: `happened` says what, ' +
      '`actor` who did it, and `subject` what it happened to. How should this ' +
      'notification be filed for them? Judge whether they personally are now expected to act, ' +
      'not whether the event is important in general.'
    );
  }
  return (
    (kind === 'audience'
      ? 'A message notified the people in `recipients` (an @channel / @here / group mention). '
      : 'A message notified the user in `recipient`. ') +
    'How should this notification be filed for them? Judge it from `message` (who sent it, what ' +
    'it says, who it mentions) and `threadContext` when present — whether they personally are ' +
    'expected to act or reply, not whether the message is important in general.'
  );
};

export type XorActivityResult =
  | {
      ok: true;
      classification: ActivityLabel;
      /** XOR's probability for the label it picked — stored as classificationConfidence. */
      confidence: number;
      probabilities: Record<string, number>;
    }
  | { ok: false; reason: string };

const describeFailure = (failure: JevFailure | undefined): string =>
  failure?.kind === 'status' ? `status ${failure.status}` : (failure?.kind ?? 'unknown');

/**
 * Classify one notification. Never throws: no answer, or an answer below the thresholds,
 * comes back as `ok: false` and the caller moves on to the LLM.
 */
export async function classifyActivityWithXor(
  input: Record<string, unknown>,
  options: { allowSkip: boolean; kind: ActivityInputKind; logId: string },
): Promise<XorActivityResult> {
  if (!isJevConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    // AgentsConfig.fetch falls back to the defaults rather than throwing.
    const cac = await AgentsConfig.fetch();
    const labels: ActivityLabel[] = options.allowSkip ? ['ACTIONABLE', 'FYI', 'SKIP'] : ['ACTIONABLE', 'FYI'];
    const question: JevChoiceQuestion = {
      type: 'choice',
      instructions: activityInstructionsFor(options.kind),
      criteria: Object.fromEntries(labels.map(label => [label, ACTIVITY_LABEL_CRITERIA[label]])),
    };

    let failure: JevFailure | undefined;
    const answers = await askJev(input, { classification: question }, XOR_TIMEOUT_MS, undefined, {
      onFailure: f => {
        failure = f;
      },
    });
    const answer = answers?.classification;
    if (!answer || answer.type !== 'choice') {
      return { ok: false, reason: describeFailure(failure) };
    }
    const choice = answer.choice as ActivityLabel;
    const confidence = answer.probabilities[choice];
    // A pick with no probability cannot be held to the thresholds.
    if (typeof confidence !== 'number') return { ok: false, reason: 'unusable' };

    const unsure =
      confidence < cac.activityClassificationXorMinConfidence ||
      (choice === 'SKIP' && confidence < cac.activityClassificationXorSkipThreshold);

    if (cac.activityClassificationXorLogEnabled) {
      const scores = labels.map(label => `${label} ${(answer.probabilities[label] ?? 0).toFixed(2)}`).join(' · ');
      logger.info(
        `${TAG} ${options.logId}  ` +
          (unsure ? `xor unsure (picked ${choice}), asking the llm` : `xor decided  classification ${choice}`) +
          `  [${config.jev.model}]  (${scores})`,
        {
          logId: options.logId,
          kind: options.kind,
          choice,
          unsure,
          confidence,
          probabilities: answer.probabilities,
          thresholds: {
            minConfidence: cac.activityClassificationXorMinConfidence,
            skip: cac.activityClassificationXorSkipThreshold,
          },
        },
      );
    }

    if (unsure) return { ok: false, reason: 'unsure' };
    return { ok: true, classification: choice, confidence, probabilities: answer.probabilities };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : 'unknown' };
  }
}
