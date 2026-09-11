/**
 * Repairs the loosely-formed "unified diffs" that models actually emit into
 * something the diff card can draw.
 *
 * The `diff` FlowUI component is rendered by @pierre/diffs (`PatchDiff`), whose
 * parser is strict in two ways that matter here:
 *
 *   1. A hunk boundary is the literal prefix `@@ `, and the header must read
 *      `@@ -<start>[,<count>] +<start>[,<count>] @@`. A bare `@@` — by far the
 *      most common thing an agent writes — is not a boundary at all, so the
 *      whole patch collapses into the file-header block and ZERO hunks come out.
 *   2. A non-git patch must START with a `--- ` line immediately followed by a
 *      `+++ ` line. Anything else (no headers, or a sentence above them) makes
 *      the parser treat the entire text as patch metadata and emit no files.
 *
 * Both failures are silent — the parser logs and returns empty rather than
 * throwing — so the card's error boundary never fires and the user just gets a
 * blank body. Hence: normalize before we hand a patch to the renderer.
 *
 * A third, subtler failure this also fixes: the parser stops consuming a hunk
 * once it has read `additionCount` additions and `deletionCount` deletions. A
 * header whose counts are too low (models guess these) silently truncates the
 * hunk mid-render. So the counts are always RECOMPUTED from the body and never
 * trusted.
 */

/** One hunk, already split into its (repaired) body lines. */
interface ParsedHunk {
  /** Declared `-start` from the original header, when it had a valid range. */
  deletionStart?: number | undefined;
  /** Declared `+start` from the original header, when it had a valid range. */
  additionStart?: number | undefined;
  /** Trailing context text after the closing `@@`, e.g. a function signature. */
  context: string;
  /** Body lines, each already prefixed with one of ` `, `+`, `-`, `\`. */
  body: string[];
  additions: number;
  deletions: number;
  /** Context lines — they count toward BOTH the old and new side. */
  common: number;
}

export interface NormalizedPatch {
  /**
   * A patch @pierre/diffs can parse into at least one hunk, or `null` when the
   * input carried no diff body at all (nothing to draw — callers should refuse
   * rather than post an empty card).
   */
  patch: string | null;
  added: number;
  removed: number;
  hunks: number;
}

/** Body lines are the only thing a hunk may contain. `\` is the
 *  "\ No newline at end of file" marker, which the parser accepts. */
function bodyPrefix(line: string): ' ' | '+' | '-' | '\\' | null {
  const first = line[0];
  if (first === ' ' || first === '+' || first === '-' || first === '\\') return first;
  // A context line whose content is empty is supposed to be a single space, but
  // models routinely emit a truly empty line. Read it as empty context.
  if (line === '' || line === '\r') return ' ';
  return null;
}

/** Models like to wrap the patch in a ```diff fence. Unwrap it. */
function stripCodeFence(patch: string): string {
  const lines = patch.split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start += 1;
  while (end > start && lines[end - 1]!.trim() === '') end -= 1;
  if (start < end && /^```/.test(lines[start]!.trim()) && lines[end - 1]!.trim() === '```') {
    return lines.slice(start + 1, end - 1).join('\n');
  }
  return patch;
}

/**
 * Reads whatever range a hunk header carries. Tolerates every shape seen in the
 * wild: `@@`, `@@ @@`, `@@ ... @@`, `@@ -12 +12 @@`, `@@ -12,3 +12,5 @@ ctx`.
 * Returns the declared starts only when the range is actually parseable.
 */
function readHunkHeader(line: string): {
  deletionStart?: number | undefined;
  additionStart?: number | undefined;
  context: string;
} {
  const closing = line.indexOf('@@', 2);
  const spec = closing === -1 ? line.slice(2) : line.slice(2, closing);
  const context = closing === -1 ? '' : line.slice(closing + 2).trim();
  const range = /^\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*$/.exec(spec);
  if (!range) return { context };
  return { deletionStart: Number(range[1]), additionStart: Number(range[2]), context };
}

function pushBodyLine(hunk: ParsedHunk, line: string): void {
  const prefix = bodyPrefix(line);
  if (prefix === '\\') {
    hunk.body.push(line);
    return;
  }
  const content = prefix === ' ' && (line === '' || line === '\r') ? ' ' : line;
  hunk.body.push(content);
  if (prefix === '+') hunk.additions += 1;
  else if (prefix === '-') hunk.deletions += 1;
  else hunk.common += 1;
}

