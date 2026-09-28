import { logger } from '@/utils/logger';
import { config as envConfig } from '@/config/env';
import { AgentsConfig } from '@/agents/config';
import {
  askJev,
  isJevConfigured,
  type JevChoiceQuestion,
  type JevFailure,
} from '@/services/queryIntent/jevClient';
import type { CategoryConfig, GeneratedTag } from '../types';

/**
 * Asks Jev the same tag categories the LLM was just asked and logs both answers side
 * by side, so a candidate model can be compared against the live one on real traffic.
 *
 * Inert by construction: returns void, persists nothing, is never awaited. Its result
 * cannot reach replaceTagsForCategories, upsertConfig, Vespa or the tagGenerated event.
 *
 * Two independent CAC gates, both default false:
 *   shadow_tag_generation_enabled      — whether the Jev call happens
 *   shadow_tag_generation_log_enabled  — whether its answers are logged
 *
 * Endpoint, key and model all come from the existing JEV_* env via jevClient, so the
 * model is whatever JEV_MODEL is — shared with queryIntent/radar/relatedContext and not
 * pinnable here without changing that client.
 */

// Jev answers a warm batch in ~200ms, but the worker's first call also pays DNS, TLS
// and connection setup. Generous because nothing waits on this: the job has already
// moved on, so a long ceiling costs only a background socket.
const SHADOW_TIMEOUT_MS = 30_000;

/**
 * A `choice` question per LLM category with a fixed tag list. Jev's `criteria` wants a
 * description per option but CategoryConfig only has the names, so each option
 * describes itself and the category prompt becomes `instructions` — Jev is working
 * from less guidance than the LLM, which matters when reading the comparison.
 */
function buildQuestions(
  categories: Record<string, CategoryConfig>,
): Record<string, JevChoiceQuestion> {
  const questions: Record<string, JevChoiceQuestion> = {};

  for (const [name, category] of Object.entries(categories)) {
    const options = category.tags ?? [];
    // Nothing to choose between without a fixed vocabulary of at least two options.
    if (category.method !== 'llm' || options.length < 2) continue;

    questions[name] = {
      type: 'choice',
      instructions: category.prompt ?? `Pick the ${name} that best fits.`,
      criteria: Object.fromEntries(options.map((tag) => [tag, tag])),
    };
  }

  return questions;
}

export async function runShadowTagGeneration(
  context: string,
  categories: Record<string, CategoryConfig>,
  primary: GeneratedTag[],
  meta: { jobId: string; sourceId: string; sourceType: string },
): Promise<void> {
  try {
    // Sync and free, so an instance with no Jev key never reaches the CAC fetch.
    if (!isJevConfigured()) return;

    const cacConfig = await AgentsConfig.fetch();
    if (!cacConfig.shadowTagGenerationEnabled) return;
    const shouldLog = cacConfig.shadowTagGenerationLogEnabled;

    const questions = buildQuestions(categories);
    if (Object.keys(questions).length === 0) return;

    // partial: one unusable answer must not discard the rest of the batch.
    // onFailure: askJev collapses timeout / HTTP status / network / unusable into a
    // plain null, and logs the detail under its own 'Jev request failed' prefix.
    // Capturing the kind here keeps the cause on the same line as the email it
    // belongs to, instead of leaving two unrelated log lines to be correlated.
    let failure: JevFailure | undefined;
    const answers = await askJev(context, questions, SHADOW_TIMEOUT_MS, undefined, {
      partial: true,
      onFailure: (f) => {
        failure = f;
      },
    });

    if (!shouldLog) return;

    if (!answers) {
      const reason =
        failure?.kind === 'status' ? `status ${failure.status}` : (failure?.kind ?? 'unknown');
      logger.info(
        `[TAG][SHADOW] ${meta.sourceId}  NO ANSWER (${reason})  ` +
          `[${context.length} chars, ${SHADOW_TIMEOUT_MS}ms limit]`,
        {
          ...meta,
          reason: failure?.kind ?? 'unknown',
          ...(failure?.kind === 'status' ? { status: failure.status } : {}),
          timeoutMs: SHADOW_TIMEOUT_MS,
          stateChars: context.length,
          categories: Object.keys(questions),
        },
      );
      return;
    }

    // A category may carry several tags (count > 1), so collect rather than overwrite —
    // keying by last-wins would silently misreport agreement on multi-tag categories.
    const primaryByCategory: Record<string, string[]> = {};
    for (const tag of primary) (primaryByCategory[tag.category] ??= []).push(tag.tag);

    // buildQuestions only asks `choice`, so the non-choice branch is unreachable;
    // flatMap narrows the answer union once rather than guarding every field.
    const comparison = Object.entries(answers).flatMap(([category, answer]) => {
      if (answer.type !== 'choice') return [];
      const primaryTags = primaryByCategory[category] ?? [];
      return [
        {
          category,
          primary: primaryTags,
          shadow: answer.choice,
          confidence: answer.confidence,
          agreed: primaryTags.includes(answer.choice),
        },
      ];
    });

    // Both model names, because a comparison is meaningless without knowing what was
    // compared, and both are runtime config that can change between two log lines.
    const primaryModel = cacConfig.tagGenerationModelName;
    const shadowModel = envConfig.jev.model || 'jev-1.13.0 (jevClient default)';
    const agreedCount = comparison.filter((c) => c.agreed).length;

    // The message is written to be read by a human scanning the worker output:
    //   priority  low == low (0.35)
    // '==' agree, '!=' differ, the number is Jev's confidence in its own pick.
    const perCategory = comparison
      .map((c) => {
        const primaryText = c.primary.length > 0 ? c.primary.join('/') : '(none)';
        const confidenceText = c.confidence === undefined ? 'n/a' : c.confidence.toFixed(2);
        return `${c.category} ${primaryText} ${c.agreed ? '==' : '!='} ${c.shadow} (${confidenceText})`;
      })
      .join('  |  ');

    // sourceId is the Email.id — the key to look a comparison up by. Deliberately not
    // called emailId: the logger injects its own `emailId` meaning the user's address.
    // The structured fields are kept for querying; the message carries the same facts
    // in a form you can read without parsing JSON.
    logger.info(
      `[TAG][SHADOW] ${meta.sourceId}  ${agreedCount}/${comparison.length} agree  ` +
        `[${primaryModel} vs ${shadowModel}]  ${perCategory}`,
      {
        ...meta,
        primaryModel,
        shadowModel,
        agreedCount,
        totalCount: comparison.length,
        // `context` is a whole uncapped thread while every other askJev caller passes
        // something short — worth seeing when a call is slow or a result looks odd.
        stateChars: context.length,
        comparison,
      },
    );
  } catch (error) {
    // Logged regardless of shouldLog: that gate hides comparisons, not breakage.
    logger.warn('[TAG][SHADOW] Shadow run failed', {
      ...meta,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}
