/**
 * create-desk-report — render a markdown desk report into a polished,
 * interactive HTML file with light theme, hover tooltips, and clickable
 * bar chart drill-down panels.
 *
 * Same input contract as create-html-report (title / summary / detailsMarkdown)
 * so the agent instructions stay identical. Differences from create-html-report:
 *   - Light/white theme (not dark)
 *   - Interactive JS: hover tooltips on chart segments, click a bar → slide-in
 *     panel showing verbatims + recommended action
 *   - Chart cards use subtle shadow, rounded corners
 *   - Designed for the Desk UI (iframe with allow-scripts) and browser download,
 *     NOT for Spaces file viewer (JS sandbox). Don't swap this into Spaces chat.
 *
 * Extended BAR_CHART data item schema (optional drilldown field):
 *   { "label": "Login failures", "value": 45,
 *     "drilldown": { "verbatims": ["...", "..."], "action": "Fix X" } }
 */

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { ToolDefinition } from "../types.js";
import { createLogger } from "../../logger.js";

const log = createLogger("desk-report");

const CHART_COLORS = [
  "#2B7FFF","#00C951","#C27AFF","#FF8904","#FCC800",
  "#FB2C36","#51A2FF","#FF6467","#00D492","#AD46FF",
];

function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Chart renderers — light theme
// ---------------------------------------------------------------------------

interface DrilldownData {
  verbatims?: string[];
  action?: string;
  breakdown?: Array<{ label: string; value: number }>;
  trend?: Array<{ x: string; y: number }>;
}

interface BarRow { label: string | number; value: number; drilldown?: DrilldownData }

function renderKpiCard(payload: { title?: string; visualType: string; data: Record<string, unknown> }): string {
  const d = payload.data;
  const isCompare = payload.visualType === "KPI_COMPARE";
  const val = isCompare ? d["current"] : d["value"];
  const prev = isCompare ? (d["previous"] as number) : null;
  const pct = prev !== null && prev !== 0 ? Math.round(((val as number) - prev) / Math.abs(prev) * 100) : null;
  const arrowHtml = pct === null ? "" : (
    `<span style="font-size:13px;color:${pct >= 0 ? "#00a63e" : "#dc2626"};margin-left:8px;">${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}%</span>`
  );
  const prevHtml = prev !== null ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">prev: ${esc(prev)}</div>` : "";
  const label = String(payload.title || d["label"] || "");
  return (
    `<div style="display:inline-block;min-width:160px;padding:20px 24px;` +
    `background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;` +
    `margin:6px 10px 6px 0;vertical-align:top;box-shadow:0 1px 4px rgba(0,0,0,.06);">` +
    `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;margin-bottom:8px;">${esc(label)}</div>` +
    `<div style="display:flex;align-items:baseline;">` +
    `<span style="font-size:36px;font-weight:700;font-family:ui-monospace,monospace;color:#111827;">${esc(val)}</span>` +
    arrowHtml +
    `</div>` +
    prevHtml +
    `</div>`
  );
}

