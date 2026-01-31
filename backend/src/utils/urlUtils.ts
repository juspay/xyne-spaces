// backend/src/utils/urlUtils.ts
/**
 * URL detection utilities
 *
 * - Strips HTML tags and decodes common HTML entities before running regex.
 * - Matches bare domains (google.com), www-prefixed domains, and http(s) URLs.
 * - Uses a curated list of ~100 common TLDs (expandable).
 *
 * Usage:
 *   extractUrls('<p>google.com</p>') => ['google.com']
 *   extractFirstUrl('<a>https://example.com/foo</a>') => 'https://example.com/foo'
 */

const TOP_TLDS = [
  // global / generic
  "com","org","net","info","biz","io","app","dev","ai","xyz","online","site","tech","cloud","shop","store",
  "blog","live","pro","me","tv","fm","gg","loan","media","design","solutions","systems","agency","network",
  "company","digital","group","software","tools","support","data",

  // country / major
  "us","uk","de","jp","fr","nl","ru","br","au","ca","in","it","es","se","no","fi","be","ch","pl","pt","mx","ar",
  "cl","co","tr","kr","tw","hk","sg","id","my","th","vn","ph","za","eg","ae","sa","il","gr","ie","cz","hu","ro",

  // misc commons
  "edu","gov","mil","int"
];

// Add a few multi-part ccTLDs common in the wild (escaped)
const EXTRA_MULTI_PART_TLDS = ["co\\.uk", "co\\.in", "com\\.au", "com\\.br", "com\\.mx"];

// Build the final TLD group for regex. Escape any dots already present.
const ALL_TLDS = [...TOP_TLDS.map(t => t.replace(/\./g, "\\.")), ...EXTRA_MULTI_PART_TLDS];
const TLD_GROUP = ALL_TLDS.join("|");

/**
 * Remove HTML tags and replace them with spaces (so adjacent words don't glue together).
 * Also performs a lightweight decode of common HTML entities and collapses whitespace.
 */
export function stripAndDecodeHtml(input: string): string {
  if (!input) return "";

  // 1) Remove tags
  let s = input.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<\/?[^>]+>/g, " "); // remove remaining tags

  // 2) Decode common entities (basic, covers majority cases)
  s = s.replace(/&amp;/g, "&")
       .replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'");

  // Numeric entities (decimal & hex)
  s = s.replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)));
  s = s.replace(/&#x([0-9A-Fa-f]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));

  // 3) Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Main regex:
 * - Optional protocol (http/https)
 * - Optional www.
 * - domain/subdomains (letters/digits/hyphen)
 * - a dot + TLD (from curated list), TLD is required
 * - optional path/query/fragment until whitespace or < " ' >
 *
 * We use a negative lookbehind to avoid matching things that look like emails (user@domain)
 * and simple trimming of surrounding punctuation is done after matching.
 */
export const URL_REGEX = new RegExp(
  String.raw`(?<![@\w\/])((?:https?:\/\/)?(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:${TLD_GROUP})(?:\/[^\s<>"')\]]*)?)`,
  "gi"
);

/** Trim leading/trailing punctuation that can get captured in loose contexts. */
function trimSurroundingPunctuation(s: string): string {
  return s.replace(/^[\(\[\<"'“‘\s]+|[\)\]\>\.'"”’\s,:;]+$/g, "");
}

/**
 * Extract all unique URLs from some (possibly HTML) text.
 * Returns array in order of first occurrence.
 */
export function extractUrls(text: string): string[] {
  if (!text) return [];

  const clean = stripAndDecodeHtml(text);
  const matches = [...clean.matchAll(URL_REGEX)].map(m => m[1]);

  if (!matches || matches.length === 0) return [];

  // Trim punctuation and dedupe while preserving first-occurrence order
  const seen = new Set<string>();
  const result: string[] = [];
  for (let raw of matches) {
    const trimmed = trimSurroundingPunctuation(raw);
    if (!trimmed) continue;

    // If protocol missing and it looks like a bare domain, keep as-is (frontend can add https://)
    // Normalize trailing punctuation removed above.
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Extract first URL or null.
 */
export function extractFirstUrl(text: string): string | null {
  const urls = extractUrls(text);
  return urls.length > 0 ? urls[0] : null;
}

/**
 * Validate using native URL parser when possible.
 * If input is a bare domain (no protocol), we attempt to prepend "https://" for validation.
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    // If it's a bare domain (no protocol), try with https://
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url)) {
      new URL(`https://${url}`);
    } else {
      new URL(url);
    }
    return true;
  } catch {
    return false;
  }
}