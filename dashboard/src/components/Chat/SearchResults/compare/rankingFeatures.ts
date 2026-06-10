import type { DisplaySearchResult } from '../../../../types/search';

/**
 * Ranking-feature model for the search "compare" view.
 *
 * Turns each result's debugInfo.matchfeatures + debugInfo.rankfeatures (plus the
 * top-level relevanceScore) into an ordered, grouped matrix so the UI can render
 * "which result wins each signal, and why the ranker ordered them this way".
 *
 * Nothing here calls the network — it's pure transform over data the search API
 * already returns when `includeDebugInfo: true`.
 */

export type FeatureGroup =
  | 'Final'
  | 'Lexical (BM25)'
  | 'Semantic'
  | 'Proximity'
  | 'Freshness & time'
  | 'Other';

export const GROUP_ORDER: FeatureGroup[] = [
  'Final',
  'Lexical (BM25)',
  'Semantic',
  'Proximity',
  'Freshness & time',
  'Other',
];

interface FeatureDef {
  key: string;
  label: string;
  group: FeatureGroup;
}

/** Known Vespa features in display order. Unknown keys are appended to "Other". */
const KNOWN_FEATURES: FeatureDef[] = [
  // Final — the signals that actually decide ordering
  { key: 'relevanceScore', label: 'relevanceScore', group: 'Final' },
  { key: 'combined_nativeRank', label: 'combined_nativeRank', group: 'Final' },
  { key: 'nativeRank', label: 'nativeRank', group: 'Final' },
  { key: 'final_bm25', label: 'final_bm25', group: 'Final' },
  // Lexical
  { key: 'bm25(text)', label: 'bm25(text)', group: 'Lexical (BM25)' },
  { key: 'bm25(text_fuzzy)', label: 'bm25(text_fuzzy)', group: 'Lexical (BM25)' },
  { key: 'bm25(username)', label: 'bm25(username)', group: 'Lexical (BM25)' },
  { key: 'bm25(mentions)', label: 'bm25(mentions)', group: 'Lexical (BM25)' },
  { key: 'bm25(messageChannelName)', label: 'bm25(messageChannelName)', group: 'Lexical (BM25)' },
  // Semantic
  { key: 'vector_score', label: 'vector_score', group: 'Semantic' },
  {
    key: 'closeness(field,text_embeddings)',
    label: 'closeness(text_embeddings)',
    group: 'Semantic',
  },
  // Proximity
  { key: 'proximity_text', label: 'proximity_text', group: 'Proximity' },
  { key: 'textSimilarity(text).proximity', label: 'textSimilarity.proximity', group: 'Proximity' },
  // Freshness & time
  { key: 'freshness_score', label: 'freshness_score', group: 'Freshness & time' },
  { key: 'simple_time_bonus', label: 'simple_time_bonus', group: 'Freshness & time' },
  { key: 'time_range_bonus', label: 'time_range_bonus', group: 'Freshness & time' },
  // Informational
  { key: 'query(query_length)', label: 'query(query_length)', group: 'Other' },
];

const KNOWN_BY_KEY = new Map(KNOWN_FEATURES.map(f => [f.key, f]));
const KNOWN_INDEX = new Map(KNOWN_FEATURES.map((f, i) => [f.key, i]));

/** Features excluded from the "what drove the order apart" heuristic. */
const VERDICT_IGNORE = new Set(['relevanceScore', 'query(query_length)']);

export interface FeatureRow {
  key: string;
  label: string;
  group: FeatureGroup;
  /** One value per result column (undefined = feature absent for that result). */
  values: Array<number | undefined>;
  max: number;
  /** Index of the single winning column, or -1 when tied / all-zero. */
  winnerIndex: number;
  allZero: boolean;
}

export interface FeatureSection {
  group: FeatureGroup;
  rows: FeatureRow[];
}

export function hasRankingData(r: DisplaySearchResult): boolean {
  const d = r.debugInfo;
  return !!(
    d &&
    ((d.matchfeatures && Object.keys(d.matchfeatures).length) ||
      (d.rankfeatures && Object.keys(d.rankfeatures).length))
  );
}

