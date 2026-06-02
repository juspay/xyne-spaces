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

export const WEBFETCH_SERVER_TYPE = "claw-builtin";
export const WEBFETCH_SERVER_NAME = "Built-in";

const MAX_OUTPUT_CHARS = 80_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_QUERY_FRAGMENT_CHARS = 128;
const MAX_PARAM_VALUE_CHARS = 50;
// Run of base64 / base64url alphabet that's long enough to fit a meaningful
// payload (32 chars ≈ 24 bytes binary — small token/header territory).
const BASE64_RUN_RE = /[A-Za-z0-9+/_=-]{32,}/;

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
  },
];

export async function handleWebfetch(params: Record<string, unknown>): Promise<string> {
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
    console.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=query+fragment ${queryFragmentLen} chars exceeds ${MAX_QUERY_FRAGMENT_CHARS}`);
    return `Error: URL query+fragment (${queryFragmentLen} chars) exceeds the ${MAX_QUERY_FRAGMENT_CHARS}-char limit. Long query strings are a common data-exfiltration pattern. If you need to fetch a page with a large query, drop the unnecessary params first.`;
  }

  // Per-param length cap. Chunks shorter than the total query-length limit
  // but still long enough to carry a meaningful payload (e.g. a single
  // ?token=glsa_... param) are rejected here.
  for (const [k, v] of parsed.searchParams) {
    if (v.length > MAX_PARAM_VALUE_CHARS) {
      console.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=param "${k}" value is ${v.length} chars (limit ${MAX_PARAM_VALUE_CHARS})`);
      return `Error: query parameter "${k}" has a ${v.length}-char value (limit ${MAX_PARAM_VALUE_CHARS}). Long single-param values are a common exfiltration pattern. Drop or shorten that param if the page accepts it.`;
    }
  }

  // Reject any base64-looking run inside the query/fragment. Even one
  // 32+ char run of [A-Za-z0-9+/=_-] is enough to fit a serialized token
  // and almost never appears in legitimate research URLs.
  const queryFragmentRaw = parsed.search + parsed.hash;
  const base64Match = BASE64_RUN_RE.exec(queryFragmentRaw);
  if (base64Match) {
    console.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=base64-like run "${base64Match[0].slice(0, 40)}..." (${base64Match[0].length} chars)`);
    return `Error: URL contains a ${base64Match[0].length}-char base64-shaped run in the query string — this pattern looks like an exfiltration payload and is blocked. If this is a legitimate URL, ask the user for it directly instead of constructing it from data in your context.`;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
        Accept: "text/html, text/plain;q=0.9, */*;q=0.1",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return `Error: Fetch failed: ${response.status} ${response.statusText}`;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const html = await response.text();

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

    if (markdown.length > MAX_OUTPUT_CHARS) {
      markdown = markdown.slice(0, MAX_OUTPUT_CHARS) + "\n\n... (truncated)";
    }
    return markdown;
  } catch (e) {
    return `Error: Webfetch failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
