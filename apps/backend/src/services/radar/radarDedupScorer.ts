import { config } from '@/config/env';
import type { ParserOpenItem, ParserOperation } from '@/services/radar/radarParser';
import {
  askJevNouls,
  isJevConfigured,
  type JevNoulQuestion,
} from '@/services/queryIntent/jevClient';


/**
 * Worded so the scorer judges the WORK, not the people: the parser's own
 * duplicate rules say a re-ask to fewer people, or in new words, is the same
 * item. Calibrated against a labelled set — keep the wording and threshold
 * together when changing either.
 */
const SAME_WORK_INSTRUCTIONS =
  'Is the new candidate asking for the same piece of work as the open item? ' +
  'Ignore wording differences and who is asked; a follow-up nudge or re-ask of the ' +
  'same thing counts as the same. A different subject, a different object (e.g. a ' +
  'different PR) or an additional question counts as different.';

/** Jev's verdict on one create: the open item it matched best, and how well. */
export interface DedupCheck {
  create: ParserOperation;
  /** Null when Jev gave no answer — the create is kept unscored. */
  item: ParserOpenItem | null;
  /** Jev's probability that the create asks for the item's work. */
  probability: number | null;
  /** At or above the threshold: the parser is sent back over this create. */
  flagged: boolean;
}

/** A flagged check — always scored. */
export type DuplicateMatch = DedupCheck & { item: ParserOpenItem; probability: number };

export const isDuplicate = (check: DedupCheck): check is DuplicateMatch => check.flagged;

const quoteAsk = (title: string, context: string | null | undefined): string =>
  context ? `"${title}" (${context})` : `"${title}"`;

/**
 * Scores the parser's creates against the thread's open items with Jev. The
 * flagged ones are a second opinion, not a gate: the caller hands them back to
 * the parser, which decides. Every verdict is returned, flagged or not, so the
 * debug trail can show what Jev thought of each create.
 *
 * Jev never throws and answers null on any failure, and a create it cannot
 * score is kept — a missing duplicate check must never cost a window its parse.
 */
class RadarDedupScorer {
  /**
   * Radar text includes DMs and private channels, so it only goes to a Jev that
   * was pointed at explicitly — never the public default endpoint — and only on
   * a named model, since the threshold is tuned per model.
   */
  isActive(): boolean {
    return (
      config.radar.dedupEnabled && isJevConfigured() && !!config.jev.url && !!config.jev.model
    );
  }

  async scoreCreates(
    operations: ParserOperation[],
    openItems: ParserOpenItem[],
  ): Promise<DedupCheck[]> {
    if (!this.isActive()) return [];

    // An item this same response resolves is being superseded on purpose;
    // a create that resembles it is the replacement, not a duplicate.
    const resolved = new Set(
      operations.filter(op => op.op === 'resolve' && op.itemId).map(op => op.itemId),
    );
    const candidates = openItems.filter(i => !resolved.has(i.id));
    // A create the same response resolves through its tempId was raised and
    // settled in this window. Dropping it as a duplicate would strand that
    // resolve, and the open item it resembles would stay open.
    const creates = operations.filter(
      op => op.op === 'create' && op.title?.trim() && !(op.tempId && resolved.has(op.tempId)),
    );
    if (creates.length === 0 || candidates.length === 0) return [];

    return Promise.all(creates.map(create => this.check(create, candidates)));
  }

  /** One Jev call per create: every open item is its own question in the batch. */
  private async check(create: ParserOperation, items: ParserOpenItem[]): Promise<DedupCheck> {
    const questions = Object.fromEntries(
      items.map((item, i): [string, JevNoulQuestion] => [
        `i${i}`,
        {
          type: 'noul',
          instructions: `Open item: ${quoteAsk(item.title, item.context)}\n${SAME_WORK_INSTRUCTIONS}`,
          criteria: { true: 'same work (duplicate)', false: 'different work' },
        },
      ]),
    );
    const state =
      'A workplace chat tracks open asks (who must do what).\n' +
      `New candidate ask: ${quoteAsk(create.title as string, create.contextSummary)}`;

    const answers = await askJevNouls(state, questions, config.radar.dedupTimeoutMs);
    if (!answers) return { create, item: null, probability: null, flagged: false };

    let best = 0;
    items.forEach((_, i) => {
      if (answers[`i${i}`] > answers[`i${best}`]) best = i;
    });
    const probability = answers[`i${best}`];
    const flagged = probability >= config.radar.dedupThreshold;
    return { create, item: items[best], probability, flagged };
  }
}

/**
 * What the create becomes if it is the item. Nobody new: nothing at all — a
 * nudge to some of the same people leaves the others on the hook too. Anyone
 * new: they are added, and nobody already on it is dropped. A message cannot
 * be told apart here as "also look at this" or "take this over", and dropping
 * someone by mistake silently takes the item off their list; a real handoff is
 * still the parser's to make with its own reassign. Spelled out as an operation
 * because a general "re-apply the rules" was ignored far more often than a
 * concrete replacement.
 */
const replacementFor = ({ create, item }: DuplicateMatch): string => {
  const current = item.pending_on;
  const added = [...new Set(create.pendingOn ?? [])].filter(id => !current.includes(id));
  if (added.length === 0) {
    return `drop it — ${item.id} is already pending on ${JSON.stringify(current)}, so nothing changes`;
  }
  return (
    `replace it with {"op":"reassign","itemId":"${item.id}",` +
    `"pendingOn":${JSON.stringify([...current, ...added])},` +
    `"sourceMessageId":"${create.sourceMessageId}"} — they join those already on it`
  );
};

/**
 * The message that sends a batch of likely duplicates back to the parser.
 * Null when there is nothing to send.
 */
export function duplicateCreateFeedback(matches: DuplicateMatch[]): string | null {
  if (matches.length === 0) return null;
  const lines = matches.map(
    match =>
      `- create "${match.create.title}" (sourceMessageId ${match.create.sourceMessageId}) matches ` +
      `open item ${match.item.id} "${match.item.title}" (duplicate score ` +
      `${match.probability.toFixed(2)}). If it is the same work: ${replacementFor(match)}.`,
  );
  return [
    'A duplicate checker flagged these creates as asks that open items already cover:',
    ...lines,
    'Same work means the same deliverable, however it is worded, whoever asks, and whoever ' +
      'it is now put to — a re-ask, a nudge, a restatement with more detail, or a handoff ' +
      'is NOT a new item. Keep a create only if the WORK itself differs (a different ' +
      'object, a different deliverable, an additional question), and then its reason must ' +
      'name that difference. Keep every other operation as it was.',
  ].join('\n');
}

export const radarDedupScorer = new RadarDedupScorer();
