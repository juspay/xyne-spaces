/**
 * Citation sanitizer — post-processes an agent's FINAL response text so the
 * citation tokens that get persisted (DB body, GCS marker, done frame) are
 * trustworthy. Applied once at the run choke point (run.ts `callbackResultText`).
 *
 * What it does, against the set of clf tokens a tool ACTUALLY emitted this turn:
 *   • keeps a well-formed `[clf-<toolid>#<n>]` only when that exact token is real
 *     (otherwise removes it — the model hallucinated a source);
 *   • normalizes the malformed / off-format shapes the model sometimes emits to
 *     the canonical `[clf-…]` form WHEN a matching real citation exists:
 *       - other brackets   `(clf-…)` `{clf-…}` `<clf-…>` `【clf-…】` `⟦clf-…⟧`
 *       - no brackets       bare `clf-id#n`
 *       - legacy link       `[1.0](cite:clf-…#0)`  → `[clf-…#0]`
 *       - range             `[clf-id#3-#5]`        → `[clf-id#3] [clf-id#4] …`
 *       - label / ordinal   `[Image #1]` `[Source 2]` → the 1st / 2nd real token
 *   • removes unbacked/unmappable citation-intent tokens.
 *
 * Forms carrying an explicit clf id match by IDENTITY against the real tokens —
 * zero false-positive risk — and are emitted in their CANONICAL (tool-output)
 * casing. Label/ordinal forms carry no id, so they map by ORDINAL into the
 * tokens in first-appearance order; unresolvable ordinals are dropped, and bare
 * `[#n]` is only rewritten when it resolves (never stripped — it could be a
 * genuine reference).
 *
 * Pure + idempotent. Code blocks and inline code are never touched (a response
 * may quote a token verbatim as an example — see the CITATION_GUIDE).
 */
import type { ToolInvocation } from "./agent.js";

// toolid char class — excludes #, whitespace, and square brackets (matches the
// canonical CLF_TOKEN_RE in auto-citations.ts / agent.ts / subagent-tools.ts).
const TOOLID = String.raw`[^#\s\[\]]+`;
// Stricter toolid for the bracket-less scan — also excludes every bracket kind
// so a bare match can't run past a delimiter.
const BARE_TOOLID = String.raw`[^#\s\[\](){}<>【】⟦⟧]+`;
// Global scan for canonical square-bracket tokens (build the valid set).
const CLF_TOKEN_G = () => new RegExp(String.raw`\[clf-${TOOLID}#\d+\]`, "gi");

export interface ValidClf {
  /** Distinct real clf tokens in first-appearance order (canonical casing). */
  ordered: string[];
  /** normalized(token) → the real token as it appeared in tool output. Keys are
   *  the identity-lookup set; values are what we emit (canonical casing). */
  canonical: Map<string, string>;
}

const norm = (t: string): string => t.toLowerCase();

/**
 * The clf tokens that genuinely exist this turn — collected by scanning each
 * tool invocation's RESULT text (not reconstructed from toolCallId+chunkIndex,
 * because a subagent's child tokens are appended into the WRAPPER's result text
 * under a different id, so only a text scan catches them).
 */
export function buildValidClfTokens(
  toolInvocations: ToolInvocation[] | undefined,
  /** Extra real tokens from EARLIER turns in the same session (see
   *  {@link extractSessionClfTokens}). A follow-up turn can legitimately re-cite
   *  a chunk produced by a tool call in a previous turn; without these, that
   *  cross-turn token has no match this turn and gets stripped as hallucinated. */
  extraValidTokens?: readonly string[],
): ValidClf {
  const ordered: string[] = [];
  const canonical = new Map<string, string>();
  const add = (tok: string): void => {
    const n = norm(tok);
    if (!canonical.has(n)) {
      canonical.set(n, tok);
      ordered.push(tok);
    }
  };
  // Current turn's tool tokens FIRST so `[Image #k]` ordinals map to this turn's
  // sources before any carried-over ones.
  for (const inv of toolInvocations ?? []) {
    const text = typeof inv?.result === "string" ? inv.result : "";
    if (!text) continue;
    for (const m of text.matchAll(CLF_TOKEN_G())) add(m[0]);
  }
  for (const tok of extraValidTokens ?? []) add(tok);
  return { ordered, canonical };
}

/**
 * Collect every distinct canonical `[clf-<id>#n]` token that appears ANYWHERE in
 * a pi session transcript (all prior + current turns' tool outputs). Citations
 * are session-scoped, not turn-scoped: the model re-cites earlier tool chunks in
 * follow-up turns that don't re-run the tool, so those tokens must be recognized
 * as real. Walks arbitrary message shapes (string content, block arrays, nested
 * tool_result blocks) and scans every string value.
 */
