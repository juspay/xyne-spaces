/**
 * spaces-corpus-scan — pure YQL construction + validation.
 *
 * The probe half of the corpus-analysis method (see plan.md, Step 2): for
 * "how many X per year / is it growing" questions, top-k search is the wrong
 * machinery — the answer is a COUNT over everything that matches, bucketed by
 * time, paired with the same-bucket corpus total so shares can be computed
 * without the model doing arithmetic on a sample.
 *
 * This module is deliberately tool-free and side-effect-free so the YQL
 * shapes are unit-testable without the 5,700-line tools file. The MCP tool in
 * xyne-spaces-tools.ts calls buildCorpusScanYql() once per term (plus once
 * with no term for corpusTotals) and feeds each YQL to queryDirect(), which
 * injects the ACL + workspace guards — the builder never emits either.
 *
 * Counting invariants (each one is a documented failure mode of the naive
 * approach):
 *   • lexical only — NO nearestNeighbor. The ANN operator matches ~targetHits
 *     docs regardless of corpus size, so a hybrid totalCount is not "documents
 *     containing this term".
 *   • hits:0 + `unranked` — relevance is meaningless for a census, and the
 *     fuzzy fallback / rank thresholds would corrupt the count.
 *   • time buckets divide the ms timestamp by 1000: Vespa's time.year()
 *     expects SECONDS; feeding epoch-ms yields years like 57000.
 *   • the term query and the corpusTotals query share the identical scope
 *     conditions, so the numerator and denominator can never drift apart.
 */

import { esc } from "./vespa-direct.js";
import { resolveArea, type SearchArea } from "./vespa-search-areas.js";

export type CorpusScanBucket = "year" | "month";

export interface CorpusScanScope {
  /** Channel ids to confine the scan to (OR'd). Only valid for areas that
   *  expose a channelId filter field. */
  channels?: string[];
  /** Inclusive lower bound, dd/mm/yy or dd/mm/yyyy (IST, optional " HH:MM").
   *  Inlined as a comparison literal — queryDirect's convertDateLiteralsToMs
   *  rewrites it to epoch ms before execution. */
  after?: string;
  /** Exclusive upper bound, same format as `after`. */
  before?: string;
}

export interface CorpusScanRequest {
  searchArea: string;
  terms: string[];
  scope?: CorpusScanScope;
  bucket: CorpusScanBucket;
}

export const MAX_SCAN_TERMS = 5;

/** dd/mm/yy or dd/mm/yyyy, optional " HH:MM" / " HH:MM:SS" — the exact shape
 *  convertDateLiteralsToMs rewrites. Anything else would be compared as a raw
 *  string and silently return garbage, so we reject it here. */
const DATE_LITERAL_RE = /^\d{1,2}\/\d{1,2}\/\d{2}(?:\d{2})?(?: \d{2}:\d{2}(?::\d{2})?)?$/;

export interface ValidatedScan {
  area: SearchArea;
  areaName: string;
  terms: string[];
  scope: CorpusScanScope;
  bucket: CorpusScanBucket;
}

/** Validate a raw request. Throws with an agent-readable message on any
 *  problem — the tool surfaces it verbatim as the tool error. */
