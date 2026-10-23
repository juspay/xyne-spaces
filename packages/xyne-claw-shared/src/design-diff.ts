/**
 * Diffing two revisions of a design system (XYNE-66824).
 *
 * A re-import re-runs extraction against the same source, which produces a
 * whole new DESIGN.md and tokens.css rather than a patch. Nobody should accept
 * that blind, so this says what actually moved: which tokens appeared, changed
 * or vanished, and which lines of the written rules differ.
 *
 * Pure and parse-free on purpose. `diffDesignTokens` takes two already-parsed
 * maps, because tokens.css parsing lives with whoever reads the CSS and there
 * is no single parser in this package yet — adding one here would make a second
 * and the two would drift. The markdown half delegates to `computeSkillDiff`
 * rather than carrying a second LCS implementation.
 */

import { computeSkillDiff, type SkillDiff } from "./skill-diff/index.js";

export interface TokenAdded {
  key: string;
  value: string;
}

export interface TokenChanged {
  key: string;
  oldValue: string;
  newValue: string;
}

export interface TokenRemoved {
  key: string;
  value: string;
}

export interface TokenDiffSummary {
  added: TokenAdded[];
  changed: TokenChanged[];
  removed: TokenRemoved[];
  /** False when the two token sets are identical, so a caller can skip a
   *  re-import that found nothing without counting three arrays. */
  hasChanges: boolean;
}

/**
 * A token's value as it is compared.
 *
 * Trimmed, and internal whitespace collapsed, so `#fff` and `#fff ` are the
 * same value and a reformatted stylesheet does not report every token as
 * changed. Case is NOT folded: `#FFF` and `#fff` are the same colour but a
 * re-import that rewrites one as the other is a real edit to the file, and
 * hiding it would make the saved version disagree with the diff that approved
 * it. Values are compared as written, not as parsed — this module knows nothing
 * about colour spaces, and `rgb(0 0 0)` vs `#000` is a change worth showing.
 */
const comparable = (value: string): string => value.trim().replace(/\s+/g, " ");

/** Token keys in a stable order, so a diff of the same two revisions always
 *  reads the same way. Sorted rather than insertion-ordered: the two sides come
 *  from different extraction runs and their key order is not meaningful. */
const sortedKeys = (tokens: Record<string, string>): string[] => Object.keys(tokens).sort();

/**
 * What changed between two token sets.
 *
 * A key present on both sides with the same comparable value appears nowhere —
 * this reports edits, not an inventory.
 */
export function diffDesignTokens(
  oldTokens: Record<string, string>,
  newTokens: Record<string, string>,
): TokenDiffSummary {
  const added: TokenAdded[] = [];
  const changed: TokenChanged[] = [];
  const removed: TokenRemoved[] = [];

  for (const key of sortedKeys(newTokens)) {
    const newValue = newTokens[key] ?? "";
    // `in` rather than a truthiness check: a token explicitly set to the empty
    // string still exists, and reporting it as added on every diff would be
    // wrong. Removing its value is a change, not a removal.
    if (!(key in oldTokens)) {
      added.push({ key, value: newValue });
      continue;
    }
    const oldValue = oldTokens[key] ?? "";
    if (comparable(oldValue) !== comparable(newValue)) {
      changed.push({ key, oldValue, newValue });
    }
  }

  for (const key of sortedKeys(oldTokens)) {
    if (!(key in newTokens)) removed.push({ key, value: oldTokens[key] ?? "" });
  }

  return {
    added,
    changed,
    removed,
    hasChanges: added.length > 0 || changed.length > 0 || removed.length > 0,
  };
}

/**
 * What changed between two DESIGN.md revisions.
 *
 * Returns hunks with context rather than every line of the document: a
 * DESIGN.md runs to tens of KB, and a reviewer approving a re-import needs the
 * parts that moved, not the parts that did not. Line endings and trailing
 * whitespace are normalised by the underlying differ, so an editor that rewrote
 * CRLF does not report the whole file as changed.
 */
export function diffDesignMarkdown(oldMd: string, newMd: string): SkillDiff {
  return computeSkillDiff(oldMd, newMd);
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * One line a person can read, for the version row's `changeSummary` and for the
 * re-import confirmation.
 *
 * Only non-zero parts appear, so a token-only change does not read "0 lines".
 * Stored on the version it describes, which is why it has to stand on its own
 * without the diff beside it.
 */
export function formatDiffSummary(diff: TokenDiffSummary, markdown?: SkillDiff): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${plural(diff.added.length, "token")} added`);
  if (diff.changed.length) parts.push(`${plural(diff.changed.length, "token")} changed`);
  if (diff.removed.length) parts.push(`${plural(diff.removed.length, "token")} removed`);

  if (markdown?.hasChanges) {
    const counts: string[] = [];
    if (markdown.added) counts.push(`+${markdown.added}`);
    if (markdown.removed) counts.push(`-${markdown.removed}`);
    // Singular on the total, not on the number of parts: "-1 line", but
    // "+1/-1 lines".
    const noun = markdown.added + markdown.removed === 1 ? "line" : "lines";
    parts.push(`${counts.join("/")} ${noun} of rules`);
  }

  // Said out loud rather than returned empty. This lands in a version row, and
  // a blank summary there reads as missing data instead of "nothing moved".
  if (parts.length === 0) return "No changes";
  return parts.join(", ");
}

/**
 * The same one-liner, for a caller that has the two files but not a parser.
 *
 * `formatDiffSummary` needs token maps, which means a tokens.css parser, which
 * the server does not have — the parsers live with the clients that read the
 * CSS. So the server describes a revision in lines rather than tokens. It is
 * less specific on purpose: a wrong token count would be worse than an honest
 * line count, and the version rows carry both files, so anything reading the
 * history can compute the token-level diff itself.
 */
export function formatContentChangeSummary(params: {
  oldDesignMd: string;
  newDesignMd: string;
  oldTokensCss: string;
  newTokensCss: string;
}): string {
  const lines = (before: string, after: string): string | null => {
    const diff = computeSkillDiff(before, after);
    if (!diff.hasChanges) return null;
    // The differ refuses a table too large to build, so there are no per-line
    // counts to report. Said as the sizes instead of guessed at — a summary is
    // not worth stalling a pod for.
    if (diff.tooLarge) return `changed (${diff.oldLineCount} → ${diff.newLineCount} lines)`;
    const counts: string[] = [];
    if (diff.added) counts.push(`+${diff.added}`);
    if (diff.removed) counts.push(`-${diff.removed}`);
    const noun = diff.added + diff.removed === 1 ? "line" : "lines";
    return `${counts.join("/")} ${noun}`;
  };

  const parts: string[] = [];
  const css = lines(params.oldTokensCss, params.newTokensCss);
  if (css) parts.push(`tokens.css ${css}`);
  const md = lines(params.oldDesignMd, params.newDesignMd);
  if (md) parts.push(`DESIGN.md ${md}`);

  // Reachable: an assets-only edit changes the row without touching either
  // file, and that is still a new version.
  if (parts.length === 0) return "No changes to DESIGN.md or tokens.css";
  return parts.join(", ");
}