function renderBarChart(payload: { title?: string; data: BarRow[] }): string {
  const rows = [...(payload.data || [])].sort((a, b) => b.value - a.value);
  if (!rows.length) return "<p style='color:#6b7280'>No data.</p>";
  const max = Math.max(...rows.map(r => r.value));
  const W = 540, barH = 24, gap = 10, labelW = 170, padding = 10;
  const h = rows.length * (barH + gap) + padding * 2;
  const barMax = W - labelW - 70;

  const bars = rows.map((r, i) => {
    const bw = max > 0 ? Math.max(2, Math.round(r.value / max * barMax)) : 0;
    const y = padding + i * (barH + gap);
    const cy = y + barH / 2 + 4;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const dd = r.drilldown ? ` data-drilldown='${JSON.stringify(r.drilldown).replace(/'/g, "&#39;")}'` : "";
    const ddCursor = r.drilldown ? " cursor:pointer;" : "";
    return (
      `<text x="${labelW - 8}" y="${cy}" text-anchor="end" font-size="12" fill="#374151" font-family="-apple-system,sans-serif">${esc(r.label)}</text>` +
      `<rect class="dr-bar" x="${labelW}" y="${y}" width="${bw}" height="${barH}" rx="4" fill="${color}"` +
      ` data-label="${esc(r.label)}" data-value="${esc(r.value)}"${dd} style="${ddCursor}opacity:.9;transition:opacity .15s">` +
      `<title>${esc(r.label)}: ${esc(r.value)}</title>` +
      `</rect>` +
      `<text x="${labelW + bw + 8}" y="${cy}" font-size="12" font-weight="600" fill="#374151" font-family="ui-monospace,monospace">${esc(r.value)}</text>`
    );
  }).join("");

  const total = rows.reduce((s, r) => s + r.value, 0);
  const hasDrilldown = rows.some(r => r.drilldown);
  const hint = hasDrilldown
    ? `<text x="${labelW}" y="${h - 2}" font-size="11" fill="#9ca3af" font-family="-apple-system,sans-serif">Click any bar for trend, verbatims and the product fix.</text>`
    : "";
  return `<svg width="100%" viewBox="0 0 ${W} ${h + (hasDrilldown ? 16 : 0)}" style="max-width:${W}px;display:block;" data-total="${total}">${bars}${hint}</svg>`;
}

function renderDonutChart(payload: { title?: string; data: Array<{ label: string | number; value: number }> }): string {
  const rows = payload.data || [];
  if (!rows.length) return "<p style='color:#6b7280'>No data.</p>";
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) return "<p style='color:#6b7280'>No data.</p>";
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
    const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${xi2.toFixed(2)} ${yi2.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${xi1.toFixed(2)} ${yi1.toFixed(2)} Z`;
    const pct = Math.round(row.value / total * 100);
    return `<path d="${d}" fill="${CHART_COLORS[i % CHART_COLORS.length]}" stroke="#ffffff" stroke-width="2"><title>${esc(row.label)}: ${esc(row.value)} (${pct}%)</title></path>`;
  }).join("");
  const legendX = 235;
  angle = -Math.PI / 2;
  const legend = rows.map((row, i) => {
    const pct = Math.round(row.value / total * 100);
    const ly = 30 + i * 22;
    return (
      `<rect x="${legendX}" y="${ly - 9}" width="10" height="10" rx="5" fill="${CHART_COLORS[i % CHART_COLORS.length]}"></rect>` +
      `<text x="${legendX + 16}" y="${ly}" font-size="12" fill="#374151" font-family="-apple-system,sans-serif">${esc(row.label)} — ${esc(row.value)} (${pct}%)</text>`
    );
  }).join("");
  const svgH = Math.max(220, rows.length * 22 + 40);
  return `<svg width="100%" viewBox="0 0 540 ${svgH}" style="max-width:540px;display:block;">${slices}${legend}</svg>`;
}

function renderDataTable(payload: { data: { columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>> } }): string {
  const cols = payload.data.columns || [];
  const rows = payload.data.rows || [];
  const th = cols.map(c =>
    `<th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;font-weight:600;background:#f9fafb;">${esc(c.label)}</th>`
  ).join("");
  const tb = rows.map((r, i) => {
    const bg = i % 2 === 1 ? "background:#f9fafb;" : "";
    return `<tr style="${bg}">` + cols.map(c =>
      `<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${esc(r[c.key] != null ? r[c.key] : "—")}</td>`
    ).join("") + `</tr>`;
  }).join("");
  return `<table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;">\
<thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Two-pass chart processing: extract → sanitize user markdown → re-inject
// ---------------------------------------------------------------------------

const PLACEHOLDER_PREFIX = "%%DESK-CHART-";
const PLACEHOLDER_SUFFIX = "%%";

function extractAndRenderCharts(md: string): { md: string; charts: Map<string, string> } {
  const charts = new Map<string, string>();
  let idx = 0;

  // Normalize chart blocks: strip bold markers and handle single-line JSON variants
  const normalized = md
    .replace(/\*{1,2}```chart\n?([\s\S]*?)```\*{0,2}/g, "```chart\n$1\n```")
    .replace(/```chart\s+(\{[\s\S]*?\})\s*$(?!\n```)/gm, "```chart\n$1\n```");

  // Step 1: extract chart blocks and replace with placeholders so they are
  // protected before we strip any non-chart code fences below.
  const processed = normalized.replace(/^```chart\n([\s\S]*?)^```/gm, (_match, json: string) => {
    try {
      const payload = JSON.parse(json.trim()) as {
        title?: string;
        visualType: string;
        data: unknown;
      };
      const vt = payload.visualType;
      const titleHtml = payload.title
        ? `<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:12px;">${esc(payload.title)}</div>`
        : "";

      let inner = "";
      if (vt === "KPI" || vt === "KPI_COMPARE") {
        const card = renderKpiCard(payload as Parameters<typeof renderKpiCard>[0]);
        const key = `${PLACEHOLDER_PREFIX}${idx++}${PLACEHOLDER_SUFFIX}`;
        charts.set(key, `<div style="display:inline-block;vertical-align:top;margin:8px 0;">${card}</div>`);
        return `\n${key}\n`;
      } else if (vt === "BAR_CHART") {
        inner = renderBarChart(payload as Parameters<typeof renderBarChart>[0]);
      } else if (vt === "PIE_CHART" || vt === "DONUT_CHART") {
        inner = renderDonutChart(payload as Parameters<typeof renderDonutChart>[0]);
      } else if (vt === "DATA_TABLE") {
        inner = renderDataTable(payload as Parameters<typeof renderDataTable>[0]);
      } else {
        return _match;
      }
      const key = `${PLACEHOLDER_PREFIX}${idx++}${PLACEHOLDER_SUFFIX}`;
      charts.set(key, `<div class="chart-card">${titleHtml}${inner}</div>`);
      return `\n${key}\n`;
    } catch {
      return _match;
    }
  });
  // Step 2: strip any remaining non-chart code fences so markdown renders
  // properly (## headings, **bold**, etc. instead of raw text in <pre>).
  // Chart blocks are already replaced with placeholders so they're safe.
  const stripped = processed.replace(/^```[^\n]*\n([\s\S]*?)^```/gm, (_m, inner: string) => inner);

  return { md: stripped, charts };
}