export function validateCorpusScan(req: CorpusScanRequest): ValidatedScan {
  const areaName = (req.searchArea ?? "").trim();
  const area = resolveArea(areaName);
  if (!area) throw new Error(`corpus-scan: unknown searchArea "${areaName}".`);

  // Dedupe (case-insensitively) — each term is a full corpus scan, so a
  // duplicate is pure waste.
  const seen = new Set<string>();
  const terms = (req.terms ?? [])
    .map(t => String(t).trim())
    .filter(t => {
      if (!t) return false;
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (terms.length === 0) throw new Error("corpus-scan: at least one term is required.");
  if (terms.length > MAX_SCAN_TERMS) {
    throw new Error(`corpus-scan: at most ${MAX_SCAN_TERMS} terms per call (got ${terms.length}). Each term is a full corpus scan — pick the strongest variants.`);
  }

  if (req.bucket !== "year" && req.bucket !== "month") {
    throw new Error(`corpus-scan: bucket must be "year" or "month" (got "${String(req.bucket)}").`);
  }

  const scope = req.scope ?? {};
  if (scope.channels && scope.channels.length > 0) {
    const hasChannel = area.fields.some(f => f.name === "channelId");
    if (!hasChannel) {
      throw new Error(`corpus-scan: area "${areaName}" has no channelId filter — drop scope.channels.`);
    }
  }
  for (const [key, value] of [["after", scope.after], ["before", scope.before]] as const) {
    if (value !== undefined && !DATE_LITERAL_RE.test(value)) {
      throw new Error(
        `corpus-scan: scope.${key} must be dd/mm/yy (IST, optional " HH:MM") — got "${value}".`,
      );
    }
  }

  return { area, areaName, terms, scope, bucket: req.bucket };
}

/** The grouping expression for a bucket. Timestamps are epoch MILLISECONDS in
 *  every schema (convertDateLiteralsToMs's contract; verified against
 *  vespa-core chat_message.sd, whose own rank functions divide by 1000), and
 *  Vespa's time.* functions take SECONDS — hence the /1000. The tolong() wrap
 *  matters because the field type varies per schema: chat_message's
 *  createdAtTimestamp is a DOUBLE while mail's timestamp is a long, and
 *  time.year() wants an integer input — tolong() truncates the double and is
 *  a no-op on the long. Month buckets key as yyyy*100+mm (e.g. 202403) so
 *  they sort correctly as numbers. */
export function bucketExpression(timestampField: string, bucket: CorpusScanBucket): string {
  const secs = `tolong(${timestampField} / 1000)`;
  return bucket === "year"
    ? `time.year(${secs})`
    : `time.year(${secs}) * 100 + time.monthofyear(${secs})`;
}

/**
 * Build the YQL for one scan query. `withTerm: true` produces the per-term
 * census (the caller passes the term text separately as queryDirect's @query
 * binding); `withTerm: false` produces the identical query minus the term —
 * the corpusTotals denominator.
 */
export function buildCorpusScanYql(
  scan: ValidatedScan,
  opts: { withTerm: boolean },
): string {
  const { area, scope, bucket } = scan;
  const conditions: string[] = [];

  // Lexical term match only — deliberately no nearestNeighbor (see header).
  if (opts.withTerm) conditions.push("userInput(@query)");

  // Area scoping (docType/subApp) — same baseline spaces-vespa-search uses.
  conditions.push(...area.baseConditions);

  if (scope.channels && scope.channels.length > 0) {
    const channelField = area.fields.find(f => f.name === "channelId");
    const column = channelField?.vespaField ?? "channelId";
    const ors = scope.channels.map(id => `${column} contains "${esc(id)}"`);
    conditions.push(ors.length === 1 ? ors[0]! : `(${ors.join(" or ")})`);
  }

  // Date literals inlined raw — queryDirect converts them to epoch ms. The
  // quoted form survives literals containing a time component ("01/06/26 14:30").
  const ts = area.timestampField;
  if (scope.after) conditions.push(`${ts} >= "${scope.after}"`);
  if (scope.before) conditions.push(`${ts} < "${scope.before}"`);
  if (conditions.length === 0) conditions.push("true");

  // max(200) comfortably covers year buckets (decades) and month buckets
  // (16+ years) while bounding a pathological grouping.
  const grouping = `all(group(${bucketExpression(ts, bucket)}) max(200) each(output(count())))`;

  return `select * from sources ${area.source} where ${conditions.join(" and ")} | ${grouping}`;
}

/** Parse a group value ("2024", "202403", occasionally "2024.0") back to its
 *  numeric bucket key; null for anything non-numeric so callers can skip it. */
export function parseBucketKey(groupValue: string): number | null {
  const n = Number.parseFloat(groupValue);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** The @query binding for a term. Vespa's userInput defaults to weakAnd, so a
 *  bare multi-word term counts documents matching ANY of its words — proven in
 *  the first production run, where "refund complaint" outcounted "refund"
 *  (union semantics: 190 refund + 2 complaint = 192 "refund complaint").
 *  A count named "refund complaint" must mean the PHRASE, so multi-word terms
 *  are quoted; to count any-of-words, pass the words as separate terms. */
export function termToQuery(term: string): string {
  const t = term.trim();
  return /\s/.test(t) ? `"${t.replace(/"/g, "")}"` : t;
}
