import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { jevEnabled, jevScoreItems, jevThreshold } from "./jev.js";
import { recordJudgeOutcome } from "./judge-backend.js";
import { metric } from "./metrics.js";
import { optEnabled } from "./optimizations.js";
import { currentRunTask } from "./run-context.js";

export type SiftKind = "file" | "log";

export interface Section {
  start: number;
  end: number;
  text: string;
}

export interface SiftResult {
  text: string;
  keptLines: number;
  totalLines: number;
  charsBefore: number;
  charsAfter: number;
}

export type SectionScorer = (
  sections: Section[],
  ctx: { task: string; label: string; kind: SiftKind },
) => Promise<Map<number, number> | null>;

const MIN_SECTION_LINES = 12;
const MAX_SECTION_LINES = 80;
const FILE_CHUNK_LINES = 60;
const LOG_CHUNK_LINES = 40;
const PREVIEW_CHARS = 700;
const MIN_REDUCTION = 0.3;
const MIN_KEPT_SECTIONS = 3;

function minChars(): number {
  return Math.max(2_000, Number(process.env["JEV_TOOL_SIFT_MIN_CHARS"]) || 8_000);
}

function chunk(lines: string[], from: number, to: number, size: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = from; i < to; i += size) out.push([i, Math.min(i + size, to)]);
  return out;
}

export function splitSections(text: string, kind: SiftKind, firstLine = 1): Section[] {
  const lines = text.split("\n");
  let ranges: Array<[number, number]>;
  if (kind === "log") {
    ranges = chunk(lines, 0, lines.length, LOG_CHUNK_LINES);
  } else {
    const starts = [0];
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if ((lines[i - 1] ?? "").trim() === "" && line.trim() !== "" && !/^\s/.test(line)) starts.push(i);
    }
    const raw = starts.map((s, i): [number, number] => [s, starts[i + 1] ?? lines.length]);
    const merged: Array<[number, number]> = [];
    for (const r of raw) {
      const last = merged[merged.length - 1];
      if (last && last[1] - last[0] < MIN_SECTION_LINES) last[1] = r[1];
      else merged.push([r[0], r[1]]);
    }
    ranges = merged.flatMap(([a, b]) => (b - a > MAX_SECTION_LINES ? chunk(lines, a, b, FILE_CHUNK_LINES) : [[a, b] as [number, number]]));
  }
  return ranges.map(([a, b]) => ({ start: firstLine + a, end: firstLine + b - 1, text: lines.slice(a, b).join("\n") }));
}

function headline(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.trim().slice(0, 90);
}

export const jevSectionScorer: SectionScorer = async (sections, { task, label, kind }) => {
  if (!jevEnabled() || !task.trim()) return null;
  const state = `The user's request:\n${task.slice(0, 4_000)}\n\n` +
    (kind === "file" ? `The agent read the file ${label}; it is split into parts below.` : `The agent ran ${label}; its output is split into parts below.`);
  const scores = await jevScoreItems(state, sections.map((section, index) => ({ section, index })), {
    purpose: "tool-result-sift",
    key: (item) => String(item.index),
    instructions: (item) =>
      kind === "file"
        ? `This part of the file (lines ${item.section.start}–${item.section.end}) is needed to answer the user's request:\n${item.section.text.slice(0, PREVIEW_CHARS)}`
        : `This part of the output (lines ${item.section.start}–${item.section.end}) shows an error, a failure, or information needed for the user's request:\n${item.section.text.slice(0, PREVIEW_CHARS)}`,
    timeoutMs: jevThreshold("JEV_TOOL_SIFT_TIMEOUT_MS", 4_000),
  });
  return scores ? new Map([...scores].map(([k, v]) => [Number(k), v])) : null;
};

export async function siftText(params: {
  text: string;
  kind: SiftKind;
  label: string;
  task: string;
  firstLine?: number;
  scorer?: SectionScorer;
}): Promise<SiftResult | null> {
  const { text, kind, label, task } = params;
  if (text.length < minChars()) return null;
  const sections = splitSections(text, kind, params.firstLine ?? 1);
  if (sections.length <= MIN_KEPT_SECTIONS) return null;

  const scores = await (params.scorer ?? jevSectionScorer)(sections, { task, label, kind }).catch(() => null);
  if (!scores) return null;

  const threshold = jevThreshold("JEV_TOOL_SIFT_THRESHOLD", 0.35);
  const keep = new Set<number>([0]);
  if (kind === "log") {
    keep.add(sections.length - 1);
    keep.add(sections.length - 2);
  }
  sections.forEach((_, i) => {
    const score = scores.get(i);
    if (score === undefined || score >= threshold) keep.add(i);
  });
  const ranked = sections.map((_, i) => i).sort((a, b) => (scores.get(b) ?? 1) - (scores.get(a) ?? 1));
  for (const i of ranked) {
    if (keep.size >= MIN_KEPT_SECTIONS) break;
    keep.add(i);
  }

  const out: string[] = [];
  let omitted: number[] = [];
  const flush = (): void => {
    if (omitted.length === 0) return;
    const first = sections[omitted[0] ?? 0];
    const last = sections[omitted[omitted.length - 1] ?? 0];
    if (!first || !last) return;
    const heads = omitted.slice(0, 3).map((i) => headline(sections[i]?.text ?? "")).filter(Boolean);
    out.push(`── lines ${first.start}–${last.end} omitted (${last.end - first.start + 1} lines)${heads.length ? `: ${heads.join(" · ")}${omitted.length > 3 ? " …" : ""}` : ""} ──`);
    omitted = [];
  };
  let keptLines = 0;
  sections.forEach((section, i) => {
    if (keep.has(i)) {
      flush();
      out.push(section.text);
      keptLines += section.end - section.start + 1;
    } else {
      omitted.push(i);
    }
  });
  flush();

  const body = out.join("\n");
  if (body.length > text.length * (1 - MIN_REDUCTION)) return null;
  const totalLines = (sections[sections.length - 1]?.end ?? 0) - (sections[0]?.start ?? 0) + 1;
  metric.observe("tool_result_sift_kept_pct", Math.round((body.length / text.length) * 100), { kind });
  recordJudgeOutcome(
    "tool-result-sift",
    `${label}: kept ${keptLines} of ${totalLines} lines · ${text.length} → ${body.length} chars at ≥${threshold}`,
    { kind, kept: [...keep].sort((a, b) => a - b), sections: sections.length },
  );
  return { text: body, keptLines, totalLines, charsBefore: text.length, charsAfter: body.length };
}

function skipBuiltinRead(path: string): boolean {
  return path.includes("/.context/") || /skill|memory/i.test(path);
}

export const toolResultSiftExtension: ExtensionFactory = (pi) => {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "read" || event.isError || !optEnabled("jev_tool_result_sift")) return undefined;
    const path = typeof event.input["path"] === "string" ? event.input["path"] : "";
    if (!path || skipBuiltinRead(path)) return undefined;
    if (event.content.some((block) => block.type !== "text")) return undefined;
    const text = event.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
    const offset = Number(event.input["offset"]);
    const result = await siftText({
      text,
      kind: "file",
      label: path,
      task: currentRunTask(),
      firstLine: Number.isFinite(offset) && offset >= 1 ? Math.floor(offset) : 1,
    });
    if (!result) return undefined;
    const note = `[Showing the parts of ${path} relevant to the request: ${result.keptLines} of ${result.totalLines} lines. Omitted ranges are marked "── lines a–b omitted ──"; read any of them with read offset/limit.]`;
    return { content: [{ type: "text" as const, text: `${note}\n${result.text}` }] };
  });
};
