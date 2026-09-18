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
import { errMsg } from "../../lib/errors.js";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { McpToolInfo } from "../types.js";
import { WEBFETCH_HOST_SERVER_PREFIX, authenticatedFetch, type AuthenticatedFetchContext } from "../../lib/host-credentials.js";
import { SafeFetchError, TRUNCATED_HEADER } from "../../lib/safe-fetch.js";
import { authRequiredToolMessage, type AuthRequiredDetail } from "xyne-claw-shared";

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
// Run of base64 / base64url alphabet that's long enough to fit a meaningful
// payload (32 chars ≈ 24 bytes binary — small token/header territory).
const BASE64_RUN_RE = /[A-Za-z0-9+/_=-]{32,}/;
// Readability mis-detection guard (see the HTML branch below). Only applied to
// pages with real text, so a genuinely short article is never second-guessed.
const MIN_TEXT_FOR_EXTRACTION_CHECK = 2_000;
/** Above this, a page with a password field is a real page that also has a login box. */
const LOGIN_WALL_MAX_TEXT = 3_000;
/** Below this, a 200 produced no readable content worth calling a result. */
const EMPTY_EXTRACTION_MAX_CHARS = 200;
/** Enough HTML to be a real document, so emptiness is about rendering, not size. */
const SPA_SHELL_MIN_HTML = 1_000;
/** A URL that names itself as sign-in. Used to read a redirect loop's last hop. */
const LOGIN_URL_RE = /\/(login|signin|sign-in|sso|saml|oauth2?|auth|authorize|idp|adfs|session)\b|[?&](redirect_uri|returnurl|return_to|next|service)=/i;
const MIN_ARTICLE_TEXT_RATIO = 0.1;

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
 * A 401/403 that a DIFFERENT credential cannot fix: the endpoint does not
 * support that token TYPE at all. Raising a Connect card here would build a
 * loop — the user reconnects, the run resumes, it fails identically.
 */
const NON_ACTIONABLE_AUTH_FAILURES: readonly RegExp[] = [
  /resource not accessible by personal access token/i,
  /resource not accessible by integration/i,
];

function isNonActionableAuthFailure(body: string): boolean {
  return NON_ACTIONABLE_AUTH_FAILURES.some((re) => re.test(body));
}

/**
 * Turn a non-OK status into something the model can act on. A 401/403 has three
 * causes worth distinguishing, each implying a different next move: connect the
 * account, re-scope the existing connection, or stop.
 */
function describeFetchFailure(
  status: number,
  statusText: string,
  body: string,
  attached: { serverType: string } | null,
  credentialRejected: { serverType: string } | null,
  missingConnector: { serverType: string; label: string } | null,
): string {
  const base = `Error: Fetch failed: ${status} ${statusText}`.trimEnd();
  if (status !== 401 && status !== 403) return base;

  // The origin's body is the only place the real reason appears.
  const reason = body.trim() ? `\n\nWhat the server said:\n${body.trim().slice(0, 600)}` : "";

  if (missingConnector) {
    return (
      `${base}${reason}\n\nThis URL needs authentication and you are not connected to ${missingConnector.label}. ` +
      `Ask the user to connect ${missingConnector.label}, then retry this exact URL — the credential is attached ` +
      `automatically once the connection exists. Until they do, STOP: do not retry this URL, do not route it through ` +
      `a proxy, and do not try a container or browser — every other path hits the same wall.`
    );
  }

  if (credentialRejected) {
    return (
      `${base}${reason}\n\nYour ${credentialRejected.serverType} connection was used and refused, AND an anonymous retry ` +
      `(no credential) also failed — so this is not the connector getting in the way. The resource genuinely needs access ` +
      `the connected credential does not have: a token scoped to other repositories/projects, an expired or SSO-unauthorised ` +
      `token, or an endpoint restricted to admins/collaborators. STOP and tell the user exactly which permission is missing ` +
      `so they can reconnect ${credentialRejected.serverType} with the right scope. Do not retry, proxy, or shell out.`
    );
  }

  if (attached) {
    return (
      `${base}${reason}\n\nYour ${attached.serverType} connection was used for this request and the server refused it. ` +
      `STOP and tell the user which permission is missing so they can reconnect ${attached.serverType}.`
    );
  }

  return (
    `${base}${reason}\n\nThis URL requires authentication and nothing is configured for its host, so the request went out ` +
    `anonymous. CALL THE \`request-access\` TOOL NOW with this URL and one line on what you were doing — that asks the user ` +
    `for access and restarts this task automatically once they grant it. Do not retry the URL, do not try a proxy, mirror, ` +
    `container or browser, and do not report failure without calling it: every other path gets the same ${status}.`
  );
}