export function extractSessionClfTokens(messages: unknown): string[] {
  const found = new Map<string, string>();
  const scan = (text: string): void => {
    if (text.indexOf("clf-") === -1) return;
    for (const m of text.matchAll(CLF_TOKEN_G())) {
      const n = norm(m[0]);
      if (!found.has(n)) found.set(n, m[0]);
    }
  };
  const walk = (v: unknown): void => {
    if (typeof v === "string") { scan(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  if (!Array.isArray(messages)) return [];
  for (const msg of messages) {
    // Valid citation tokens ORIGINATE in tool outputs (tool_result content),
    // never in assistant prose. Skip assistant messages so the model's own
    // (possibly hallucinated) tokens — including the just-finished answer we're
    // about to sanitize — are never treated as "valid". Tool results live in
    // tool/user-role messages, so they're still scanned.
    if (msg && typeof msg === "object" && (msg as Record<string, unknown>)["role"] === "assistant") {
      continue;
    }
    walk(msg);
  }
  return [...found.values()];
}

/** The real token for a candidate `clf-id#n` body, or null if not a real citation. */
function realTokenFor(body: string, canonical: Map<string, string>): string | null {
  return canonical.get(norm(`[${body}]`)) ?? null;
}

/** Rewrite one run of prose (never called on code regions). */
function rewriteProse(prose: string, ordered: string[], canonical: Map<string, string>): string {
  let out = prose;

  // 1. Legacy rendered link `[label](cite:clf-<id>#<n>)` → canonical token or "".
  //    Matches ONLY the literal `](cite:clf-` marker so real markdown links to
  //    URLs are never touched.
  out = out.replace(
    new RegExp(String.raw`\[[^\]]*\]\(cite:(clf-[^#\s\[\]()]+#\d+)\)`, "gi"),
    (_m, inner: string) => realTokenFor(inner, canonical) ?? "",
  );

  // 2. Range `[clf-<id>#a-#b]` / `[clf-<id>#a-b]` → space-joined valid subset.
  out = out.replace(
    new RegExp(String.raw`\[(clf-${TOOLID})#(\d+)\s*-\s*#?(\d+)\]`, "gi"),
    (_m, id: string, aStr: string, bStr: string) => {
      const a = Number(aStr);
      const b = Number(bStr);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 100) return "";
      const kept: string[] = [];
      for (let k = a; k <= b; k++) {
        const real = realTokenFor(`${id}#${k}`, canonical);
        if (real) kept.push(real);
      }
      return kept.join(" ");
    },
  );

  // 3. Any BRACKET VARIANT of a clf token — the model sometimes wraps a citation
  //    in parens / curly / angle / CJK / math brackets: (clf-…) {clf-…} <clf-…>
  //    【clf-…】 ⟦clf-…⟧ — normalize all to the canonical square-bracket form
  //    (tool outputs and the frontend renderer only use `[]`). Keep iff real,
  //    else remove. The `clf-…#n` body is specific enough that ordinary
  //    parentheses never match, and mismatched open/close brackets are healed.
  out = out.replace(
    new RegExp(String.raw`[\[(\{<【⟦](clf-${TOOLID}#\d+)[\])\}>】⟧]`, "gi"),
    (_m, inner: string) => realTokenFor(inner, canonical) ?? "",
  );

  // 3b. BARE token (no brackets at all) `clf-id#n` → canonical `[clf-id#n]` iff
  //     real, else remove. Guarded: the lookbehind rejects a preceding word char
  //     or opening bracket (so an already-bracketed token — handled above — is
  //     skipped), and the lookahead rejects a trailing word char or closing
  //     bracket (partial / already-bracketed).
  out = out.replace(
    new RegExp(String.raw`(?<![\w\[(\{<【⟦])(clf-${BARE_TOOLID}#\d+)(?![\w\])\}>】⟧])`, "gi"),
    (_m, inner: string) => realTokenFor(inner, canonical) ?? "",
  );

  // 4a. Label/ordinal `[Image #1]` / `[Source 2]` / `[Doc 3]` → the k-th real
  //     token (first-appearance order) iff it resolves, else remove. The prefix
  //     allow-list keeps plain footnotes / numbered lists (`[1]`) untouched.
  out = out.replace(
    new RegExp(String.raw`\[(?:Image|Source|Doc|Document|Ref|Reference|Citation|Chunk)\s*#?\s*(\d+)\]`, "gi"),
    (_m, kStr: string) => {
      const k = Number(kStr);
      return k >= 1 && k <= ordered.length ? ordered[k - 1]! : "";
    },
  );

  // 4b. Bare ordinal `[#3]` → the k-th real token iff it resolves; otherwise
  //     LEAVE it (could be a genuine reference like a GitHub issue) — never strip.
  out = out.replace(
    new RegExp(String.raw`\[#\s*(\d+)\]`, "g"),
    (m, kStr: string) => {
      const k = Number(kStr);
      return k >= 1 && k <= ordered.length ? ordered[k - 1]! : m;
    },
  );

  // Tidy up whitespace a removed token leaves behind — WITHOUT disturbing
  // markdown structure (leading indentation for nested lists, or 2-trailing-
  // space hard breaks):
  //   • drop space(s) before punctuation ("… ." → "….");
  //   • collapse a mid-line run of spaces that follows real text and isn't a
  //     line-end hard break (the `(\S)` guard skips leading indentation; the
  //     `(?!\n)` guard skips a trailing-space hard break).
  out = out
    .replace(/ +([.,;:!?)])/g, "$1")
    .replace(/(\S) {2,}(?!\n)/g, "$1 ");
  return out;
}

/**
 * Sanitize citation tokens in `text` against the run's real tool citations.
 * Pure + idempotent. Never rewrites inside fenced or inline code.
 */
export function sanitizeCitations(
  text: string,
  toolInvocations: ToolInvocation[] | undefined,
  extraValidTokens?: readonly string[],
): string {
  if (!text) return text;
  const { ordered, canonical } = buildValidClfTokens(toolInvocations, extraValidTokens);
  // Split into code vs prose — captured code regions land at ODD indices, so
  // only rewrite the even (prose) segments; quoted token examples survive.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = rewriteProse(parts[i]!, ordered, canonical);
  }
  return parts.join("");
}
