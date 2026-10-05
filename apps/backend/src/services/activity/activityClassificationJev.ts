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
 * Activity classification by Jev.
 *
 * The activity feed sorts message activities into ACTIONABLE / FYI (and SKIP, for DMs). That
 * used to be an LLM call driven by Langfuse prompts; it is a closed choice between two or
 * three labels, so it is one Jev choice question over the same input the LLM was sent.
 *
 * Jev answers with a probability per label, and two CAC thresholds decide what is stored:
 *  - activity_classification_jev_min_confidence — below it, Jev's pick is not trusted and the
 *    activity is filed as FYI: an unsure answer must never put work in someone's Actionable
 *    tab, and must never hide anything.
 *  - activity_classification_jev_skip_threshold — SKIP deletes the activity, so it needs more
 *    confidence than the other labels; below it the activity is filed as FYI instead.
 *
 * The thresholds are only valid for the JEV_MODEL they were tuned on.
 */

const JEV_TIMEOUT_MS = 10_000;
const TAG = '[ACTIVITY][JEV]';

type Label = 'ACTIONABLE' | 'FYI' | 'SKIP';

/**
 * What each label means. This is the classifier's whole rulebook now that the Langfuse
 * prompts are gone — keep it short and concrete, and change it with the feed's owners.
 */
const CRITERIA: Record<Label, string> = {
  ACTIONABLE:
    'the recipient is expected to do something or reply: a request or task put to them, a ' +
    'question addressed to them, a review, approval or decision they own, or a deadline that ' +
    'is theirs',
  FYI:
    'informational for the recipient, with nothing expected of them: an update, announcement ' +
    'or status, a thanks or acknowledgement, or a message addressed to others that only keeps ' +
    'them in the loop',
  SKIP:
    'not worth a notification at all: a greeting, an emoji or a one-word reply such as "ok" or ' +
    '"lol", or small talk with nothing to read or do',
};

const instructionsFor = (audience: boolean): string =>
  (audience
    ? 'A message notified the people in `recipients` (an @channel / @here / group mention). '
    : 'A message notified the user in `recipient`. ') +
  'How should this notification be filed for them? Judge it from `message` (who sent it, what ' +
  'it says, who it mentions) and `threadContext` when present — whether they personally are ' +
  'expected to act or reply, not whether the message is important in general.';

export type JevActivityResult =
  | {
      ok: true;
      classification: Label;
      /** Jev's probability for the label it picked — stored as classificationConfidence. */
      confidence: number;
      /** What Jev picked before the thresholds were applied, for the log. */
      jevChoice: Label;
      probabilities: Record<string, number>;
    }
  | { ok: false; reason: string };

const describeFailure = (failure: JevFailure | undefined): string =>
  failure?.kind === 'status' ? `status ${failure.status}` : (failure?.kind ?? 'unknown');

/**
 * Classify one notification. `input` is the JSON the LLM prompt used to be filled with.
 * Never throws: a failure comes back as `ok: false`, and the caller leaves the activity
 * PENDING so the worker retries it.
 */
export async function classifyActivityWithJev(
  input: Record<string, unknown>,
  options: { allowSkip: boolean; audience: boolean; logId: string },
): Promise<JevActivityResult> {
  if (!isJevConfigured()) return { ok: false, reason: 'jev_not_configured' };
  try {
    // AgentsConfig.fetch falls back to the defaults rather than throwing.
    const cac = await AgentsConfig.fetch();
    const labels: Label[] = options.allowSkip ? ['ACTIONABLE', 'FYI', 'SKIP'] : ['ACTIONABLE', 'FYI'];
    const question: JevChoiceQuestion = {
      type: 'choice',
      instructions: instructionsFor(options.audience),
      criteria: Object.fromEntries(labels.map(label => [label, CRITERIA[label]])),
    };

    let failure: JevFailure | undefined;
    const answers = await askJev(input, { classification: question }, JEV_TIMEOUT_MS, undefined, {
      onFailure: f => {
        failure = f;
      },
    });
    const answer = answers?.classification;
    if (!answer || answer.type !== 'choice') {
      return { ok: false, reason: describeFailure(failure) };
    }
    const jevChoice = answer.choice as Label;
    const confidence = answer.probabilities[jevChoice];
    // A pick with no probability cannot be held to the thresholds.
    if (typeof confidence !== 'number') return { ok: false, reason: 'unusable' };

    let classification: Label = jevChoice;
    if (confidence < cac.activityClassificationJevMinConfidence) classification = 'FYI';
    else if (jevChoice === 'SKIP' && confidence < cac.activityClassificationJevSkipThreshold) {
      classification = 'FYI';
    }

    if (cac.activityClassificationJevLogEnabled) {
      const scores = labels.map(label => `${label} ${(answer.probabilities[label] ?? 0).toFixed(2)}`).join(' · ');
      logger.info(
        `${TAG} ${options.logId}  jev decided  [${config.jev.model}]  classification ${classification}` +
          (classification !== jevChoice ? ` (jev picked ${jevChoice}, below threshold)` : '') +
          `  (${scores})`,
        {
          logId: options.logId,
          audience: options.audience,
          jevChoice,
          classification,
          confidence,
          probabilities: answer.probabilities,
          thresholds: {
            minConfidence: cac.activityClassificationJevMinConfidence,
            skip: cac.activityClassificationJevSkipThreshold,
          },
        },
      );
    }

    return { ok: true, classification, confidence, jevChoice, probabilities: answer.probabilities };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.name : 'unknown' };
  }
}
