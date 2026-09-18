/**
 * Validation and deterministic repair for the `[clf-N]` citations a summariser
 * LLM writes into a call summary. Only the exact token resolves downstream, so
 * anything else — a bare `[12]`, a segment that does not exist, a range — reaches
 * the reader as broken text or silently drops a timeline item.
 *
 * Pure by design so it can be unit-tested directly; `callSummaryCitationRepair.ts`
 * adds the LLM round-trip.
 */

export const CITATION_TOKEN_RE = /\[clf-(\d+)\]/g;

// Below these thresholds a transcript can genuinely have nothing worth citing,
// so an uncited summary is not treated as a model failure.
const MIN_SEGMENTS_FOR_CITATIONS = 5;
const MIN_CITABLE_BULLETS_FOR_ZERO_CITATION_FAILURE = 2;

const MIN_CITABLE_BULLETS_FOR_COVERAGE_CHECK = 4;
const MIN_CITATION_COVERAGE = 0.3;

/** Anything shorter is a placeholder ("- None"), not a claim. */
const MIN_CITABLE_BULLET_LENGTH = 25;

const MAX_REPORTED_DEFECTS = 25;
const MIN_REPAIR_LENGTH_RATIO = 0.6;

const PLACEHOLDER_BULLETS = new Set([
  'none',
  'not discussed',
  'n/a',
  'na',
  'nothing',
  'no blockers',
  'not mentioned',
]);

// Marks where a token was removed so the surrounding whitespace can be fixed up
// in one pass afterwards. Private-use code point: impossible in real Markdown.
const REMOVAL_MARKER = '\uE000';

const SUMMARY_HEADING_RE = /^\s*(#{1,6})\s+(.+?)\s*$/;
const BULLET_RE = /^\s*[-*+]\s+(.+?)\s*$/;
const MARKED_BULLET_RE = /^\s*[-*+]\s+\[xyne-(action|decision)\]\s*(.*)$/;
const SOURCES_HEADING_RE = /^\s*#{1,6}\s*(citations?|sources?|references?)\s*:?\s*$/i;
const FOOTNOTE_MARKER_RE = /\[\^[^\]\n]{1,20}\]/g;

// A bare `[12]`, excluding markdown links, reference definitions and footnotes.
const BARE_NUMERIC_REF_RE = /(?<![\w!^])\[(\d{1,4})\](?![(:])/g;
const BARE_NUMERIC_LIST_RE = /(?<![\w!^])\[(\d{1,4}(?:\s*[,;]\s*\d{1,4})+)\](?![(:])/g;

/** Anything shaped like a clf token but not exactly `[clf-<digits>]`. */
const CLF_SHAPED_RE = /[[(【⟦]\s*clf[^\])】⟧\n]{0,40}[\])】⟧]/gi;

const EXACT_CLF_TOKEN_RE = /^\[clf-\d+\]$/;

export interface CitationDefect {
  kind:
    | 'invalid_segment_id'
    | 'bare_numeric_ref'
    | 'malformed_token'
    | 'footnote_or_sources_section'
    | 'uncited_marked_bullet'
    | 'no_citations'
    | 'low_coverage';
  text: string;
  line?: string;
}

export interface CitationAudit {
  totalTokens: number;
  resolvedTokens: number;
  invalidSegmentIds: number[];
  bareNumericRefs: number[];
  malformedTokens: string[];
  footnoteOrSourcesRefs: string[];
  citableBullets: number;
  citedBullets: number;
  markedBullets: number;
  uncitedMarkedBullets: string[];
  insufficientTranscriptSummary: boolean;
  transcriptTooShortToJudge: boolean;
  defects: CitationDefect[];
  /** Defects that are objectively wrong, excluding the judgement calls. */
  defectCount: number;
  verdict: 'ok' | 'repair';
  reasons: string[];
}

