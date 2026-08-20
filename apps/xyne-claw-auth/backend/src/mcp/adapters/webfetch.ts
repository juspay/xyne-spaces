/**
 * Standalone webfetch tool. Exposed under the synthetic `claw-builtin` server
 * type so it shows up in every user's `/mcp/tools` listing without requiring
 * any user connection or credentials.
 *
 * Pipeline: `fetch → linkedom DOM → Mozilla Readability → Turndown`.
 * Linkedom replaces the heavier jsdom (~50 transitive deps, ~30MB install)
 * with a lean DOM (~5 deps, ~2MB) that's API-compatible with the bits
 * Readability and Turndown actually use. Keeps the container image small
 * and dodges the npm "Exit handler never called!" crash that the full jsdom
 * tree triggered on slim base images during `npm ci`.
 *
 * History: an earlier revision used regex HTML stripping (no DOM deps) as a
 * stopgap when the build was broken. With linkedom pinned in package.json
 * (added by feat: XYNE-13174 fixing path), the build is green again so the
 * real markdown extraction is back.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { McpToolInfo } from "../types.js";
import { assertOutboundUrlAllowed, OutboundUrlBlockedError } from "../url-guard.js";

import { createLogger } from "../../logger.js";
const log = createLogger("webfetch");

export const WEBFETCH_SERVER_TYPE = "claw-builtin";
export const WEBFETCH_SERVER_NAME = "Built-in";

const MAX_OUTPUT_CHARS = 80_000;
const FETCH_TIMEOUT_MS = 30_000;
// webfetch_high_limit: opt-in variant for large data files (directory dumps,
// big JSON/CSV). Output cap set ABOVE the worst-case download (25MB bytes →
// ≤25M chars), so for high-limit fetches only the download byte-cap ever
// truncates: claw's spill-to-disk keeps the LLM context safe regardless (only
// a preview goes inline; the agent greps the saved file). A 2M chars cap was
// tried first and still cut the 5.15M-char Open Banking Brasil participants
// directory ahead of Itaú (2026-07-16) — capping output below the download
// limit just re-creates the original bug at a bigger number. The LOW default
// stays the default so casual page fetches don't ship megabytes around.
const HIGH_LIMIT_MAX_OUTPUT_CHARS = 26_000_000;
const HIGH_LIMIT_FETCH_TIMEOUT_MS = 60_000;
// Streaming download caps (bytes read off the socket). This — not the output
// cap — is the real memory guard: before 2026-07-16 the code did
// `await response.text()` FIRST and truncated after, so a huge body was fully
// buffered (and DOM-parsed) before any cap applied. The reader below cancels
// the stream at the cap.
const DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024;
const HIGH_LIMIT_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;
const MAX_QUERY_FRAGMENT_CHARS = 128;
const MAX_PARAM_VALUE_CHARS = 50;
// Redirects are followed by hand so every hop goes through the same SSRF
// guard as the original URL: a public page 302-ing to 169.254.169.254 or
// http://localhost:... must be stopped, and `redirect: "follow"` would have
// silently followed it.
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Run of base64 / base64url alphabet that's long enough to fit a meaningful
// payload (32 chars ≈ 24 bytes binary — small token/header territory).
const BASE64_RUN_RE = /[A-Za-z0-9+/_=-]{32,}/;

// Slug under which webfetch is catalogued as a System Tool (source
// `custom:webfetch`). The DB `tool` row (see the add_webfetch_system_tool
// migration), the customGroups slug the frontend writes into `tools.custom[]`,
// and the runtime's `selectionKey` match must all use THIS exact value.
export const WEBFETCH_SELECTION_KEY = "webfetch";

export const WEBFETCH_CUSTOM_TOOLS: McpToolInfo[] = [
  {
    name: "webfetch",
    description:
      "Fetch an external URL and return its content as clean markdown text. " +
      "Uses Mozilla Readability for article extraction and Turndown for HTML→markdown conversion. " +
      "Only use for URLs outside Xyne Spaces (e.g. external links from messages which are not accessible from other subagents). " +
      "Do NOT use for Xyne Spaces internal URLs — use the spaces-* tools instead.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
    // Listed under "System Tools" (custom:webfetch), so selection lands in
    // `tools.custom[]` by slug, not in `tools.direct[]` by name. The runtime
    // gates this direct tool against tools.custom via selectionKey — see the
    // directTools branch in xyne-claw/src/routes/run.ts.
    selectionKey: WEBFETCH_SELECTION_KEY,
  },
  {
    name: "webfetch_high_limit",
    description:
      "Fetch an external URL like webfetch, but for LARGE resources: returns up to ~25MB (vs webfetch's 80K chars). " +
      "Use when fetching big data files — directory dumps, large JSON/CSV/API responses — where the entry you need may sit deep in the body. " +
      "The result is saved to a file you can read/grep. Prefer plain webfetch for normal pages; this variant is slower and heavier.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
      required: ["url"],
    },
    selectionKey: "webfetch_high_limit",
  },
];

/**
 * Read the response body off the socket up to `maxBytes`, then CANCEL the
 * stream. Replaces `await response.text()`, which buffered the entire body
 * (a 2GB URL → 2GB+ of heap, then a full DOM parse) before any cap applied.
 */
