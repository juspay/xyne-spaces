/**
 * Pure helpers for coverage-gated `/understanding` runs.
 *
 * Kept in their own module — with no config/db/prisma imports — so both the
 * claw-auth start path and the findings endpoint can use them, and so they are
 * testable without booting the service's required-env config.
 */

/** A list is only recognised at this many identifier-shaped lines or more. Two
 *  is more likely a phrase than an enumeration, and guessing wrong would seed a
 *  frontier the user never asked for. */
const MIN_SEED_ITEMS = 3;
/** Guard against a runaway paste becoming thousands of ledger rows. */
const MAX_SEED_ITEMS = 200;
const IDENTIFIER_LINE = /^[A-Za-z_][A-Za-z0-9_.\-/]{1,120}$/;

/**
 * Extract the items named in an understanding run's `focus` text.
 *
 * The coverage gate's weak point is that the MODEL chooses the frontier, and
 * the cheapest way to satisfy "open === 0" is to enumerate less. When the user
 * already named what to cover — a table list, a set of endpoints, a list of
 * services — that enumeration is ground truth, so writing it into the ledger up
 * front removes the model's discretion: it can only close paths, never quietly
 * fail to imagine them.
 *
 * Detection is deliberately conservative: prose focus text yields nothing and
 * the run behaves exactly as it did before.
 */
export function parseFrontierItems(focus: string | null | undefined): string[] {
  if (!focus) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const rawLine of focus.split(/[\n,]/)) {
    // Tolerate list punctuation ("- foo", "* foo", "1. foo", "`foo`").
    const line = rawLine
      .trim()
      .replace(/^[-*•]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/`/g, "")
      .trim();
    if (!IDENTIFIER_LINE.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(line);
    if (items.length >= MAX_SEED_ITEMS) break;
  }
  return items.length >= MIN_SEED_ITEMS ? items : [];
}

/**
 * Does this note carry at least one `path/to/file.ext:LINE` citation?
 *
 * The understanding-run equivalent of the proof-durability gate. Shape only —
 * whether the line really says what the agent claims is the reviewer's job (and
 * a follow-up that resolves citations against the repo). Requiring the SHAPE is
 * still most of the value: it is the difference between "this table stores
 * gateway EMI support" (a restatement of the name, which is the exact failure
 * mode understanding mode exists to prevent) and a claim anchored somewhere a
 * human can go and check.
 */
const CITATION_RE = /[\w./-]+\.[A-Za-z][\w]*:\d+/;

export function hasResolvableCitation(note: unknown): boolean {
  return typeof note === "string" && CITATION_RE.test(note);
}

/**
 * Focus is replayed into EVERY epoch's task prompt, so it stays capped — but the
 * old 1000-char cap silently ate a fifth of a 57-table list and cut mid-token
 * ("reseller_account rese"), so the run explored a scope the user never saw it
 * narrow. Bigger cap, cut on a word boundary, and the dropped remainder is
 * returned so the caller can SAY so instead of discarding input in silence.
 */
const MAX_FOCUS_CHARS = 4000;

export function normalizeFocus(raw: string): { focus?: string; dropped?: string } {
  const value = raw.trim().replace(/^focus=/i, "").trim();
  if (!value) return {};
  if (value.length <= MAX_FOCUS_CHARS) return { focus: value };
  const head = value.slice(0, MAX_FOCUS_CHARS);
  // Never split a token: a half-identifier is worse than an absent one, because
  // it reads as a real name the agent will go looking for.
  const cut = head.lastIndexOf(" ");
  const boundary = cut > MAX_FOCUS_CHARS * 0.8 ? cut : head.length;
  return { focus: value.slice(0, boundary).trim(), dropped: value.slice(boundary).trim() };
}