export interface DeterministicRepairResult {
  markdown: string;
  convertedBareRefs: number;
  convertedListRefs: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function blankOut(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

/** Offset-preserving copy with code blanked out, so scans never match inside it. */
function maskCode(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(?:```|$)/g, blankOut)
    .replace(/`[^`\n]*`/g, blankOut);
}

/**
 * Run `pattern` over the code-masked view of `markdown` and rebuild the string
 * from the ORIGINAL text, so replacements never touch code and indices stay
 * aligned. A replacer returning null leaves the match untouched.
 */
function replaceOutsideCode(
  markdown: string,
  pattern: RegExp,
  replacer: (matchText: string, groups: string[], index: number, masked: string) => string | null,
): { text: string; count: number } {
  const masked = maskCode(markdown);
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let out = '';
  let last = 0;
  let count = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(masked)) !== null) {
    const matchText = markdown.slice(m.index, m.index + m[0].length);
    const replacement = replacer(matchText, m.slice(1) as string[], m.index, masked);
    if (replacement === null) continue;
    out += markdown.slice(last, m.index) + replacement;
    last = m.index + m[0].length;
    count += 1;
  }

  return { text: out + markdown.slice(last), count };
}

/** Collect every match of `pattern` outside code, with its full source line. */
function matchesOutsideCode(
  markdown: string,
  pattern: RegExp,
): Array<{ text: string; groups: string[]; line: string; index: number; masked: string }> {
  const masked = maskCode(markdown);
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const found: Array<{ text: string; groups: string[]; line: string; index: number; masked: string }> = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(masked)) !== null) {
    const lineStart = markdown.lastIndexOf('\n', m.index) + 1;
    const lineEndIdx = markdown.indexOf('\n', m.index);
    const lineEnd = lineEndIdx === -1 ? markdown.length : lineEndIdx;
    found.push({
      text: markdown.slice(m.index, m.index + m[0].length),
      groups: m.slice(1) as string[],
      line: markdown.slice(lineStart, lineEnd).trim(),
      index: m.index,
      masked,
    });
  }

  return found;
}

/** `[12] [03:24] Alice: …` is a quoted transcript line, not a bad citation. */
function isQuotedTranscriptLine(masked: string, matchEnd: number): boolean {
  return /^\s*\[\d{1,2}:\d{2}/.test(masked.slice(matchEnd, matchEnd + 12));
}

/**
 * Drop the removal markers and tidy the whitespace they leave behind, matching
 * how a resolved citation chip renders: the space before the token is absorbed,
 * the space after it is kept.
 */
function applyRemovals(text: string): string {
  const lines = text
    .replace(/[ \t]+\uE000/g, '\uE000')
    .replace(/^(\s*(?:[-*+]|\d+\.)?[ \t]*)\uE000[ \t]*/gm, '$1')
    .replace(/\uE000/g, '')
    // Interior runs only; leading whitespace is a nested list's indentation.
    .replace(/(\S)[ \t]{2,}/g, '$1 ')
    .replace(/[ \t]+([.,;:!?)])/g, '$1')
    .split('\n');

  // A bullet left holding nothing renders as an empty list item.
  return lines.filter(line => !/^\s*(?:[-*+]|\d+[.)])\s*$/.test(line)).join('\n');
}