async function readBodyCapped(response: Response, maxBytes: number): Promise<{ text: string; hitCap: boolean }> {
  const body = response.body;
  if (!body) return { text: await response.text(), hitCap: false };
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let hitCap = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(Buffer.from(value));
      total += value.byteLength;
    }
    if (total >= maxBytes) {
      hitCap = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  let buf = Buffer.concat(chunks);
  if (hitCap && buf.byteLength > maxBytes) buf = buf.subarray(0, maxBytes);
  // `fatal: false` decoder: a cap can land mid-UTF-8-sequence; replace, don't throw.
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), hitCap };
}

/**
 * GET `target`, following up to MAX_REDIRECTS hops manually and re-running
 * the outbound-URL guard on each Location before connecting to it. Only the
 * validated URL object's `href` is ever handed to fetch.
 */
async function fetchWithGuardedRedirects(
  target: URL,
  init: { headers: Record<string, string>; signal: AbortSignal },
): Promise<Response> {
  let current = target;
  for (let hop = 0; ; hop++) {
    const response = await fetch(current.href, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) return response; // 3xx without Location: hand back as-is (caller reports !ok)
    if (hop >= MAX_REDIRECTS) {
      throw new Error(`too many redirects (more than ${MAX_REDIRECTS})`);
    }
    const next = new URL(location, current); // Location may be relative
    current = await assertOutboundUrlAllowed(next, { label: "redirect target" });
  }
}