function reinsertCharts(html: string, charts: Map<string, string>): string {
  let result = html;
  for (const [key, value] of charts) {
    // The placeholder may be wrapped in a <p> by marked — unwrap it
    result = result.replace(new RegExp(`<p>\\s*${key}\\s*</p>`, "g"), value);
    result = result.replace(new RegExp(key, "g"), value);
  }
  // Remove any orphaned placeholder keys that weren't in the store (no chart data)
  result = result.replace(/<p>\s*%%DESK-CHART-\d+%%\s*<\/p>/g, "");
  result = result.replace(/%%DESK-CHART-\d+%%/g, "");
  return result;
}

// ---------------------------------------------------------------------------
// HTML document builder — light theme + interactive JS
// ---------------------------------------------------------------------------

const INTERACTIVE_JS = `
(function() {
  // Tooltip on hover
  var tip = document.createElement('div');
  tip.id = 'dr-tip';
  tip.style.cssText = 'position:fixed;background:#111827;color:#fff;font-size:12px;padding:6px 10px;border-radius:6px;pointer-events:none;display:none;z-index:9999;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);';
  document.body.appendChild(tip);

  // Drill-down panel
  var panel = document.createElement('div');
  panel.id = 'dr-panel';
  panel.style.cssText = 'position:fixed;top:0;right:-380px;width:360px;height:100vh;background:#fff;border-left:1px solid #e5e7eb;box-shadow:-4px 0 20px rgba(0,0,0,.08);z-index:9998;transition:right .25s ease;overflow-y:auto;padding:24px 20px;';
  panel.innerHTML = '<button id="dr-close" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280;line-height:1;" aria-label="Close">✕</button><div id="dr-content"></div>';
  document.body.appendChild(panel);

  document.getElementById('dr-close').onclick = closePanel;
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closePanel(); });
  document.addEventListener('click', function(e){
    var p = document.getElementById('dr-panel');
    if(p.style.right === '0px' && !p.contains(e.target) && !e.target.classList.contains('dr-bar')) closePanel();
  });

  function closePanel() {
    document.getElementById('dr-panel').style.right = '-380px';
    document.getElementById('dr-panel').dataset.open = '';
  }

  function openPanel(label, value, dd, total) {
    var pct = total && total > 0 ? Math.round(value / total * 100) : null;
    var pctHtml = pct !== null ? ' <span style="font-size:13px;color:#6b7280;font-weight:400;">· ' + pct + '%</span>' : '';
    var content = '<h3 style="margin:0 0 12px;font-size:17px;font-weight:700;color:#111827;line-height:1.3;">' + escHtml(label) + '</h3>';
    content += '<div style="font-size:32px;font-weight:700;color:#2B7FFF;margin-bottom:20px;line-height:1;">' + escHtml(String(value)) + pctHtml + '</div>';

    // Trend chart — full width, Y-axis labels + gridlines, matching reference design
    if (dd.trend && dd.trend.length > 1) {
      var tData = dd.trend;
      var yAxisW = 36, tH = 140, tPad = 12, chartW = 320;
      var plotW = chartW - yAxisW - tPad;
      var plotH = tH - tPad * 2 - 16; // 16px for x-labels at bottom
      var vals = tData.map(function(p){ return p.y; });
      var tMin = 0; // always start from 0 like reference
      var tMax = Math.max.apply(null, vals) || 1;
      var tRange = tMax - tMin;
      // Y-axis ticks: 0, mid, max
      var yTicks = [0, Math.round(tMax / 2), tMax];
      var pts = tData.map(function(p, i) {
        var px = yAxisW + (i / (tData.length - 1)) * plotW;
        var py = tPad + plotH - ((p.y - tMin) / tRange) * plotH;
        return px.toFixed(1) + ',' + py.toFixed(1);
      }).join(' ');
      var bottomY = tPad + plotH;
      var areaPoints = yAxisW + ',' + bottomY + ' ' + pts + ' ' + (yAxisW + plotW) + ',' + bottomY;
      content += '<div style="margin-bottom:20px;">';
      content += '<svg width="' + chartW + '" height="' + tH + '" viewBox="0 0 ' + chartW + ' ' + tH + '" style="display:block;width:100%;">';
      content += '<defs><linearGradient id="tg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2B7FFF" stop-opacity=".15"/><stop offset="100%" stop-color="#2B7FFF" stop-opacity="0"/></linearGradient></defs>';
      // Gridlines + Y labels
      yTicks.forEach(function(tick) {
        var gy = tPad + plotH - ((tick - tMin) / tRange) * plotH;
        content += '<line x1="' + yAxisW + '" y1="' + gy.toFixed(1) + '" x2="' + (yAxisW + plotW) + '" y2="' + gy.toFixed(1) + '" stroke="#f3f4f6" stroke-width="1"/>';
        content += '<text x="' + (yAxisW - 4) + '" y="' + (gy + 4).toFixed(1) + '" font-size="9" fill="#9ca3af" text-anchor="end" font-family="-apple-system,sans-serif">' + escHtml(String(tick)) + '</text>';
      });
      // Area + line
      content += '<polygon points="' + areaPoints + '" fill="url(#tg2)"/>';
      content += '<polyline points="' + pts + '" fill="none" stroke="#2B7FFF" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      // X labels: first and last
      content += '<text x="' + yAxisW + '" y="' + (tH - 2) + '" font-size="9" fill="#9ca3af" font-family="-apple-system,sans-serif">' + escHtml(String(tData[0].x)) + '</text>';
      content += '<text x="' + (yAxisW + plotW) + '" y="' + (tH - 2) + '" font-size="9" fill="#9ca3af" text-anchor="end" font-family="-apple-system,sans-serif">' + escHtml(String(tData[tData.length-1].x)) + '</text>';
      content += '</svg></div>';
    }

    // Breakdown bars
    if (dd.breakdown && dd.breakdown.length) {
      var bMax = Math.max.apply(null, dd.breakdown.map(function(b){ return b.value || 0; }));
      content += '<div style="margin-bottom:20px;">';
      content += '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:10px;">Breakdown</div>';
      dd.breakdown.forEach(function(b){
        var bw = bMax > 0 ? Math.round(b.value / bMax * 100) : 0;
        var bpct = value > 0 ? Math.round(b.value / value * 100) : 0;
        content += '<div style="margin-bottom:8px;">';
        content += '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">';
        content += '<span style="color:#374151;">' + escHtml(String(b.label)) + '</span>';
        content += '<span style="color:#6b7280;">' + escHtml(String(b.value)) + ' · ' + bpct + '%</span></div>';
        content += '<div style="height:6px;background:#f3f4f6;border-radius:3px;"><div style="height:6px;background:#2B7FFF;border-radius:3px;width:' + bw + '%;transition:width .3s;"></div></div>';
        content += '</div>';
      });
      content += '</div>';
    }

    // Verbatims as styled quotes
    if (dd.verbatims && dd.verbatims.length) {
      content += '<div style="margin-bottom:20px;">';
      content += '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin-bottom:10px;">What people actually write</div>';
      dd.verbatims.forEach(function(v){
        content += '<div style="border-left:3px solid #e5e7eb;padding:8px 12px;margin-bottom:8px;font-size:13px;color:#374151;line-height:1.5;font-style:italic;">"' + escHtml(v) + '"</div>';
      });
      content += '</div>';
    }

    // Action as highlighted product fix box
    if (dd.action) {
      content += '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;">';
      content += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#15803d;margin-bottom:6px;">Product fix</div>';
      content += '<div style="font-size:13px;color:#166534;line-height:1.6;">' + escHtml(dd.action) + '</div></div>';
    }

    document.getElementById('dr-content').innerHTML = content;
    document.getElementById('dr-panel').style.right = '0px';
    document.getElementById('dr-panel').dataset.open = '1';
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Wire up bars
  document.querySelectorAll('.dr-bar').forEach(function(el) {
    el.addEventListener('mouseenter', function(e) {
      tip.textContent = el.getAttribute('data-label') + ': ' + el.getAttribute('data-value');
      tip.style.display = 'block';
      el.style.opacity = '1';
      el.style.filter = 'brightness(1.1)';
    });
    el.addEventListener('mousemove', function(e) {
      tip.style.left = (e.clientX + 14) + 'px';
      tip.style.top = (e.clientY - 28) + 'px';
    });
    el.addEventListener('mouseleave', function() {
      tip.style.display = 'none';
      el.style.opacity = '.9';
      el.style.filter = '';
    });
    var ddRaw = el.getAttribute('data-drilldown');
    if (ddRaw) {
      el.addEventListener('click', function() {
        try {
          var dd = JSON.parse(ddRaw);
          var total = parseInt(el.closest('svg') && el.closest('svg').getAttribute('data-total') || '0', 10) || 0;
          openPanel(el.getAttribute('data-label'), parseInt(el.getAttribute('data-value'), 10), dd, total);
        } catch(e) {}
      });
    }
  });

  // Hover on donut/pie slices
  document.querySelectorAll('svg path[data-drilldown], svg path[title]').forEach(function(el) {
    el.style.transition = 'opacity .15s';
    el.addEventListener('mouseenter', function(e) {
      var t = el.querySelector('title');
      if (t) {
        tip.textContent = t.textContent;
        tip.style.display = 'block';
      }
      el.style.opacity = '.75';
    });
    el.addEventListener('mousemove', function(e) {
      tip.style.left = (e.clientX + 14) + 'px';
      tip.style.top = (e.clientY - 28) + 'px';
    });
    el.addEventListener('mouseleave', function() {
      tip.style.display = 'none';
      el.style.opacity = '1';
    });
  });
})();
`;

