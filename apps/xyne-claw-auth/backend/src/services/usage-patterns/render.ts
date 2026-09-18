import { capabilityPhrases } from "../agent-index/index.js";
import type { UsageCorpus, UsagePattern } from "./types.js";

/**
 * Render stage: surviving patterns become the file.
 *
 * Pure, and it owns every number in the text. The distiller names patterns and
 * cites runs; percentages and user counts are computed here from the corpus, so
 * a confident arithmetic mistake by the model cannot reach the page.
 *
 * Descriptive, never instructional: an agent that reads "users usually ask for
 * X" can start pushing back on adjacent work it handles perfectly well.
 */

export const MAX_DEMAND_PATTERNS = 6;
export const MAX_GAP_PATTERNS = 4;
export const MAX_TOOLS = 8;
/** Comfortably inside MAX_FILE_CHARS — the design calls for ~2k of prose, and a
 *  longer file is a worse routing signal, not a better one. */
export const MAX_TEXT_CHARS = 4_000;

const FILE_HEADING = "# Usage patterns";

function pct(share: number): string {
  const rounded = Math.round(share * 100);
  if (rounded === 0 && share > 0) return "<1%";
  return `${rounded}%`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function toolLine(tool: string, runs: number, total: number): string {
  const phrase = capabilityPhrases([tool])[0] ?? tool;
  return `- ${phrase} (\`${tool}\`) — ${plural(runs, "run", "runs")} (${pct(runs / total)})`;
}

function section(title: string, lines: string[]): string[] {
  return lines.length ? [`## ${title}`, ...lines, ""] : [];
}

export function renderUsageFile(corpus: UsageCorpus, patterns: UsagePattern[], now: Date): string {
  const demand = patterns.filter((p) => p.kind === "demand").slice(0, MAX_DEMAND_PATTERNS);
  const gaps = patterns.filter((p) => p.kind === "gap").slice(0, MAX_GAP_PATTERNS);
  const tools = corpus.toolUsage.slice(0, MAX_TOOLS);

  const lines = [
    FILE_HEADING,
    "",
    `_Synthesized ${day(now.toISOString())} from ${plural(corpus.runCount, "run", "runs")}` +
      `${corpus.windowRuns > corpus.runCount ? ` of ${corpus.windowRuns}` : ""} by ` +
      `${plural(corpus.distinctUsers, "person", "people")} between ${day(corpus.window.start)} and ` +
      `${day(corpus.window.end)}${corpus.delegatedCount ? `, ${corpus.delegatedCount} of them delegated` : ""}. ` +
      "Machine-written; edit it and it will never be overwritten again._",
    "",
    ...section(
      "What people bring here",
      demand.map((p) => `- ${p.summary} (${pct(p.share)} of runs, ${plural(p.users, "person", "people")})`),
    ),
    ...section(
      "Capabilities actually exercised",
      tools.map((t) => toolLine(t.tool, t.runs, corpus.runCount)),
    ),
    ...section(
      "Where it does not deliver",
      gaps.map((p) => {
        const rate = p.failureRate === null ? "" : `, ${pct(p.failureRate)} failed or rated down`;
        return `- ${p.summary} (${plural(p.runs, "run", "runs")}, ${plural(p.users, "person", "people")}${rate})`;
      }),
    ),
  ];

  return lines.join("\n").trimEnd().slice(0, MAX_TEXT_CHARS);
}
