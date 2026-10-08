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
 * by side, to compare a candidate model against the live one on real traffic.
 *
 * Logs and drops the result — it is never persisted and never awaited.
 *
 * Gated by CAC `shadow_tag_generation_enabled` (whether the call happens) and
 * `shadow_tag_generation_log_enabled` (whether answers are logged), both default false.
 */

const SHADOW_TIMEOUT_MS = 30_000;

/**
 * Jev's `criteria` wants a description per option, but CategoryConfig only carries the
 * names, so each option describes itself — Jev works from less guidance than the LLM.
 */
function buildQuestions(
  categories: Record<string, CategoryConfig>,
): Record<string, JevChoiceQuestion> {
  const questions: Record<string, JevChoiceQuestion> = {};

  for (const [name, category] of Object.entries(categories)) {
    const options = category.tags ?? [];
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
    if (!isJevConfigured()) return;

    const cacConfig = await AgentsConfig.fetch();
    if (!cacConfig.shadowTagGenerationEnabled) return;
    const shouldLog = cacConfig.shadowTagGenerationLogEnabled;

    const questions = buildQuestions(categories);
    if (Object.keys(questions).length === 0) return;

    // askJev collapses every failure into a plain null; onFailure recovers the cause.
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

    // A category may hold several tags (count > 1), so collect rather than overwrite.
    const primaryByCategory: Record<string, string[]> = {};
    for (const tag of primary) (primaryByCategory[tag.category] ??= []).push(tag.tag);

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

    const primaryModel = cacConfig.tagGenerationModelName;
    const shadowModel = envConfig.jev.model;
    const agreedCount = comparison.filter((c) => c.agreed).length;

    // Reads as: priority low == low (0.35) — '==' agree, '!=' differ, Jev's confidence.
    const perCategory = comparison
      .map((c) => {
        const primaryText = c.primary.length > 0 ? c.primary.join('/') : '(none)';
        const confidenceText = c.confidence === undefined ? 'n/a' : c.confidence.toFixed(2);
        return `${c.category} ${primaryText} ${c.agreed ? '==' : '!='} ${c.shadow} (${confidenceText})`;
      })
      .join('  |  ');

    // Not named emailId: the logger injects its own `emailId` meaning the user's address.
    logger.info(
      `[TAG][SHADOW] ${meta.sourceId}  ${agreedCount}/${comparison.length} agree  ` +
        `[${primaryModel} vs ${shadowModel}]  ${perCategory}`,
      {
        ...meta,
        primaryModel,
        shadowModel,
        agreedCount,
        totalCount: comparison.length,
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
