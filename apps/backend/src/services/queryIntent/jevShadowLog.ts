import { logger } from '@/utils/logger';
import type { JevFailure } from '@/services/queryIntent/jevClient';

/**
 * The one log format for every place Jev runs beside an LLM — desk tags, message tagging,
 * Radar — so a single log query reads all of them and they can be compared the same way:
 *
 *   [TAG][SHADOW] <id>  1/2 agree  [kimi-latest vs jev-latest]  priority low == low (0.94)  |  sentiment positive != neutral (0.45)
 *
 * Every line carries names, ids and scores only — never the text Jev was sent, which can
 * come from DMs and private channels.
 */

/** One question, both answers. Callers may add their own fields; they land in the log. */
export interface JevComparison {
  category: string;
  /** What the live model answered; empty when it answered nothing. */
  primary: string[];
  /** What Jev answered. */
  shadow: string;
  /** Jev's confidence in `shadow`, when it gave one. */
  confidence?: number;
  agreed: boolean;
}

/** One question, Jev's answer alone — replace mode, where the live model never ran. */
export interface JevDecision {
  category: string;
  shadow: string;
  confidence?: number;
}

export const describeJevFailure = (failure: JevFailure | undefined): string =>
  failure?.kind === 'status' ? `status ${failure.status}` : (failure?.kind ?? 'unknown');

const confidenceText = (confidence: number | undefined): string =>
  confidence === undefined ? 'n/a' : confidence.toFixed(2);

const withNote = (line: string, note: string | undefined): string =>
  note ? `${line}  ${note}` : line;

/** Both answers side by side. Reads as: priority low == low (0.35) — '==' agree, '!=' differ. */
export function logJevComparison(
  tag: string,
  id: string,
  fields: {
    primaryModel: string;
    shadowModel: string;
    stateChars: number;
    comparison: JevComparison[];
    meta: Record<string, unknown>;
    note?: string;
  },
): void {
  const { primaryModel, shadowModel, stateChars, comparison, meta, note } = fields;
  const agreedCount = comparison.filter(c => c.agreed).length;
  const perCategory = comparison
    .map(c => {
      const primaryText = c.primary.length > 0 ? c.primary.join('/') : '(none)';
      return `${c.category} ${primaryText} ${c.agreed ? '==' : '!='} ${c.shadow} (${confidenceText(c.confidence)})`;
    })
    .join('  |  ');

  logger.info(
    withNote(
      `${tag} ${id}  ${agreedCount}/${comparison.length} agree  ` +
        `[${primaryModel} vs ${shadowModel}]  ${perCategory}`,
      note,
    ),
    {
      ...meta,
      primaryModel,
      shadowModel,
      agreedCount,
      totalCount: comparison.length,
      stateChars,
      comparison,
    },
  );
}

/** Jev's answer alone, when it decided in the live model's place. */
export function logJevDecision(
  tag: string,
  id: string,
  fields: {
    shadowModel: string;
    stateChars: number;
    decisions: JevDecision[];
    meta: Record<string, unknown>;
    note?: string;
  },
): void {
  const { shadowModel, stateChars, decisions, meta, note } = fields;
  const perCategory = decisions
    .map(d => `${d.category} ${d.shadow} (${confidenceText(d.confidence)})`)
    .join('  |  ');

  logger.info(withNote(`${tag} ${id}  jev decided  [${shadowModel}]  ${perCategory}`, note), {
    ...meta,
    shadowModel,
    stateChars,
    decisions,
  });
}

/**
 * Jev gave no usable answer. `reason` overrides the text when the caller knows more than
 * the transport failure (e.g. which batch, or how many answers were unusable).
 */
export function logJevNoAnswer(
  tag: string,
  id: string,
  fields: {
    failure?: JevFailure;
    reason?: string;
    timeoutMs: number;
    stateChars: number;
    categories: string[];
    meta: Record<string, unknown>;
    level?: 'info' | 'warn';
    note?: string;
  },
): void {
  const { failure, reason, timeoutMs, stateChars, categories, meta, level = 'info', note } = fields;
  logger[level](
    withNote(
      `${tag} ${id}  NO ANSWER (${reason ?? describeJevFailure(failure)})  ` +
        `[${stateChars} chars, ${timeoutMs}ms limit]`,
      note,
    ),
    {
      ...meta,
      reason: failure?.kind ?? reason ?? 'unknown',
      ...(failure?.kind === 'status' ? { status: failure.status } : {}),
      timeoutMs,
      stateChars,
      categories,
    },
  );
}
