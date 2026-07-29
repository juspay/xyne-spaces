/**
 * create-html-report — render a markdown report into a standalone HTML
 * attachment, plus emit a short summary that lands inline in chat.
 *
 * Use case: agents that produce long structured analyses (feedback summaries,
 * incident reports, audit findings, release notes) where the chat thread
 * should stay readable but the user still needs the full report. The tool
 * sidesteps Spaces' 10K-char message cap AND avoids the existing PDF
 * length-fallback path's downsides (no Ctrl+F, awkward on mobile, no
 * syntax-highlighted code blocks, no clickable links across the document).
 *
 * Contract for the agent:
 *   - Provide a `summary` (short, <300 chars recommended) — this is what the
 *     user sees inline in chat. Lead with the key takeaway.
 *   - Provide `detailsMarkdown` — the full report. Markdown is rendered to
 *     HTML server-side with `marked`, sanitized to strip dangerous tags,
 *     and wrapped in a styled standalone document.
 *   - Provide `title` — used for the filename + <h1> + <title>.
 *
 * The runner (xyne-claw/src/custom-tools.ts) recognises the `[ATTACHMENT:...]`
 * marker, peels the base64 HTML off, pushes it through the existing
 * attachment pipeline, and the trailing text (the `summary`) becomes the
 * agent's tool result — which is what surfaces in chat.
 */

import { marked } from "marked";
import type { ToolDefinition } from "../types.js";
import { buildHtmlDocument, sanitizeHtmlBody } from "./template.js";

import { createLogger } from "../../logger.js";
const log = createLogger("tools");

const HTML_MIME = "text/html";

/** Cap input markdown to bound server memory + downstream rendering cost.
 *  500K chars ≈ 500KB before HTML wrapping. Above this is almost always a
 *  prompt bug, not a real report. */
const MAX_DETAILS_CHARS = 500_000;

/** Soft cap on summary length. Hard enforcement happens downstream
 *  (Spaces' 10K cap; webhook's PDF fallback) — this just nudges the agent
 *  toward keeping it brief. We DO truncate hard above this to keep the
 *  in-chat body from itself becoming an oversized message. */
const MAX_SUMMARY_CHARS = 4000;

/** Build a safe, time-stamped filename from a user-controlled title. */
function safeFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "report";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${slug}-${stamp}.html`;
}

export const createHtmlReportTool: ToolDefinition = {
  slug: "create-html-report",
  name: "Create HTML Report",
  description:
    "Use this when your response is long (>2,000 chars) or contains rich content " +
    "(tables, code blocks, multiple sections). Provide a SHORT summary for the chat " +
    "thread and the FULL detailed content as markdown — the tool renders the markdown " +
    "into a styled standalone HTML file attached to your response, and the summary " +
    "appears inline in chat. The user sees the takeaway immediately and can download " +
    "the HTML for the full details. Prefer this over inlining a giant markdown block.",
  source: "custom:create-html-report",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Report title. Used for the HTML <title>, the visible <h1>, and the " +
          "downloaded filename (slugified). Keep it under 80 chars.",
      },
      summary: {
        type: "string",
        description:
          "Short summary that will appear INLINE in chat (recommended <300 chars; " +
          "hard-capped at 4,000). Lead with the key finding, then mention what's in " +
          "the attached report. Do NOT just say 'see attached'.",
      },
      detailsMarkdown: {
        type: "string",
        description:
          "Full report content in markdown. Headings, tables, lists, code blocks, " +
          "and links all render natively. Plain text and inline HTML also work but " +
          "<script>, <style>, <iframe> and inline event handlers are stripped for " +
          "safety. Soft limit: 500,000 chars.",
      },
    },
    required: ["title", "summary", "detailsMarkdown"],
  },

  async execute(params): Promise<string> {
    const title = typeof params["title"] === "string" ? params["title"].trim() : "";
    const summary = typeof params["summary"] === "string" ? params["summary"].trim() : "";
    const detailsMarkdown =
      typeof params["detailsMarkdown"] === "string" ? params["detailsMarkdown"] : "";

    if (!title) return "Error: title is required.";
    if (!summary) return "Error: summary is required.";
    if (!detailsMarkdown.trim()) return "Error: detailsMarkdown is required.";
    if (detailsMarkdown.length > MAX_DETAILS_CHARS) {
      return `Error: detailsMarkdown exceeds ${MAX_DETAILS_CHARS.toLocaleString()} chars (got ${detailsMarkdown.length.toLocaleString()}). Trim before retrying.`;
    }

    // Truncate the summary if the agent ignored the soft cap — we don't
    // want the in-chat body to itself trip the 10K Spaces cap.
    const finalSummary =
      summary.length > MAX_SUMMARY_CHARS
        ? `${summary.slice(0, MAX_SUMMARY_CHARS).trimEnd()}…`
        : summary;

    try {
      // marked.parse is synchronous when given a string + no options object.
      // We pass no options because the defaults (gfm: true, breaks: false,
      // mangle: false in v18) match what we want: tables + code fences yes,
      // forced single-line-breaks no.
      const rawHtml = await Promise.resolve(marked.parse(detailsMarkdown));
      const safeBodyHtml = sanitizeHtmlBody(
        typeof rawHtml === "string" ? rawHtml : String(rawHtml),
      );

      const fullHtml = buildHtmlDocument({
        title,
        subtitle: `Length: ${detailsMarkdown.length.toLocaleString()} chars · Generated: ${new Date().toISOString()}`,
        body: safeBodyHtml,
      });

      const fileName = safeFileName(title);
      const base64 = Buffer.from(fullHtml, "utf8").toString("base64");

      log.info(
        `[create-html-report] rendered ${fileName} (${(fullHtml.length / 1024).toFixed(1)}KB ` +
        `from ${detailsMarkdown.length.toLocaleString()}-char markdown, summary ${finalSummary.length} chars)`,
      );

      // ATTACHMENT marker is parsed by xyne-claw/src/custom-tools.ts → the
      // file is pushed via pushAttachment (claw-auth's /webhook/progress)
      // and the remaining text (the summary) becomes the visible tool
      // result that the parent agent surfaces to the user.
      return `[ATTACHMENT:${fileName}:${HTML_MIME}]\n${base64}\n\n${finalSummary}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[create-html-report] error: ${msg}`);
      return `Error rendering HTML report: ${msg}`;
    }
  },
};