const CSS = `
  :root {
    --bg: #f8f9fb;
    --surface: #ffffff;
    --fg: #111827;
    --fg-secondary: #374151;
    --fg-muted: #6b7280;
    --border: #e5e7eb;
    --border-light: #f3f4f6;
    --accent: #2563eb;
    --accent-bg: #eff6ff;
    --code-bg: #f3f4f6;
    --code-fg: #1f2937;
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 960px; margin: 0 auto; padding: 40px 28px 100px; }
  header {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px 28px;
    margin-bottom: 28px;
    box-shadow: 0 1px 4px rgba(0,0,0,.05);
  }
  header h1 { font-size: 26px; font-weight: 700; margin: 0 0 6px; color: var(--fg); }
  header .subtitle { font-size: 13px; color: var(--fg-muted); }
  .content-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 28px;
    margin-bottom: 20px;
    box-shadow: 0 1px 4px rgba(0,0,0,.04);
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; font-weight: 600; color: var(--fg); }
  h2 { font-size: 19px; margin: 28px 0 12px; border-bottom: 2px solid var(--border-light); padding-bottom: 8px; }
  h3 { font-size: 16px; margin: 20px 0 8px; }
  h4 { font-size: 14px; margin: 14px 0 6px; }
  p { margin: 0 0 12px; color: var(--fg-secondary); }
  ul, ol { padding-left: 1.5em; margin: 0 0 12px; color: var(--fg-secondary); }
  li { margin: 4px 0; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  strong { font-weight: 600; color: var(--fg); }
  code {
    background: var(--code-bg); color: var(--code-fg);
    padding: .1em .35em; border-radius: 4px;
    font-family: inherit;
    font-size: inherit;
  }
  pre {
    background: transparent; color: var(--fg-secondary);
    padding: 0; border-radius: 0;
    overflow-x: visible; font-size: 15px; line-height: 1.6; margin: 8px 0;
    font-family: inherit; white-space: pre-wrap; word-break: break-word;
    border: none;
  }
  pre code { background: transparent; padding: 0; font-size: inherit; font-family: inherit; }
  blockquote {
    margin: 12px 0; padding: 10px 14px;
    border-left: 3px solid var(--accent);
    background: var(--accent-bg); border-radius: 0 6px 6px 0;
    color: var(--fg-secondary);
  }
  hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 14px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border-light); vertical-align: top; }
  th { font-weight: 600; font-size: 12px; color: var(--fg-muted); background: #f9fafb; text-transform: uppercase; letter-spacing: .04em; }
  tbody tr:hover td { background: #fafafa; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  .chart-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 24px;
    margin: 16px 0;
    box-shadow: 0 1px 4px rgba(0,0,0,.04);
    overflow-x: auto;
  }
  @media (max-width: 640px) {
    .container { padding: 20px 16px 60px; }
    header, .content-card { padding: 18px 16px; }
  }
  @media print {
    .container { max-width: none; }
    #dr-panel, #dr-tip { display: none !important; }
  }
`;