/**
 * Rewrites `patch` so @pierre/diffs can render it, using `path` for the file
 * headers when the patch does not supply its own.
 *
 * Git patches (`diff --git`) keep their own header block verbatim — it carries
 * rename/mode/index metadata the card would otherwise lose — but their hunk
 * headers are rewritten just the same.
 */
export function normalizeUnifiedPatch(path: string, patch: string): NormalizedPatch {
  const lines = stripCodeFence(patch).split('\n');
  // The patch's own terminating newline yields a final empty element. Reading it
  // as an empty context line would append a phantom line to the last hunk — and
  // grow the patch by one line on every re-normalization.
  if (lines.length > 0 && (lines[lines.length - 1] === '' || lines[lines.length - 1] === '\r')) lines.pop();

  const preamble: string[] = [];
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | undefined;
  let sawGitHeader = false;

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (line.startsWith('@@')) {
      const { deletionStart, additionStart, context } = readHunkHeader(line);
      current = { deletionStart, additionStart, context, body: [], additions: 0, deletions: 0, common: 0 };
      hunks.push(current);
      continue;
    }

    if (current) {
      if (bodyPrefix(line) !== null) {
        pushBodyLine(current, line);
        continue;
      }
      // Prose after a hunk (a model explaining itself) ends the hunk. Drop it
      // rather than feeding the parser a line it will reject.
      current = undefined;
      continue;
    }

    if (line.startsWith('diff --git ')) sawGitHeader = true;
    preamble.push(line);
  }

  // No `@@` anywhere, but there is a +/- body: treat the whole thing as one
  // hunk instead of dropping it. Only the preamble was collected, so re-read it.
  if (hunks.length === 0) {
    const synthetic: ParsedHunk = { context: '', body: [], additions: 0, deletions: 0, common: 0 };
    for (const line of preamble) {
      if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff --git ')) continue;
      if (bodyPrefix(line) === null) continue;
      pushBodyLine(synthetic, line);
    }
    if (synthetic.additions + synthetic.deletions === 0) return { patch: null, added: 0, removed: 0, hunks: 0 };
    hunks.push(synthetic);
    preamble.length = 0;
    sawGitHeader = false;
  }

  const drawable = hunks.filter((hunk) => hunk.additions + hunk.deletions + hunk.common > 0);
  if (drawable.length === 0) return { patch: null, added: 0, removed: 0, hunks: 0 };

  const out: string[] = [];
  if (sawGitHeader) {
    out.push(...preamble);
  } else {
    // Rebuild the header pair rather than reusing the preamble as-is: the
    // parser only recognises a unified file when `--- ` is the very FIRST line
    // and `+++ ` the second, so any stray prose above them loses the file.
    const declaredOld = preamble.find((line) => line.startsWith('--- '))?.slice(4).trim();
    const declaredNew = preamble.find((line) => line.startsWith('+++ '))?.slice(4).trim();
    out.push(`--- ${declaredOld || `a/${path}`}`);
    out.push(`+++ ${declaredNew || `b/${path}`}`);
  }

  // Line numbers: honour whatever the patch declared, and for unanchored hunks
  // walk forward from the previous one leaving a one-line gap, so the renderer
  // draws its "collapsed" separator between them instead of running two
  // unrelated hunks together as one block.
  let nextDeletionStart = 1;
  let nextAdditionStart = 1;
  let added = 0;
  let removed = 0;

  for (const hunk of drawable) {
    const deletionCount = hunk.deletions + hunk.common;
    const additionCount = hunk.additions + hunk.common;
    const deletionStart = hunk.deletionStart ?? nextDeletionStart;
    const additionStart = hunk.additionStart ?? nextAdditionStart;
    // A zero-length side is legal only at position 0 (pure insert/delete at the
    // start of a file); everything else must be 1-based.
    const safeDeletionStart = deletionCount === 0 ? Math.max(deletionStart - 1, 0) : Math.max(deletionStart, 1);
    const safeAdditionStart = additionCount === 0 ? Math.max(additionStart - 1, 0) : Math.max(additionStart, 1);

    out.push(
      `@@ -${safeDeletionStart},${deletionCount} +${safeAdditionStart},${additionCount} @@${hunk.context ? ` ${hunk.context}` : ''}`,
    );
    out.push(...hunk.body);

    nextDeletionStart = safeDeletionStart + deletionCount + 1;
    nextAdditionStart = safeAdditionStart + additionCount + 1;
    added += hunk.additions;
    removed += hunk.deletions;
  }

  return { patch: `${out.join('\n')}\n`, added, removed, hunks: drawable.length };
}