/**
 * Does a 200 look like a sign-in page rather than what we asked for? No status
 * code catches this: measured on an internal host, `/projects` answers
 * 302 → `/login` → 200 with a login form, and the agent summarises that as the
 * answer. The signal is a password field plus short extracted text, which
 * separates a login wall from an article about logging in.
 */
function looksLikeLoginWall(html: string, extractedText: string): boolean {
  if (extractedText.length > LOGIN_WALL_MAX_TEXT) return false;
  if (!/<input[^>]+type\s*=\s*["']?password/i.test(html)) return false;
  return /log\s?in|sign\s?in|password|authenticate/i.test(extractedText) ||
    /<title[^>]*>[^<]*(log\s?in|sign\s?in)/i.test(html);
}

export interface WebfetchResult {
  /** What the model sees. */
  content: string;
  /**
   * Set when the fetch was blocked by a credential the user can supply. Travels
   * out of the run so claw-auth can post a card and resume on grant — the model
   * is not trusted to relay it.
   */
  authRequired?: AuthRequiredDetail;
}

export async function handleWebfetch(
  params: Record<string, unknown>,
  opts?: { highLimit?: boolean } & AuthenticatedFetchContext,
): Promise<WebfetchResult> {
  const highLimit = opts?.highLimit === true;
  const maxOutputChars = highLimit ? HIGH_LIMIT_MAX_OUTPUT_CHARS : MAX_OUTPUT_CHARS;
  const downloadMaxBytes = highLimit ? HIGH_LIMIT_DOWNLOAD_MAX_BYTES : DOWNLOAD_MAX_BYTES;
  const fetchTimeoutMs = highLimit ? HIGH_LIMIT_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS;
  const url = String(params["url"] ?? "").trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { content: "Error: URL must start with http:// or https://" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { content: "Error: invalid URL" };
  }
  const queryFragmentLen = parsed.search.length + parsed.hash.length;
  if (queryFragmentLen > MAX_QUERY_FRAGMENT_CHARS) {
    log.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=query+fragment ${queryFragmentLen} chars exceeds ${MAX_QUERY_FRAGMENT_CHARS}`);
    return { content: `Error: URL query+fragment (${queryFragmentLen} chars) exceeds the ${MAX_QUERY_FRAGMENT_CHARS}-char limit. Long query strings are a common data-exfiltration pattern. If you need to fetch a page with a large query, drop the unnecessary params first.` };
  }

  // Per-param length cap. Chunks shorter than the total query-length limit
  // but still long enough to carry a meaningful payload (e.g. a single
  // ?token=glsa_... param) are rejected here.
  for (const [k, v] of parsed.searchParams) {
    if (v.length > MAX_PARAM_VALUE_CHARS) {
      log.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=param "${k}" value is ${v.length} chars (limit ${MAX_PARAM_VALUE_CHARS})`);
      return { content: `Error: query parameter "${k}" has a ${v.length}-char value (limit ${MAX_PARAM_VALUE_CHARS}). Long single-param values are a common exfiltration pattern. Drop or shorten that param if the page accepts it.` };
    }
  }

  // Reject any base64-looking run inside the query/fragment. Even one
  // 32+ char run of [A-Za-z0-9+/=_-] is enough to fit a serialized token
  // and almost never appears in legitimate research URLs.
  const queryFragmentRaw = parsed.search + parsed.hash;
  const base64Match = BASE64_RUN_RE.exec(queryFragmentRaw);
  if (base64Match) {
    log.warn(`[webfetch] REJECT url=${url.slice(0, 200)} reason=base64-like run "${base64Match[0].slice(0, 40)}..." (${base64Match[0].length} chars)`);
    return { content: `Error: URL contains a ${base64Match[0].length}-char base64-shaped run in the query string — this pattern looks like an exfiltration payload and is blocked. If this is a legitimate URL, ask the user for it directly instead of constructing it from data in your context.` };
  }

  try {
    // safeFetch owns redirect following, DNS pinning, the private-address deny
    // list, and dropping `Authorization` on a cross-origin hop — which is why
    // the hand-rolled redirect loop had to go: it had no credential to strip.
    const { response, host, attached, missingConnector, credentialRejected } = await authenticatedFetch(
      url,
      { ...(opts?.userId ? { userId: opts.userId } : {}), ...(opts?.agentSlug ? { agentSlug: opts.agentSlug } : {}) },
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          Accept: "text/html, text/plain;q=0.9, */*;q=0.1",
        },
      },
      {
        timeoutMs: fetchTimeoutMs,
        maxResponseBytes: downloadMaxBytes,
        // webfetch's contract: over the cap is TRUNCATED with a loud warning,
        // never an outright failure.
        truncateOversizeBody: true,
      },
    );

    if (!response.ok) {
      // Already buffered under the cap — a memory read, not a round trip.
      const errorBody = await response.text().catch(() => "");
      const isAuthStatus = response.status === 401 || response.status === 403;

      // A blocker the user can clear: not connected, or connected and refused
      // where anonymous failed too. Both get a card and an automatic resume.
      const blocker = missingConnector
        ? { serverType: missingConnector.serverType, label: missingConnector.label, reason: "not_connected" as const }
        : credentialRejected
          ? {
              serverType: credentialRejected.serverType,
              // `webfetch-host:<host>` is an internal key; the host is the
              // name the user recognises.
              label: credentialRejected.serverType.startsWith(WEBFETCH_HOST_SERVER_PREFIX)
                ? host || parsed.hostname
                : credentialRejected.serverType,
              reason: "rejected" as const,
            }
          : // Nothing configured for this host: offer to bind a credential to
            // it, the generic path for internal services.
            host
            ? { serverType: `webfetch-host:${host}`, label: host, reason: "unknown_host" as const }
            : null;

      // A credential the user cannot improve: report and stop.
      if (isAuthStatus && isNonActionableAuthFailure(errorBody)) {
        log.info(`[webfetch] non-actionable ${response.status} host=${parsed.hostname} — no auth card raised`);
        return {
          content:
            `Error: Fetch failed: ${response.status} ${response.statusText}\n\n` +
            `What ${parsed.hostname} said:\n${errorBody.trim().slice(0, 400)}\n\n` +
            `This endpoint is not available to the credential type that is connected, and RECONNECTING WILL NOT HELP — ` +
            `it is a limitation of the token type, not a missing permission. Do not ask the user to reconnect. ` +
            `Tell them this specific endpoint is unavailable, and look for a documented alternative endpoint that exposes ` +
            `the same information (the message above often links one).`,
        };
      }

      if (isAuthStatus && blocker) {
        const detail: AuthRequiredDetail = {
          serverType: blocker.serverType,
          providerLabel: blocker.label,
          reason: blocker.reason,
          host: host || parsed.hostname,
          url,
          source: "status",
        };
        const serverSaid = errorBody.trim() ? `\n\nWhat ${parsed.hostname} said:\n${errorBody.trim().slice(0, 400)}` : "";
        log.info(`[webfetch] auth_required host=${parsed.hostname} type=${detail.serverType} reason=${detail.reason}`);
        return { content: `${authRequiredToolMessage(detail)}${serverSaid}`, authRequired: detail };
      }

      return {
        content: describeFetchFailure(
          response.status,
          response.statusText,
          errorBody,
          attached,
          credentialRejected,
          missingConnector,
        ),
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const { text: html, hitCap: readCapped } = await readBodyCapped(response, downloadMaxBytes);
    // safeFetch already stopped at the cap when it truncated; readBodyCapped
    // then sees a short body and reports no cap of its own. Either signal means
    // the tail is missing.
    const downloadCapped = readCapped || response.headers.get(TRUNCATED_HEADER) === "1";

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

      /*
       * Readability is an ARTICLE extractor and guesses badly on index and list
       * pages: a 179KB stargazers page came back as 145 characters describing
       * one person, silently. So keep the article only when it plausibly IS the
       * page — a tiny sliver of a substantial document is a mis-detection, and
       * nav chrome beats a fragment the model believes is the whole answer.
       */
      const fullText = (document.body?.textContent ?? "").trim();
      const articleText = (article?.textContent ?? "").trim();
      const misdetected =
        fullText.length > MIN_TEXT_FOR_EXTRACTION_CHECK &&
        articleText.length < fullText.length * MIN_ARTICLE_TEXT_RATIO;
      if (misdetected) {
        log.info(
          `[webfetch] readability kept ${articleText.length}/${fullText.length} chars for ${parsed.hostname} — treating as a list/index page, using the full document`,
        );
      }
      if (article?.content && !misdetected) {
        markdown = td.turndown(article.content);
      } else {
        // Strip non-content nodes first: turndown inlines every <script> and
        // <style> body, which would eat the output cap with bundler junk.
        for (const sel of ["script", "style", "noscript", "svg", "template", "link", "meta"]) {
          for (const node of Array.from(document.querySelectorAll(sel)) as Array<{ remove: () => void }>) node.remove();
        }
        markdown = td.turndown(document.body?.innerHTML ?? html);
      }
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
    // Prepended rather than substituted: the content still reaches the model,
    // which can overrule the guess if the page really is about logging in.
    if (looksLikeLoginWall(html, markdown)) {
      log.info(`[webfetch] 200 looks like a login wall host=${parsed.hostname}`);
      markdown =
        `[THIS LOOKS LIKE A SIGN-IN PAGE, NOT THE CONTENT YOU ASKED FOR — ${parsed.hostname} appears to want ` +
        `the user's login. If that is what you are seeing below, CALL THE \`request-access\` TOOL with this URL ` +
        `and one line on what you were after. Do NOT answer from this page, and do NOT report that the data is ` +
        `missing or empty — you are logged out, not looking at an empty resource. Granting access restarts this ` +
        `task automatically.]\n\n` +
        markdown;
    }
    /*
     * A 200 that yielded nothing readable. Returning an empty string is the
     * most harmful thing this tool can do: the agent cannot tell "genuinely
     * empty" from "logged out" from "JavaScript app", and only one of those is
     * fixable by credentials — a SPA returns the same shell to a perfectly
     * authenticated request. So say which one this looks like.
     *
     * Scoped to HTML: `{"stars":153}` is a good API answer at 13 characters,
     * and emptiness only carries meaning where extraction happens.
     */
    const readableChars = markdown.trim().length;
    const nothingReadable = contentType.includes("html")
      ? readableChars < EMPTY_EXTRACTION_MAX_CHARS && html.length > SPA_SHELL_MIN_HTML
      : readableChars === 0;

    if (nothingReadable) {
      const looksLikeApp =
        html.length > SPA_SHELL_MIN_HTML &&
        /<div[^>]+id=["'](root|app|__next)["']|<base\s+href=|window\.__(INITIAL|NUXT|NEXT)/i.test(html);
      log.info(
        `[webfetch] ${response.status} with ${readableChars} readable chars host=${parsed.hostname} spa=${looksLikeApp}`,
      );
      const why = looksLikeApp
        ? `That page is a JAVASCRIPT APPLICATION: the HTML is just an empty shell and the content is drawn by ` +
          `script after loading, so fetching it returns nothing no matter who you are logged in as. ` +
          `Credentials will NOT fix this — do not ask for them for this URL. Look for the API endpoint the ` +
          `app itself calls (often under /api/, /rest/ or similar) and fetch that instead, or tell the user ` +
          `this page can only be read in a browser.`
        : `The response was ${response.status} but contained nothing readable. That usually means one of: ` +
          `you are logged out and were served a near-empty shell; the content is drawn by script; or the ` +
          `resource really is empty. If being logged out would explain it, call the \`request-access\` tool ` +
          `with this URL. Do NOT report this as "no data" without saying the page came back blank.`;
      return { content: `[NO READABLE CONTENT at ${url}]\n\n${why}` };
    }

    return { content: markdown };
  } catch (e) {
    if (e instanceof SafeFetchError) {
      /*
       * A redirect loop is usually a login flow. This fetch carries no cookies
       * between hops, so a chain trying to ESTABLISH a session can never
       * converge — each hop sets a cookie the next never receives.
       *
       * Where the chain ENDED separates the cases: a login/sso/auth URL is
       * strong enough to raise a card, anything else only earns a suggestion,
       * because a misconfigured public page loops too.
       */
      if (e.code === "too-many-redirects") {
        const endedAt = e.url || url;
        const looksLikeLogin = LOGIN_URL_RE.test(endedAt);
        const host = parsed.hostname.toLowerCase();
        const where = endedAt && endedAt !== url ? ` It ended at ${endedAt}.` : "";

        if (looksLikeLogin) {
          const detail: AuthRequiredDetail = {
            serverType: `webfetch-host:${host}`,
            providerLabel: host,
            reason: "unknown_host",
            host,
            url,
            source: "status",
          };
          log.info(`[webfetch] redirect loop into a login flow host=${host} ended=${endedAt}`);
          return {
            content:
              `${authRequiredToolMessage(detail)}\n\n` +
              `The request bounced between redirects without ever settling, and the chain ends on a ` +
              `sign-in URL — that is a login flow this fetch cannot complete on its own.${where}`,
            authRequired: detail,
          };
        }
        return {
          content:
            `Error: Fetch failed: the request redirected in a loop and never settled.${where}\n\n` +
            `This often means the URL needs ${host} to recognise you and is bouncing you through a ` +
            `sign-in it cannot finish. If that fits what you were doing, call the \`request-access\` ` +
            `tool with this URL so the user can grant access. If instead the URL simply looks wrong, ` +
            `say so — do not retry it, the loop is deterministic.`,
        };
      }
      return { content: `Error: Fetch refused: the URL ${e.message} (${e.code}). This is a destination policy, not a transient failure — do not retry it.` };
    }
    return { content: `Error: Webfetch failed: ${errMsg(e)}` };
  }
}