function buildDeskHtmlDocument(title: string, subtitle: string | undefined, body: string): string {
  const subtitleHtml = subtitle
    ? `<div class="subtitle">${escTitle(subtitle)}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escTitle(title)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${escTitle(title)}</h1>
      ${subtitleHtml}
    </header>
    <div class="content-card">
      ${body}
    </div>
  </div>
  <script>${INTERACTIVE_JS}</script>
</body>
</html>`;
}

function escTitle(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Sanitize user markdown (strips dangerous HTML; allows safe subset)
// ---------------------------------------------------------------------------

function sanitizeBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["h1", "h2", "img", "details", "summary"]),
    allowedAttributes: {
      "*": ["class", "id", "align"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      details: ["open"],
      ol: ["start", "type"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowProtocolRelative: false,
    exclusiveFilter: (frame: { tag: string; attribs?: Record<string, string> }) => {
      if (frame.tag !== "img") return false;
      const src = (frame.attribs?.src ?? "").trim().toLowerCase();
      return src.startsWith("data:text/html") || src.startsWith("data:image/svg+xml");
    },
  });
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const MAX_DETAILS_CHARS = 500_000;
const MAX_SUMMARY_CHARS = 4_000;

function safeFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "desk-report";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${slug}-${stamp}.html`;
}

export const createDeskReportTool: ToolDefinition = {
  slug: "create-desk-report",
  name: "Create Desk Report",
  description:
    "Use this to render a desk analysis report as a polished interactive HTML file. " +
    "Provide a SHORT summary for the chat thread and the FULL detailed content as markdown " +
    "— the tool renders it into a light-themed HTML file with interactive charts (hover " +
    "tooltips, clickable bar drill-down showing verbatims and recommended actions). " +
    "Designed for the Desk Report view. Use create-html-report for regular Spaces chat instead.",
  source: "custom:create-desk-report",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Report title. Used for <title>, visible <h1>, and filename. Keep under 80 chars.",
      },
      summary: {
        type: "string",
        description:
          "Short summary that appears inline in chat (<300 chars recommended, hard cap 4,000). " +
          "Lead with the key finding.",
      },
      detailsMarkdown: {
        type: "string",
        description:
          "Full report in markdown. Headings, tables, lists, code blocks, and ```chart blocks all " +
          "render natively. BAR_CHART items may include an optional drilldown field: " +
          '{ "label": "X", "value": 42, "drilldown": { "verbatims": ["..."], "action": "Fix Y" } }. ' +
          "Soft limit: 500,000 chars.",
      },
    },
    required: ["title", "summary", "detailsMarkdown"],
  },

  async execute(params): Promise<string> {
    const title = typeof params["title"] === "string" ? params["title"].trim() : "";
    const summary = typeof params["summary"] === "string" ? params["summary"].trim() : "";
    const detailsMarkdown = typeof params["detailsMarkdown"] === "string" ? params["detailsMarkdown"] : "";

    if (!title) return "Error: title is required.";
    if (!summary) return "Error: summary is required.";
    if (!detailsMarkdown.trim()) return "Error: detailsMarkdown is required.";
    if (detailsMarkdown.length > MAX_DETAILS_CHARS) {
      return `Error: detailsMarkdown exceeds ${MAX_DETAILS_CHARS.toLocaleString()} chars (got ${detailsMarkdown.length.toLocaleString()}). Trim before retrying.`;
    }

    const finalSummary =
      summary.length > MAX_SUMMARY_CHARS
        ? `${summary.slice(0, MAX_SUMMARY_CHARS).trimEnd()}…`
        : summary;

    try {
      // Step 1: Extract ```chart blocks and render them to HTML (bypasses sanitizer)
      const { md: mdWithPlaceholders, charts } = extractAndRenderCharts(detailsMarkdown);

      // Step 2: Parse remaining markdown to HTML
      const rawHtml = await Promise.resolve(marked.parse(mdWithPlaceholders));
      const htmlStr = typeof rawHtml === "string" ? rawHtml : String(rawHtml);

      // Step 3: Sanitize user-generated HTML (strips <script>, <style>, etc.)
      const safeHtml = sanitizeBody(htmlStr);

      // Step 4: Re-inject chart HTML (trusted — our own code, not user input)
      const bodyHtml = reinsertCharts(safeHtml, charts);

      // Step 5: Wrap in the full document with light theme + interactive JS
      const fullHtml = buildDeskHtmlDocument(title, undefined, bodyHtml);
      const fileName = safeFileName(title);

      const b64 = Buffer.from(fullHtml, "utf8").toString("base64");
      log.info(`[create-desk-report] generated ${fullHtml.length} chars → ${fileName}`);
      return `[ATTACHMENT:${fileName}:text/html]\n${b64}\n\n${finalSummary}`;
    } catch (err) {
      log.error("[create-desk-report] error", err);
      return `Error generating desk report: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
