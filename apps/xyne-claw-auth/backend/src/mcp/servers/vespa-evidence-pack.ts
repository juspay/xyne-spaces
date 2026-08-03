/**
 * spaces-evidence-pack — pure construction + validation for the EXTRACT tool.
 *
 * The extraction half of the corpus-analysis method: run a fixed spec once,
 * deterministically, and emit a bounded, dated pack of snippets —
 * `{docId, date, area, channel, term, snippet}` — that becomes the writer's
 * only input and the verifier's CLOSED SET for citations. Extraction is dumb
 * by design: no ranking judgment, no summarizing, predictable from the spec.
 *
 * Pack invariants (each is a documented failure mode of the naive approach):
 *   • CAPS, always — an uncapped extraction on a common term is a firehose
 *     that drowns the writer. Caps are per time-bucket, which also forces
 *     SPREAD: for "the same ask, years apart" you want the earliest members
 *     of each bucket, not the ten loudest members overall.
 *   • DATES travel with every snippet — trend/timeline/audit questions are
 *     impossible if extraction drops the date.
 *   • Deterministic order — within a bucket, members are fetched oldest-first
 *     (timestamp asc), so re-running the same spec yields the same pack.
 *
 * Like vespa-corpus-scan.ts this module is tool-free and side-effect-free;
 * the MCP tool in xyne-spaces-tools.ts feeds the YQL to queryDirect(), which
 * injects the ACL + workspace guards — the builder never emits either.
 */

import { esc } from "./vespa-direct.js";
import {
  validateCorpusScan,
  type ValidatedScan,
  type CorpusScanBucket,
  type CorpusScanScope,
} from "./vespa-corpus-scan.js";

export const MAX_PACK_PER_BUCKET = 10;
export const DEFAULT_PACK_PER_BUCKET = 6;
/** Hard bound on term×bucket fetch queries per call — keeps one pack call from
 *  fanning out into an unbounded query storm on a long-history corpus. When the
 *  discovered buckets exceed this, the NEWEST buckets win and the skip is
 *  reported in the coverage note. */
export const MAX_BUCKET_FETCHES = 24;
export const MAX_SNIPPET_CHARS = 400;

export interface EvidencePackRequest {
  searchArea: string;
  topic: string;
  terms: string[];
  scope?: CorpusScanScope;
  bucket: CorpusScanBucket;
  perBucket?: number;
}

export interface ValidatedPack {
  scan: ValidatedScan;
  topic: string;
  perBucket: number;
}

export function validateEvidencePack(req: EvidencePackRequest): ValidatedPack {
  const topic = String(req.topic ?? "").trim();
  if (!topic) throw new Error("evidence-pack: spec.topic is required — packs are per-topic artifacts.");

  // Area / terms / scope / bucket rules are identical to corpus-scan —
  // extraction and counting must agree on what a term and a scope mean.
  const scan = validateCorpusScan({
    searchArea: req.searchArea,
    terms: req.terms,
    ...(req.scope !== undefined ? { scope: req.scope } : {}),
    bucket: req.bucket,
  });

  const perBucket = req.perBucket ?? DEFAULT_PACK_PER_BUCKET;
  if (!Number.isInteger(perBucket) || perBucket < 1 || perBucket > MAX_PACK_PER_BUCKET) {
    throw new Error(`evidence-pack: perBucket must be an integer 1..${MAX_PACK_PER_BUCKET} (got ${String(req.perBucket)}).`);
  }

  return { scan, topic, perBucket };
}

/** The dd/mm/yyyy date range covering one bucket key (year "2026" or month
 *  "202606"), in the literal format queryDirect's convertDateLiteralsToMs
 *  rewrites to epoch ms. Upper bound is exclusive. */
export function bucketRange(bucketKey: number, bucket: CorpusScanBucket): { after: string; before: string } {
  if (bucket === "year") {
    return { after: `01/01/${bucketKey}`, before: `01/01/${bucketKey + 1}` };
  }
  const year = Math.trunc(bucketKey / 100);
  const month = bucketKey % 100;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const mm = (m: number) => String(m).padStart(2, "0");
  return { after: `01/${mm(month)}/${year}`, before: `01/${mm(nextMonth)}/${nextYear}` };
}

/**
 * YQL for one bucket fetch: the spec's conditions confined to the bucket's
 * date range, members returned oldest-first. No grouping, no relevance — the
 * caller passes the term as queryDirect's @query binding and the `unranked`
 * profile; `order by` makes the selection deterministic.
 */
export function buildPackFetchYql(
  scan: ValidatedScan,
  range: { after: string; before: string },
): string {
  const { area, scope } = scan;
  const conditions: string[] = ["userInput(@query)", ...area.baseConditions];

  if (scope.channels && scope.channels.length > 0) {
    const channelField = area.fields.find(f => f.name === "channelId");
    const column = channelField?.vespaField ?? "channelId";
    const ors = scope.channels.map(id => `${column} contains "${esc(id)}"`);
    conditions.push(ors.length === 1 ? ors[0]! : `(${ors.join(" or ")})`);
  }

  const ts = area.timestampField;
  // The bucket range is intersected with any spec-level after/before — the
  // narrower bound wins on each side simply by ANDing all four.
  if (scope.after) conditions.push(`${ts} >= "${scope.after}"`);
  if (scope.before) conditions.push(`${ts} < "${scope.before}"`);
  conditions.push(`${ts} >= "${range.after}"`);
  conditions.push(`${ts} < "${range.before}"`);

  return `select * from sources ${area.source} where ${conditions.join(" and ")} order by ${ts} asc`;
}

/** dd/mm/yyyy in IST from an epoch-ms timestamp — the same date discipline the
 *  answer rules require, applied at extraction so packs never carry raw epochs. */
export function formatIstDate(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return "unknown";
  const d = new Date(epochMs + 5.5 * 3600 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Snippet hygiene: strip Vespa <hi> highlight markup, collapse whitespace,
 *  cap length. A pack row is a few hundred characters of context around the
 *  match — the writer can fetch the full document by id as an escalation. */
export function toSnippet(context: string | undefined): string {
  const clean = String(context ?? "")
    .replace(/<\/?hi>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > MAX_SNIPPET_CHARS ? `${clean.slice(0, MAX_SNIPPET_CHARS)}…` : clean;
}