function isPlaceholderBullet(text: string): boolean {
  const normalized = text
    .replace(CITATION_TOKEN_RE, '')
    .replace(/[*_`]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[.:]$/, '');
  return PLACEHOLDER_BULLETS.has(normalized) || normalized.length === 0;
}

/** Segment ids actually present in the numbered transcript we sent the model. */
export function parseNumberedSegmentIds(numberedTranscript: string): Set<number> {
  const ids = new Set<number>();
  for (const line of numberedTranscript.split('\n')) {
    const m = line.match(/^\s*\[(\d+)\]\s+\[\d{1,2}:\d{2}(?::\d{2})?\]/);
    if (m) ids.add(Number(m[1]));
  }
  return ids;
}

export function maxSegmentId(validSegmentIds: ReadonlySet<number>): number {
  let max = 0;
  for (const id of validSegmentIds) if (id > max) max = id;
  return max;
}

/** The explicit "not enough transcript" bail-out the prompts ask for. */
export function isInsufficientTranscriptSummary(markdown: string): boolean {
  return /not enough (data|transcript|content)/i.test(markdown) && markdown.trim().length < 400;
}

// ── audit ────────────────────────────────────────────────────────────────────

/**
 * A summary with no citations is only a failure when the TRANSCRIPT had
 * something to cite. A two-line call, or the "not enough data" bail-out,
 * legitimately produces none — judging that from the summary alone would retry
 * forever on calls that can never satisfy it.
 */
export function auditSummaryCitations(
  markdown: string,
  validSegmentIds: ReadonlySet<number>,
): CitationAudit {
  const defects: CitationDefect[] = [];
  const invalidSegmentIds: number[] = [];
  const bareNumericRefs: number[] = [];
  const malformedTokens: string[] = [];
  const footnoteOrSourcesRefs: string[] = [];
  const uncitedMarkedBullets: string[] = [];

  let totalTokens = 0;
  let resolvedTokens = 0;

  for (const { text, groups, line } of matchesOutsideCode(markdown, CITATION_TOKEN_RE)) {
    totalTokens += 1;
    const id = Number(groups[0]);
    if (validSegmentIds.has(id)) {
      resolvedTokens += 1;
    } else {
      invalidSegmentIds.push(id);
      defects.push({ kind: 'invalid_segment_id', text, line });
    }
  }

  for (const match of matchesOutsideCode(markdown, BARE_NUMERIC_REF_RE)) {
    if (isQuotedTranscriptLine(match.masked, match.index + match.text.length)) continue;
    bareNumericRefs.push(Number(match.groups[0]));
    defects.push({ kind: 'bare_numeric_ref', text: match.text, line: match.line });
  }
  for (const match of matchesOutsideCode(markdown, BARE_NUMERIC_LIST_RE)) {
    for (const part of match.groups[0]!.split(/[,;]/)) bareNumericRefs.push(Number(part.trim()));
    defects.push({ kind: 'bare_numeric_ref', text: match.text, line: match.line });
  }

  for (const match of matchesOutsideCode(markdown, CLF_SHAPED_RE)) {
    if (EXACT_CLF_TOKEN_RE.test(match.text)) continue;
    malformedTokens.push(match.text);
    defects.push({ kind: 'malformed_token', text: match.text, line: match.line });
  }

  for (const match of matchesOutsideCode(markdown, FOOTNOTE_MARKER_RE)) {
    footnoteOrSourcesRefs.push(match.text);
    defects.push({ kind: 'footnote_or_sources_section', text: match.text, line: match.line });
  }

  let citableBullets = 0;
  let citedBullets = 0;
  let markedBullets = 0;

  for (const rawLine of markdown.split('\n')) {
    if (SOURCES_HEADING_RE.test(rawLine)) {
      footnoteOrSourcesRefs.push(rawLine.trim());
      defects.push({ kind: 'footnote_or_sources_section', text: rawLine.trim() });
      continue;
    }
    if (SUMMARY_HEADING_RE.test(rawLine)) continue;

    const bullet = rawLine.match(BULLET_RE);
    if (!bullet) continue;
    const bulletText = bullet[1]!;

    const tokens = [...bulletText.matchAll(new RegExp(CITATION_TOKEN_RE.source, 'g'))];
    const hasResolvedToken = tokens.some(token => validSegmentIds.has(Number(token[1])));

    const marked = rawLine.match(MARKED_BULLET_RE);
    if (marked) {
      markedBullets += 1;
      if (!hasResolvedToken) {
        const text = rawLine.trim();
        uncitedMarkedBullets.push(text);
        defects.push({ kind: 'uncited_marked_bullet', text });
      }
    }

    if (isPlaceholderBullet(bulletText) || bulletText.length < MIN_CITABLE_BULLET_LENGTH) continue;
    citableBullets += 1;
    if (hasResolvedToken) citedBullets += 1;
  }

  const insufficientTranscriptSummary = isInsufficientTranscriptSummary(markdown);
  const transcriptTooShortToJudge = validSegmentIds.size < MIN_SEGMENTS_FOR_CITATIONS;
  const reasons: string[] = [];

  const objectiveDefects =
    invalidSegmentIds.length +
    bareNumericRefs.length +
    malformedTokens.length +
    footnoteOrSourcesRefs.length +
    uncitedMarkedBullets.length;

  if (invalidSegmentIds.length > 0) reasons.push('invalid_segment_id');
  if (bareNumericRefs.length > 0) reasons.push('bare_numeric_ref');
  if (malformedTokens.length > 0) reasons.push('malformed_token');
  if (footnoteOrSourcesRefs.length > 0) reasons.push('footnote_or_sources_section');
  if (uncitedMarkedBullets.length > 0) reasons.push('uncited_marked_bullet');

  const citationsWereExpected = !insufficientTranscriptSummary && !transcriptTooShortToJudge;
  if (citationsWereExpected) {
    if (
      resolvedTokens === 0 &&
      citableBullets >= MIN_CITABLE_BULLETS_FOR_ZERO_CITATION_FAILURE
    ) {
      reasons.push('no_citations');
      defects.push({
        kind: 'no_citations',
        text: `the summary contains ${citableBullets} citable statements but not a single valid [clf-N] token`,
      });
    } else if (
      citableBullets >= MIN_CITABLE_BULLETS_FOR_COVERAGE_CHECK &&
      citedBullets / citableBullets < MIN_CITATION_COVERAGE
    ) {
      reasons.push('low_coverage');
      defects.push({
        kind: 'low_coverage',
        text: `only ${citedBullets} of ${citableBullets} citable statements carry a valid citation`,
      });
    }
  }

  return {
    totalTokens,
    resolvedTokens,
    invalidSegmentIds,
    bareNumericRefs,
    malformedTokens,
    footnoteOrSourcesRefs,
    citableBullets,
    citedBullets,
    markedBullets,
    uncitedMarkedBullets,
    insufficientTranscriptSummary,
    transcriptTooShortToJudge,
    defects,
    defectCount: objectiveDefects,
    verdict: reasons.length > 0 ? 'repair' : 'ok',
    reasons,
  };
}

// ── deterministic repair ─────────────────────────────────────────────────────

/**
 * Fixes the failures that need no model: `[12]` and `[3, 5]` rewritten to real
 * tokens, but only when every id is a real segment. An id the transcript never
 * had is left for the repair pass rather than invented into a clickable citation.
 */
export function repairCitationsDeterministically(
  markdown: string,
  validSegmentIds: ReadonlySet<number>,
): DeterministicRepairResult {
  const lists = replaceOutsideCode(markdown, BARE_NUMERIC_LIST_RE, (_text, groups) => {
    const ids = groups[0]!.split(/[,;]/).map(part => Number(part.trim()));
    if (ids.some(id => !validSegmentIds.has(id))) return null;
    return ids.map(id => `[clf-${id}]`).join('');
  });

  const bare = replaceOutsideCode(lists.text, BARE_NUMERIC_REF_RE, (_text, groups, index, masked) => {
    if (isQuotedTranscriptLine(masked, index + _text.length)) return null;
    const id = Number(groups[0]);
    return validSegmentIds.has(id) ? `[clf-${id}]` : null;
  });

  return {
    markdown: bare.text,
    convertedBareRefs: bare.count,
    convertedListRefs: lists.count,
  };
}

/**
 * Last line of defence: delete anything that would reach the reader as broken
 * literal text. The canvas renderer already drops unresolvable tokens, so doing
 * it here makes the stored Markdown agree with what the canvas shows.
 */
export function stripBrokenCitationArtifacts(
  markdown: string,
  validSegmentIds: ReadonlySet<number>,
): string {
  let text = replaceOutsideCode(markdown, CITATION_TOKEN_RE, (_t, groups) =>
    validSegmentIds.has(Number(groups[0])) ? null : REMOVAL_MARKER,
  ).text;

  text = replaceOutsideCode(text, CLF_SHAPED_RE, matchText =>
    EXACT_CLF_TOKEN_RE.test(matchText) ? null : REMOVAL_MARKER,
  ).text;

  text = replaceOutsideCode(text, BARE_NUMERIC_LIST_RE, () => REMOVAL_MARKER).text;

  text = replaceOutsideCode(text, BARE_NUMERIC_REF_RE, (matchText, _groups, index, masked) =>
    isQuotedTranscriptLine(masked, index + matchText.length) ? null : REMOVAL_MARKER,
  ).text;

  text = replaceOutsideCode(text, FOOTNOTE_MARKER_RE, () => REMOVAL_MARKER).text;

  return dropSourcesSection(applyRemovals(text));
}

/**
 * Only removes the section when everything under it is list-shaped, so a heading
 * that happens to introduce real prose is never deleted.
 */
function dropSourcesSection(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!SOURCES_HEADING_RE.test(line)) {
      out.push(line);
      continue;
    }

    let j = i + 1;
    let listOnly = true;
    while (j < lines.length && !SUMMARY_HEADING_RE.test(lines[j]!)) {
      const body = lines[j]!.trim();
      if (body.length > 0 && !/^(?:[-*+]|\d+[.)])\s/.test(body) && body !== '---') {
        listOnly = false;
        break;
      }
      j += 1;
    }

    if (!listOnly) {
      out.push(line);
      continue;
    }
    while (out.length > 0 && (out[out.length - 1]!.trim() === '' || out[out.length - 1]!.trim() === '---')) {
      out.pop();
    }
    i = j - 1;
  }

  return out.join('\n');
}

// ── generation prompt ────────────────────────────────────────────────────────

/**
 * The citation contract every summariser prompt embeds. It lives next to the
 * validator that enforces it so the two cannot drift apart. The caller
 * substitutes `{maxSegment}` with the transcript's real highest segment id.
 */
export function buildCitationRulesBlock(
  options: { markedBulletClause?: string } = {},
): string {
  const { markedBulletClause } = options;

  return `CITATIONS (ACCURACY IS CRITICAL):

THE FORMAT IS EXACT. A citation is the literal characters \`[clf-\` + one number + \`]\`.
- Each transcript line starts with its segment id: "[12] [03:24] Alice: ...". That line is segment 12.
- Valid segment ids for this transcript are 1 to {maxSegment}. A number outside that range is invalid and will be deleted.
- ✅ CORRECT:   The team cut Q4 scope [clf-12].
- ❌ WRONG:     The team cut Q4 scope [12].          ← a bare number is NOT a citation. It reaches the reader as broken literal text.
- ❌ WRONG:     ... [clf-8-11]  ... [clf-8, 9]  ... [clf 8]  ... (clf-12)  ... [clf-12#3]  ... [^1]
- ❌ WRONG:     a "Citations", "Sources" or "References" section at the end, or any footnote or link.
- Write the bare token inline, immediately after the claim it proves. Nothing else counts as a citation.

WHAT A CITATION MEANS. \`[clf-N]\` asserts: "the words that make this statement true are inside segment N." The reader clicks it and lands on that exact moment in the transcript.
- BEFORE writing [clf-N], find line N in the TRANSCRIPT below and confirm its text actually states what you just wrote. If you cannot point to the specific words in that line, do NOT cite it.
- Topic proximity is NOT support. A segment that merely discusses the same subject, or sits near the moment you have in mind, does not support the claim. Never cite "roughly where it was discussed".
- Never estimate, guess, round, shift, or reconstruct a segment number from memory of where something appeared. Read the number off the line itself. If you are not certain of the number, leave the statement uncited.
- Attribution must match: if the statement says who said, wanted, offered, agreed to, or committed to something, the cited segment must be that person's line, or a line that explicitly states their position.

WHAT TO CITE.
- Cite every specific claim, decision, action item, number, date, name, and quote you draw from the transcript.
- Each token in a group must independently support the statement. Never pad with extra numbers to look thorough — one exact citation beats three approximate ones. At most 3 tokens together, e.g. "...scope was cut [clf-8][clf-9]", most direct evidence first.
- For a roll-up statement that synthesises several moments (typical of Key Takeaways): cite only the 1-3 segments where that point is most explicitly stated. If no segment states it, RE-WORD the statement so it matches what a segment actually says — never attach an approximate citation just to satisfy the format.
- An uncited statement is acceptable. A wrongly cited statement is a serious error, because it looks verified and is not.
${markedBulletClause ? `${markedBulletClause}\n` : ''}
FINAL CHECK before you output: re-read every citation you wrote. Confirm each one is written exactly as [clf-N], that N is between 1 and {maxSegment}, and that segment N's text really states the claim. Delete or re-word any you cannot verify, and make sure no bare-number reference like [12] is left anywhere in the summary.`;
}

// ── repair prompt ────────────────────────────────────────────────────────────

function describeDefect(defect: CitationDefect): string {
  switch (defect.kind) {
    case 'invalid_segment_id':
      return `${defect.text} — segment ${defect.text.replace(/\D/g, '')} does not exist in the transcript. Cite the segment that actually states this, or drop the citation.\n    on: ${defect.line ?? ''}`;
    case 'bare_numeric_ref':
      return `${defect.text} — this is NOT a citation. A bare number in brackets renders to the reader as broken text. Either write it as [clf-N] using the segment that states the claim, or remove it.\n    on: ${defect.line ?? ''}`;
    case 'malformed_token':
      return `${defect.text} — wrong shape. The only accepted form is [clf-N] with a single number. No ranges, no spaces, no "#", no parentheses.\n    on: ${defect.line ?? ''}`;
    case 'footnote_or_sources_section':
      return `${defect.text} — footnotes and Citations/Sources sections are not supported. Remove it; cite inline with [clf-N] instead.`;
    case 'uncited_marked_bullet':
      return `${defect.text} — every [xyne-decision] / [xyne-action] bullet MUST end with at least one valid [clf-N]. Without it this item is dropped from the meeting timeline entirely. Add the segment where it was decided or assigned, re-wording the bullet if needed to match that segment.`;
    case 'no_citations':
    case 'low_coverage':
      return defect.text;
  }
}

/**
 * A repair rather than a regeneration: the prose was fine, only the pointers
 * were not, and regenerating risks losing a good summary to fix a bad token.
 */
export function buildCitationRepairPrompt(params: {
  summaryMarkdown: string;
  numberedTranscript: string;
  audit: CitationAudit;
  validSegmentIds: ReadonlySet<number>;
}): string {
  const { summaryMarkdown, numberedTranscript, audit, validSegmentIds } = params;
  const max = maxSegmentId(validSegmentIds);
  const defectList = audit.defects
    .slice(0, MAX_REPORTED_DEFECTS)
    .map((defect, index) => `${index + 1}. ${describeDefect(defect)}`)
    .join('\n');
  const truncated =
    audit.defects.length > MAX_REPORTED_DEFECTS
      ? `\n(and ${audit.defects.length - MAX_REPORTED_DEFECTS} more of the same kinds — fix every occurrence, not just the ones listed)`
      : '';

  return `The meeting summary below was generated from the TRANSCRIPT, but its inline transcript citations failed validation. Your ONLY job is to fix the citations and return the corrected summary.

CITATION FORMAT — EXACT:
- A citation is written \`[clf-N]\`: the literal characters \`[clf-\`, one number, \`]\`. Nothing else is a citation.
- N is the segment id printed at the start of a transcript line: "[12] [03:24] Alice: ..." → that line is segment 12.
- Valid segment ids for this transcript are 1 to ${max}. Any other number is invalid.
- A bare \`[12]\` is NOT a citation. It is shown to the reader as broken literal text.
- Ranges (\`[clf-8-11]\`), lists (\`[clf-8, 9]\`), \`#\` separators, links, footnotes (\`[^1]\`) and "Citations"/"Sources" sections are all invalid.

WHAT IS WRONG WITH THE SUMMARY BELOW:
${defectList}${truncated}

HOW TO FIX IT:
1. Return the COMPLETE corrected summary as Markdown. Not a diff, not a list of fixes, not commentary.
2. Keep the wording, headings, section order, bullet structure and any \`[xyne-decision]\` / \`[xyne-action]\` annotations EXACTLY as they are. The only edits allowed are to citations — plus re-wording a statement when that is the only way to make it match the segment that supports it.
3. For each defect: find the transcript line whose words actually state the claim, and cite THAT segment as [clf-N]. Read the number off the line; never estimate it.
4. If no segment states the claim, delete the citation rather than pointing it somewhere approximate. An uncited statement is acceptable; a wrongly cited one is not — it looks verified and is not.
5. Cite the specific claims: decisions, action items, numbers, dates, names, quotes, and each key takeaway that a segment explicitly states. At most 3 tokens on one statement, most direct evidence first.
6. Every \`[xyne-decision]\` and \`[xyne-action]\` bullet must end with at least one valid [clf-N].
7. Output only the Markdown summary. No preamble, no code fences, no explanation of what you changed.

TRANSCRIPT:
${numberedTranscript}

SUMMARY TO FIX:
${summaryMarkdown}

FINAL CHECK before you output: every [clf-N] you kept or added points at a segment between 1 and ${max} whose text actually states the claim it is attached to, and no bare-number or range-style reference remains anywhere.`;
}

// ── acceptance ───────────────────────────────────────────────────────────────

export interface RepairAcceptance {
  accepted: boolean;
  reason: string;
}

function headingSignature(markdown: string): string[] {
  return markdown
    .split('\n')
    .map(line => line.match(SUMMARY_HEADING_RE))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map(m => `${m[1]!.length}:${m[2]!.replace(CITATION_TOKEN_RE, '').trim().toLowerCase()}`);
}

/**
 * A repair only replaces the original when it removes defects without rewriting
 * the document. A summary with a few bad citations still beats one the repair
 * pass truncated or restructured.
 */
export function isRepairAcceptable(
  before: { markdown: string; audit: CitationAudit },
  after: { markdown: string; audit: CitationAudit },
): RepairAcceptance {
  if (!after.markdown.trim()) {
    return { accepted: false, reason: 'empty_repair' };
  }
  if (after.markdown.length < before.markdown.length * MIN_REPAIR_LENGTH_RATIO) {
    return { accepted: false, reason: 'repair_truncated' };
  }

  const beforeHeadings = headingSignature(before.markdown);
  const afterHeadings = headingSignature(after.markdown);
  if (
    beforeHeadings.length !== afterHeadings.length ||
    beforeHeadings.some((heading, index) => heading !== afterHeadings[index])
  ) {
    return { accepted: false, reason: 'structure_changed' };
  }

  if (after.audit.defectCount < before.audit.defectCount) {
    return { accepted: true, reason: 'fewer_defects' };
  }
  if (
    after.audit.defectCount === before.audit.defectCount &&
    after.audit.resolvedTokens > before.audit.resolvedTokens
  ) {
    return { accepted: true, reason: 'more_resolved_citations' };
  }

  return { accepted: false, reason: 'no_improvement' };
}

/** Compact, log-friendly view of an audit. */
export function summarizeAudit(audit: CitationAudit): Record<string, unknown> {
  return {
    verdict: audit.verdict,
    reasons: audit.reasons,
    total_tokens: audit.totalTokens,
    resolved_tokens: audit.resolvedTokens,
    invalid_segment_ids: audit.invalidSegmentIds.slice(0, 10),
    bare_numeric_refs: audit.bareNumericRefs.slice(0, 10),
    malformed_tokens: audit.malformedTokens.slice(0, 5),
    footnote_or_sources: audit.footnoteOrSourcesRefs.length,
    uncited_marked_bullets: audit.uncitedMarkedBullets.length,
    marked_bullets: audit.markedBullets,
    cited_bullets: audit.citedBullets,
    citable_bullets: audit.citableBullets,
    insufficient_transcript_summary: audit.insufficientTranscriptSummary,
    transcript_too_short_to_judge: audit.transcriptTooShortToJudge,
  };
}
