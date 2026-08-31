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

// ---------------------------------------------------------------------------
// Server-side chart renderer — converts ```chart JSON blocks to inline SVG/HTML
// ---------------------------------------------------------------------------

const CHART_COLORS = ["#00C951","#2B7FFF","#C27AFF","#FF8904","#FCC800","#FB2C36","#51A2FF","#FF6467","#00D492","#AD46FF"];

function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderKpiSvg(payload: { title?: string; visualType: string; data: Record<string, unknown> }): string {
  const d = payload.data;
  const val = payload.visualType === "KPI_COMPARE" ? d["current"] : d["value"];
  const prev = payload.visualType === "KPI_COMPARE" ? (d["previous"] as number) : null;
  const pct = prev !== null && prev !== 0 ? Math.round(((val as number) - prev) / Math.abs(prev) * 100) : null;
  const arrow = pct === null ? "" : (pct >= 0 ? "▲ " : "▼ ") + Math.abs(pct) + "%";
  const arrowColor = pct === null ? "" : (pct >= 0 ? "#00C951" : "#FB2C36");
  const label = String(payload.title || d["label"] || "");
  return `<div style="display:inline-block;min-width:160px;padding:16px 20px;background:#1a1a1c;border:1px solid #2a2a2c;border-radius:10px;margin:6px 8px 6px 0;vertical-align:top;">` +
    `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;margin-bottom:6px;">${esc(label)}</div>` +
    `<div style="font-size:36px;font-weight:700;font-family:ui-monospace,monospace;line-height:1;color:#e5e7eb;">${esc(val)}</div>` +
    (d["label"] && payload.visualType === "KPI" ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px;">${esc(d["label"])}</div>` : "") +
    (arrow ? `<div style="font-size:12px;color:${arrowColor};margin-top:4px;">${esc(arrow)}${prev !== null ? ` (prev ${esc(prev)})` : ""}</div>` : "") +
    `</div>`;
}

function renderBarSvg(payload: { title?: string; data: Array<{ label: string | number; value: number }> }): string {
  const rows = [...(payload.data || [])].sort((a, b) => b.value - a.value);
  if (!rows.length) return "<p>No data.</p>";
  const max = Math.max(...rows.map(r => r.value));
  const W = 520, barH = 22, gap = 8, labelW = 160, padding = 8;
  const h = rows.length * (barH + gap) + padding * 2;
  const barMax = W - labelW - 60;
  const lines = rows.map((r, i) => {
    const bw = max > 0 ? Math.round(r.value / max * barMax) : 0;
    const y = padding + i * (barH + gap);
    const cy = y + barH / 2 + 4;
    return `<text x="${labelW - 6}" y="${cy}" text-anchor="end" font-size="11" fill="#9ca3af" font-family="ui-monospace,monospace">${esc(r.label)}</text>` +
      `<rect x="${labelW}" y="${y}" width="${bw}" height="${barH}" rx="3" fill="${CHART_COLORS[i % CHART_COLORS.length]}"></rect>` +
      `<text x="${labelW + bw + 6}" y="${cy}" font-size="11" font-weight="600" fill="#e5e7eb" font-family="ui-monospace,monospace">${esc(r.value)}</text>`;
  }).join("");
  return `<svg width="100%" viewBox="0 0 ${W} ${h}" style="max-width:${W}px;display:block;">${lines}</svg>`;
}

function renderDonutSvg(payload: { data: Array<{ label: string | number; value: number }> }): string {
  const rows = payload.data || [];
  if (!rows.length) return "<p>No data.</p>";
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) return "<p>No data.</p>";
  const cx = 110, cy = 110, R = 80, r = 50;
  let angle = -Math.PI / 2;
  const slices = rows.map((row, i) => {
    const sweep = (row.value / total) * 2 * Math.PI;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    angle += sweep;
    const x2 = cx + R * Math.cos(angle), y2 = cy + R * Math.sin(angle);
    const xi1 = cx + r * Math.cos(angle - sweep), yi1 = cy + r * Math.sin(angle - sweep);
    const xi2 = cx + r * Math.cos(angle), yi2 = cy + r * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    const d = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${r} ${r} 0 ${large} 0 ${xi1} ${yi1} Z`;
    return `<path d="${d}" fill="${CHART_COLORS[i % CHART_COLORS.length]}" stroke="#0f0f10" stroke-width="2"></path>`;
  }).join("");
  const legendX = 235;
  const legend = rows.map((row, i) => {
    const pct = Math.round(row.value / total * 100);
    const ly = 30 + i * 22;
    return `<rect x="${legendX}" y="${ly - 9}" width="10" height="10" rx="5" fill="${CHART_COLORS[i % CHART_COLORS.length]}"></rect>` +
      `<text x="${legendX + 16}" y="${ly}" font-size="11" fill="#e5e7eb" font-family="ui-monospace,monospace">${esc(row.label)} — ${esc(row.value)} (${pct}%)</text>`;
  }).join("");
  const svgH = Math.max(220, rows.length * 22 + 40);
  return `<svg width="100%" viewBox="0 0 520 ${svgH}" style="max-width:520px;display:block;">${slices}${legend}</svg>`;
}

function renderTableHtml(payload: { data: { columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>> } }): string {
  const cols = payload.data.columns || [];
  const rows = payload.data.rows || [];
  const th = cols.map(c => `<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #2a2a2c;font-size:12px;color:#9ca3af;font-weight:500;">${esc(c.label)}</th>`).join("");
  const tb = rows.map((r, i) => {
    const bg = i % 2 === 1 ? "background:#18181a;" : "";
    return `<tr style="${bg}">` + cols.map(c => `<td style="padding:8px 10px;border-bottom:1px solid #2a2a2c;font-size:13px;color:#e5e7eb;">${esc(r[c.key] != null ? r[c.key] : "—")}</td>`).join("") + `</tr>`;
  }).join("");
  return `<table style="width:100%;border-collapse:collapse;"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
}

/** Pre-process markdown: replace ```chart JSON blocks with inline SVG/HTML. */
function preRenderCharts(md: string): string {
  return md.replace(/^```chart\n([\s\S]*?)^```/gm, (_match, json: string) => {
    try {
      const payload = JSON.parse(json.trim()) as {
        title?: string;
        visualType: string;
        data: unknown;
      };
      const vt = payload.visualType;
      const titleHtml = payload.title
        ? `<div style="font-size:13px;font-weight:600;margin-bottom:12px;color:#e5e7eb;">${esc(payload.title)}</div>`
        : "";

      if (vt === "KPI" || vt === "KPI_COMPARE") {
        return `\n<div style="margin:16px 0;">${renderKpiSvg(payload as Parameters<typeof renderKpiSvg>[0])}</div>\n`;
      } else if (vt === "BAR_CHART") {
        const inner = renderBarSvg(payload as Parameters<typeof renderBarSvg>[0]);
        return `\n<div style="margin:16px 0;padding:16px 20px;background:#1a1a1c;border:1px solid #2a2a2c;border-radius:10px;overflow-x:auto;">${titleHtml}${inner}</div>\n`;
      } else if (vt === "PIE_CHART" || vt === "DONUT_CHART") {
        const inner = renderDonutSvg(payload as Parameters<typeof renderDonutSvg>[0]);
        return `\n<div style="margin:16px 0;padding:16px 20px;background:#1a1a1c;border:1px solid #2a2a2c;border-radius:10px;overflow-x:auto;">${titleHtml}${inner}</div>\n`;
      } else if (vt === "DATA_TABLE") {
        const inner = renderTableHtml(payload as Parameters<typeof renderTableHtml>[0]);
        return `\n<div style="margin:16px 0;padding:16px 20px;background:#1a1a1c;border:1px solid #2a2a2c;border-radius:10px;overflow-x:auto;">${titleHtml}${inner}</div>\n`;
      }
    } catch {
      // leave as-is on parse error
    }
    return _match;
  });
}

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
      // Pre-render chart blocks to inline SVG/HTML before markdown parsing
      // so charts display in JS-disabled viewers (Spaces file viewer, etc.)
      const processedMarkdown = preRenderCharts(detailsMarkdown);
      const rawHtml = await Promise.resolve(marked.parse(processedMarkdown));
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