function readValue(r: DisplaySearchResult, key: string): number | undefined {
  if (key === 'relevanceScore') {
    return typeof r.relevanceScore === 'number' ? r.relevanceScore : undefined;
  }
  const d = r.debugInfo;
  const raw = d?.matchfeatures?.[key] ?? d?.rankfeatures?.[key];
  if (raw === undefined || raw === null) return undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Collect every feature key present across the compared results. */
function collectKeys(results: DisplaySearchResult[]): string[] {
  const keys = new Set<string>(['relevanceScore']);
  for (const r of results) {
    for (const k of Object.keys(r.debugInfo?.matchfeatures ?? {})) keys.add(k);
    for (const k of Object.keys(r.debugInfo?.rankfeatures ?? {})) keys.add(k);
  }
  return [...keys].sort((a, b) => {
    const ia = KNOWN_INDEX.has(a) ? (KNOWN_INDEX.get(a) as number) : Number.MAX_SAFE_INTEGER;
    const ib = KNOWN_INDEX.has(b) ? (KNOWN_INDEX.get(b) as number) : Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

function buildRow(results: DisplaySearchResult[], key: string): FeatureRow {
  const def = KNOWN_BY_KEY.get(key);
  const values = results.map(r => readValue(r, key));
  const defined = values.filter((v): v is number => v !== undefined);
  const max = defined.length ? Math.max(...defined) : 0;
  const min = defined.length ? Math.min(...defined) : 0;
  const allZero = max === 0 && min === 0;

  // Winner = strict single max. Tie (or all equal) → no highlight.
  let winnerIndex = -1;
  if (!allZero && max > min) {
    const winners = values.reduce<number[]>((acc, v, i) => {
      if (v === max) acc.push(i);
      return acc;
    }, []);
    if (winners.length === 1) winnerIndex = winners[0] ?? -1;
  }

  return {
    key,
    label: def?.label ?? key,
    group: def?.group ?? 'Other',
    values,
    max,
    winnerIndex,
    allZero,
  };
}

/**
 * Build the grouped feature matrix for the compared results.
 * Rows where every value is missing are dropped.
 */
export function buildFeatureSections(results: DisplaySearchResult[]): FeatureSection[] {
  if (results.length === 0) return [];
  const rows = collectKeys(results)
    .map(key => buildRow(results, key))
    .filter(row => row.values.some(v => v !== undefined));

  const byGroup = new Map<FeatureGroup, FeatureRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.group) ?? [];
    list.push(row);
    byGroup.set(row.group, list);
  }

  return GROUP_ORDER.filter(g => byGroup.has(g)).map(group => ({
    group,
    rows: byGroup.get(group) as FeatureRow[],
  }));
}

/** Format a feature value compactly: integers as-is, floats to 4 dp, trimmed. */
export function formatValue(v: number | undefined): string {
  if (v === undefined) return '—';
  if (v === 0) return '0';
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 1000) return v.toLocaleString();
  return v.toFixed(4).replace(/\.?0+$/, '');
}

/** Bar fill 0..1 for a value within its row (relative to the row max). */
export function barFraction(v: number | undefined, rowMax: number): number {
  if (v === undefined || rowMax <= 0) return 0;
  return Math.max(0, Math.min(1, v / rowMax));
}

// ── Verdict ──────────────────────────────────────────────────────────────────

interface Differentiator {
  label: string;
  a: number;
  b: number;
}

/** Features where `winner` meaningfully beats `loser`, strongest first. */
function differentiators(
  winner: DisplaySearchResult,
  loser: DisplaySearchResult,
): Differentiator[] {
  const out: Array<Differentiator & { gap: number }> = [];
  for (const f of KNOWN_FEATURES) {
    if (VERDICT_IGNORE.has(f.key)) continue;
    const a = readValue(winner, f.key);
    const b = readValue(loser, f.key);
    if (a === undefined || b === undefined) continue;
    if (a <= b) continue;
    const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
    out.push({ label: f.label, a, b, gap: (a - b) / scale });
  }
  return out.sort((x, y) => y.gap - x.gap).map(({ label, a, b }) => ({ label, a, b }));
}

const short = (s: string, n = 28): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface Verdict {
  agree: boolean | null; // true=ranker matches your pick, false=disagrees, null=no pick yet
  text: string;
}

/**
 * Explain the ordering. If the user marked "relevant" results, compare the
 * ranker's #1 against the top-ranked relevant result and surface the signals
 * that flipped the order. Otherwise summarise the biggest gap between the top two.
 */
export function buildVerdict(results: DisplaySearchResult[], relevantIds: Set<string>): Verdict {
  if (results.length < 2) return { agree: null, text: '' };

  const byScore = [...results].sort((a, b) => b.relevanceScore - a.relevanceScore);
  const top = byScore[0];
  const second = byScore[1];
  if (!top || !second) return { agree: null, text: '' };

  const relevant = byScore.filter(r => relevantIds.has(r.id));
  if (relevant.length === 0) {
    const diff = differentiators(top, second)[0];
    const text = diff
      ? `${short(top.title)} ranks above ${short(second.title)} mainly on ${diff.label} (${formatValue(diff.a)} vs ${formatValue(diff.b)}). Mark the results you consider correct to see if the ranker agrees.`
      : `Mark the results you consider correct to see whether the ranker agrees with you.`;
    return { agree: null, text };
  }

  if (relevantIds.has(top.id)) {
    return {
      agree: true,
      text: `The ranker agrees with you — your relevant pick "${short(top.title)}" is ranked #1.`,
    };
  }

  // Ranker's #1 is not one you marked relevant.
  const bestRelevant = relevant[0];
  if (!bestRelevant) return { agree: null, text: '' };
  const rank = byScore.indexOf(bestRelevant) + 1;
  const rankerWins = differentiators(top, bestRelevant)[0];
  const yourWins = differentiators(bestRelevant, top)[0];

  let text = `The ranker put "${short(top.title)}" at #1, but you marked "${short(bestRelevant.title)}" (ranked #${rank}) as relevant. `;
  if (rankerWins) {
    text += `#1 wins on ${rankerWins.label} (${formatValue(rankerWins.a)} vs ${formatValue(rankerWins.b)})`;
  }
  if (yourWins) {
    text += `${rankerWins ? '; ' : ''}your pick wins on ${yourWins.label} (${formatValue(yourWins.a)} vs ${formatValue(yourWins.b)})`;
  }
  text += rankerWins ? ` — that signal flipped the order.` : '.';

  return { agree: false, text };
}
