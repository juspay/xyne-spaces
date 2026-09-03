/**
 * Digital Twin — curator batch packer.
 *
 * Replaces the old fixed `BATCH_SIZE = 40` slicing in the daily + backfill
 * workers. Now that a single message can render up to MSG_CHAR_CAP (3000) chars
 * — instead of the old 200/400-char clips — a fixed record count is the wrong
 * unit: 40 fat conversation units could blow the curator's context window while
 * 40 one-liners waste it. Pack by TOKEN BUDGET instead, so every batch fills the
 * window without overflowing it, regardless of per-unit size.
 *
 * Two guards:
 *   1. Token budget — accumulate records until the next one would push the batch
 *      past BATCH_TOKEN_BUDGET.
 *   2. Record backstop — never exceed MAX_RECORDS_PER_BATCH (matches the claw
 *      curator's own 200-record cap, so it never silently truncates a batch).
 *
 * Oversized single units (a rare 80-message thread all at the char cap, or a
 * huge canvas) are SUB-CHUNKED into `id#pN` pieces that each fit the budget, so
 * they can be packed at all rather than dropped/truncated. The `#pN` suffix is
 * stripped back to the base id when the curator's grounded candidates are turned
 * into sourceRefs (userMemoryCuratorClient.ts) — the sub-chunk is an artefact of
 * batching, never a real record id.
 */

import type { UserMemoryRecord } from "xyne-claw-shared";

/** Rough chars→tokens ratio for English prose. Conservative (real is ~4-4.5). */
const CHARS_PER_TOKEN = 4;
/** Token budget per curator batch. ~80k tokens ≈ the worst-case single unit
 *  (MSG_CHAR_CAP × THREAD_MSG_CAP + hydration), so a max unit fills its own
 *  batch and normal units pack many-per-batch up to the record backstop. Well
 *  under the curator model's context window once the system prompt + inlined
 *  existing memories are added. */
export const BATCH_TOKEN_BUDGET = 80_000;
const BATCH_CHAR_BUDGET = BATCH_TOKEN_BUDGET * CHARS_PER_TOKEN; // 320_000
/** Matches MAX_RECORDS_PER_BATCH in claw's user-memory-curator. Small records
 * can now fill the 80k-token budget instead of being cut off at 50; large
 * records still split earlier on BATCH_CHAR_BUDGET. */
const MAX_RECORDS_PER_BATCH = 200;

/** Marker prefixing every sub-chunk id: `<baseId>#p<n>`. Base record ids
 *  (message/conversation ids, `twin-reply:*`) never contain "#", so this is a
 *  safe, reversible sentinel. */
const CHUNK_SEP = "#p";

/** Strip the `#pN` sub-chunk suffix back to the base record id. No-op for ids
 *  that were never sub-chunked. */
export function baseRecordId(id: string): string {
  const i = id.indexOf(CHUNK_SEP);
  return i >= 0 ? id.slice(0, i) : id;
}

/** Split one oversized record's text into ≤BATCH_CHAR_BUDGET pieces on line
 *  boundaries where possible, each a standalone record with a `#pN` id and a
 *  one-line "(part k/n …)" marker so the curator knows it's a continuation. */
function subChunk(r: UserMemoryRecord): UserMemoryRecord[] {
  const text = r.text ?? "";
  if (text.length <= BATCH_CHAR_BUDGET) return [r];

  const pieces: string[] = [];
  let cur = "";
  for (const ln of text.split("\n")) {
    if (ln.length > BATCH_CHAR_BUDGET) {
      // A single line longer than the whole budget — hard-split it.
      if (cur) {
        pieces.push(cur);
        cur = "";
      }
      for (let i = 0; i < ln.length; i += BATCH_CHAR_BUDGET) pieces.push(ln.slice(i, i + BATCH_CHAR_BUDGET));
      continue;
    }
    if (cur && cur.length + ln.length + 1 > BATCH_CHAR_BUDGET) {
      pieces.push(cur);
      cur = ln;
    } else {
      cur = cur ? `${cur}\n${ln}` : ln;
    }
  }
  if (cur) pieces.push(cur);

  const n = pieces.length;
  return pieces.map((p, k) => ({
    ...r,
    id: `${r.id}${CHUNK_SEP}${k + 1}`,
    text: `(part ${k + 1}/${n} of a longer unit — same source, split only to fit the curator window)\n${p}`,
  }));
}

/** Pack records into curator batches by token budget (+ 200-record backstop),
 *  sub-chunking any single oversized unit first. Every batch is non-empty and
 *  fits the budget (a lone sub-chunk that equals the budget is its own batch). */
export function packRecordsIntoBatches(records: UserMemoryRecord[]): UserMemoryRecord[][] {
  const expanded: UserMemoryRecord[] = [];
  for (const r of records) expanded.push(...subChunk(r));

  const batches: UserMemoryRecord[][] = [];
  let cur: UserMemoryRecord[] = [];
  let curChars = 0;
  for (const r of expanded) {
    const c = (r.text ?? "").length;
    if (cur.length > 0 && (curChars + c > BATCH_CHAR_BUDGET || cur.length >= MAX_RECORDS_PER_BATCH)) {
      batches.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(r);
    curChars += c;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}
