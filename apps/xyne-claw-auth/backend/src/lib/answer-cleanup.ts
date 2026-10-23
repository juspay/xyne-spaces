const CITATION_TOKEN_RE = /[ \t]?\[clf-([^\][]+?)#(\d+)\]/g;
const CHART_BLOCK_RE = /```chart[^\n]*\n([\s\S]*?)```/g;
const WORKING_NOTE_MAX_CHARS = 280;
const WORKING_NOTE_RE =
  /\b(?:let me|let's|i['’]ll|i will|i['’]m going to|i am going to|now i(?:['’]ll| will)?|next,? i(?:['’]ll| will)?|first,? i(?:['’]ll| will)?)\s+(?:now\s+|quickly\s+|also\s+)?(?:try|check|look|search|pull|fetch|draft|create|compose|write|put together|call|run|use|query|find|grab|gather|verify|confirm|dig|open|read|scan|start|go ahead|get|see|figure out|work out|pick)\b/i;
const MAX_ERROR_DETAIL_CHARS = 120;
const SPACES_CHART_TYPES = new Set([
  "AREA_CHART",
  "BAR_CHART",
  "DATA_TABLE",
  "DONUT_CHART",
  "KPI",
  "KPI_COMPARE",
  "LINE_CHART",
  "PIE_CHART",
  "SCATTER_CHART",
]);

export function stripWorkingNote(text: string): string {
  const match = /^\s*([^\n]+?)\s*\n\s*\n([\s\S]*)$/.exec(text);
  if (!match) return text;
  const [, first = "", rest = ""] = match;
  if (rest.trim().length < 20) return text;
  if (first.length > WORKING_NOTE_MAX_CHARS) return text;
  if (/^(?:#|[-*+]\s|\d+[.)]\s|\||>|```)/.test(first)) return text;
  if (!/[.:…]$/.test(first)) return text;
  if (!WORKING_NOTE_RE.test(first)) return text;
  return rest.replace(/^\s+/, "");
}

export function stripUnrenderedCitationTokens(text: string, renderableToolCallIds: ReadonlySet<string>): string {
  if (!text.includes("[clf-")) return text;
  return text
    .replace(CITATION_TOKEN_RE, (token, toolCallId: string) => (renderableToolCallIds.has(toolCallId) ? token : ""))
    .replace(/ +([.,;:!?)])/g, "$1");
}

interface ChartPoint {
  label?: unknown;
  value?: unknown;
  [key: string]: unknown;
}

const cell = (value: unknown): string => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

function parseChart(json: string): { title?: unknown; visualType?: unknown; data?: unknown } | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { title?: unknown; visualType?: unknown; data?: unknown })
      : null;
  } catch {
    return null;
  }
}

export function spacesCanRenderChart(json: string): boolean {
  const chart = parseChart(json);
  return (
    !!chart &&
    typeof chart.title === "string" &&
    typeof chart.visualType === "string" &&
    SPACES_CHART_TYPES.has(chart.visualType) &&
    chart.data !== undefined
  );
}

function chartToTable(json: string): string | null {
  const chart = parseChart(json);
  if (!chart) return null;
  const rows = Array.isArray(chart.data) ? (chart.data as ChartPoint[]).filter((row) => row && typeof row === "object") : [];
  if (rows.length === 0) return null;
  const title = typeof chart.title === "string" && chart.title.trim() ? `**${cell(chart.title)}**\n\n` : "";
  if (rows.every((row) => "label" in row && "value" in row)) {
    return `${title}| Item | Value |\n|---|---|\n${rows.map((row) => `| ${cell(row.label)} | ${cell(row.value)} |`).join("\n")}`;
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (columns.length === 0 || columns.length > 8) return null;
  return `${title}| ${columns.map(cell).join(" | ")} |\n|${columns.map(() => "---").join("|")}|\n${rows
    .map((row) => `| ${columns.map((column) => cell(row[column])).join(" | ")} |`)
    .join("\n")}`;
}

export function renderChartBlocks(text: string): string {
  if (!text.includes("```chart")) return text;
  return text
    .replace(CHART_BLOCK_RE, (block: string, json: string) =>
      spacesCanRenderChart(json.trim()) ? block : (chartToTable(json.trim()) ?? ""),
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanSpacesAnswer(
  text: string,
  options: { renderableToolCallIds?: ReadonlySet<string>; workingNoteStripped?: boolean } = {},
): string {
  const withoutNote = options.workingNoteStripped ? text : stripWorkingNote(text);
  const cleaned = renderChartBlocks(stripUnrenderedCitationTokens(withoutNote, options.renderableToolCallIds ?? new Set()));
  return cleaned.trim() ? cleaned : text;
}

function looksStructured(raw: string): boolean {
  return /[{}[\]]|\bat\s+\S+\s+\(|\n/.test(raw);
}

export function friendlyRunError(raw: string | null | undefined): string {
  const error = (raw ?? "").trim();
  if (!error) return "Something went wrong while running the agent.";
  if (/\b401\b|\b403\b|authentication_error|unauthori[sz]ed|invalid[ _-]?(?:x-)?api[ _-]?key|permission_error|forbidden/i.test(error)) {
    return "The AI provider rejected this agent's credentials. Check the provider key in the agent's settings.";
  }
  if (/\b429\b|rate.?limit|quota|exceeded|out of credit|insufficient[_ ]quota/i.test(error)) {
    return "The AI provider is rate-limited or out of quota right now. Please try again shortly.";
  }
  if (/context[_ ]length|too many tokens|maximum context|prompt is too long/i.test(error)) {
    return "The conversation is too long for this model. Start a new thread or shorten the request.";
  }
  if (/model[_ ]not[_ ]found|does not exist|unknown model|\b404\b/i.test(error)) {
    return "The configured model isn't available. Check the model in the agent's settings.";
  }
  if (/\b5\d\d\b|overloaded|unavailable|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(error)) {
    return "The AI provider had a temporary problem. Please try again in a moment.";
  }
  if (error.length <= MAX_ERROR_DETAIL_CHARS && !looksStructured(error)) return error;
  return "Something went wrong while running the agent.";
}
