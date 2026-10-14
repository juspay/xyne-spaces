import { stripStepTokens } from './step-tokens';
import type { MobileGuide } from './types';

/**
 * Offered on the empty-results state, mirroring the dashboard guide's
 * suggestion chips. Each one is guaranteed to hit by the catalog tests.
 */
export const GUIDE_SEARCH_SUGGESTIONS: readonly string[] = [
  'share a photo',
  'mute a channel',
  'reminder',
  'lock screen',
  'schedule',
];

export function normalizeGuideQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Field weights. Title and keywords are what a user types when they know what
 * they want; steps are the long tail ("Also send to channel").
 */
const WEIGHT_TITLE = 6;
const WEIGHT_KEYWORD = 5;
const WEIGHT_TAGLINE = 3;
const WEIGHT_FIND_IN = 2;
const WEIGHT_STEP = 1;

function scoreGuide(guide: MobileGuide, query: string): number {
  const terms = query.split(' ');
  let score = 0;

  const title = guide.title.toLowerCase();
  const tagline = guide.tagline.toLowerCase();
  const keywords = guide.keywords.map(keyword => keyword.toLowerCase());
  const findIn = guide.findIn.join(' ').toLowerCase();
  const steps = guide.steps
    .map(step => stripStepTokens(typeof step === 'string' ? step : step.text).toLowerCase())
    .join(' ');

  // Whole-phrase matches rank above scattered term matches.
  if (title.includes(query)) score += WEIGHT_TITLE * 2;
  if (keywords.some(keyword => keyword.includes(query))) score += WEIGHT_KEYWORD * 2;

  for (const term of terms) {
    if (title.includes(term)) score += WEIGHT_TITLE;
    if (keywords.some(keyword => keyword.includes(term))) score += WEIGHT_KEYWORD;
    if (tagline.includes(term)) score += WEIGHT_TAGLINE;
    if (findIn.includes(term)) score += WEIGHT_FIND_IN;
    if (steps.includes(term)) score += WEIGHT_STEP;
  }

  return score;
}

/**
 * Case-insensitive, term-based match ranked by field weight. Guides that match
 * none of the terms are dropped. Ties keep catalog order, so the launch set
 * stays on top for generic queries.
 */
export function searchGuides(guides: readonly MobileGuide[], rawQuery: string): MobileGuide[] {
  const query = normalizeGuideQuery(rawQuery);
  if (query.length === 0) return [...guides];

  return guides
    .map((guide, index) => ({ guide, index, score: scoreGuide(guide, query) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.guide);
}