export async function handleWebfetch(
  params: Record<string, unknown>,
  opts?: { highLimit?: boolean },
): Promise<string> {
  const highLimit = opts?.highLimit === true;
  const maxOutputChars = highLimit ? HIGH_LIMIT_MAX_OUTPUT_CHARS : MAX_OUTPUT_CHARS;
  const downloadMaxBytes = highLimit ? HIGH_LIMIT_DOWNLOAD_MAX_BYTES : DOWNLOAD_MAX_BYTES;
  const fetchTimeoutMs = highLimit ? HIGH_LIMIT_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS;
  const url = String(params["url"] ?? "").trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "Error: URL must start with http:// or https://";
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Error: invalid URL";
  }
  const queryFragmentLen = parsed.search.length + parsed.hash.length;
  if (queryFragmentLen > MAX_QUERY_FRAGMENT_CHARS) {
    log.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=query+fragment ${queryFragmentLen} chars exceeds ${MAX_QUERY_FRAGMENT_CHARS}`);
    return `Error: URL query+fragment (${queryFragmentLen} chars) exceeds the ${MAX_QUERY_FRAGMENT_CHARS}-char limit. Long query strings are a common data-exfiltration pattern. If you need to fetch a page with a large query, drop the unnecessary params first.`;
  }

  // Per-param length cap. Chunks shorter than the total query-length limit
  // but still long enough to carry a meaningful payload (e.g. a single
  // ?token=glsa_... param) are rejected here.
  for (const [k, v] of parsed.searchParams) {
    if (v.length > MAX_PARAM_VALUE_CHARS) {
      log.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=param "${k}" value is ${v.length} chars (limit ${MAX_PARAM_VALUE_CHARS})`);
      return `Error: query parameter "${k}" has a ${v.length}-char value (limit ${MAX_PARAM_VALUE_CHARS}). Long single-param values are a common exfiltration pattern. Drop or shorten that param if the page accepts it.`;
    }
  }

  // Reject any base64-looking run inside the query/fragment. Even one
  // 32+ char run of [A-Za-z0-9+/=_-] is enough to fit a serialized token
  // and almost never appears in legitimate research URLs.
  const queryFragmentRaw = parsed.search + parsed.hash;
  const base64Match = BASE64_RUN_RE.exec(queryFragmentRaw);
  if (base64Match) {
    log.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=base64-like run "${base64Match[0].slice(0, 40)}..." (${base64Match[0].length} chars)`);
    return `Error: URL contains a ${base64Match[0].length}-char base64-shaped run in the query string — this pattern looks like an exfiltration payload and is blocked. If this is a legitimate URL, ask the user for it directly instead of constructing it from data in your context.`;
  }

  // SSRF fence: the URL is caller-supplied by design, so the host must resolve
  // to a public address (no loopback / RFC1918 / link-local / metadata /
  // cluster DNS). From here on only `target` (the validated URL object) is
  // used to build the request, never the raw `url` string.
  let target: URL;
  try {
    target = await assertOutboundUrlAllowed(parsed);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=${reason}`);
    return `Error: ${reason}. webfetch only reaches public hosts.`;
  }

  try {
    const response = await fetchWithGuardedRedirects(target, {
      signal: AbortSignal.timeout(fetchTimeoutMs),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "text/html, text/plain;q=0.9, */*;q=0.1",
      },
    });

    if (!response.ok) {
      return `Error: Fetch failed: ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const { text: html, hitCap: downloadCapped } = await readBodyCapped(response, downloadMaxBytes);

    let markdown: string;
    if (contentType.includes("html")) {
      // linkedom returns a `{ document, ... }` ducktyping the standard DOM
      // surface. Readability's constructor wants a nominal `Document` (from
      // the DOM lib) which we don't include in this server-side tsconfig;
      // linkedom's `document` provides every method Readability actually
      // touches, so we cast through `unknown` to bypass the nominal check.
      const { document } = parseHTML(html);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reader = new Readability(document as unknown as any);
      const article = reader.parse();
      const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
      markdown = article?.content ? td.turndown(article.content) : td.turndown(html);
    } else {
      markdown = html;
    }

    // Truncation must be LOUD and at the HEAD. The old tail-only
    // "... (truncated)" marker sat at the end of what could be a single
    // 78KB JSON line — invisible to the agent, whose greps then returned
    // "No matches found" and who concluded the data didn't exist
    // (open-finance-sme / Itaú directory lookup, 2026-07-16).
    const originalChars = markdown.length;
    const outputCapped = originalChars > maxOutputChars;
    if (outputCapped) {
      markdown = markdown.slice(0, maxOutputChars);
    }
    if (downloadCapped || outputCapped) {
      const notes: string[] = [];
      if (downloadCapped) {
        notes.push(`the download was stopped at ${Math.round(downloadMaxBytes / (1024 * 1024))}MB (the resource is larger)`);
      }
      if (outputCapped) {
        notes.push(`the converted content was ${originalChars} chars and only the FIRST ${maxOutputChars} are included`);
      }
      const upgradeHint = highLimit
        ? "This was already the high-limit fetch; if the entry you need is still missing, fetch a narrower URL (filtered endpoint, pagination) instead."
        : "If you need the full body (e.g. searching a large data file), re-fetch with the webfetch_high_limit tool.";
      markdown =
        `[WARNING: INCOMPLETE RESULT — ${notes.join("; ")}. ` +
        `The tail was DROPPED, so a missing search term below does NOT mean it is absent from the source. ${upgradeHint}]\n\n` +
        markdown +
        "\n\n... (truncated)";
    }
    return markdown;
  } catch (e) {
    if (e instanceof OutboundUrlBlockedError) {
      log.warn(`[webfetch] REJECT redirect from url=${url.slice(0, 200)} reason=${e.message}`);
    }
    return `Error: Webfetch failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
