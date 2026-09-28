import { jevEnabled, jevScoreItems, jevThreshold } from "./jev.js";
import { recordJudgeOutcome } from "./judge-backend.js";
import { metric } from "./metrics.js";

const MIN_CHARS = Math.max(500, Number(process.env["JEV_RESULT_SIFT_MIN_CHARS"]) || 4_000);
const MIN_ITEMS = Math.max(3, Number(process.env["JEV_RESULT_SIFT_MIN_ITEMS"]) || 8);
const MIN_KEEP = Math.max(1, Number(process.env["JEV_RESULT_SIFT_MIN_KEEP"]) || 5);
const MAX_ITEMS = Math.max(MIN_ITEMS, Number(process.env["JEV_RESULT_SIFT_MAX_ITEMS"]) || 600);
const ITEM_PREVIEW_CHARS = 500;
const MIN_REDUCTION = 0.25;
const SIFT_TIMEOUT_MS = Math.max(500, Number(process.env["JEV_RESULT_SIFT_TIMEOUT_MS"]) || 4_000);

export interface SplitResult {
  head: string;
  items: string[];
  tail: string;
  joiner: string;
}

function looksLikeHeader(block: string): boolean {
  const text = block.trim();
  return text.length < 400 && (/:\s*$/.test(text) || /^(found|showing|\d+)\b/i.test(text));
}

function looksLikeFooter(block: string): boolean {
  const text = block.trim();
  return text.startsWith("[") && text.endsWith("]") && text.length < 600;
}

function splitJson(text: string): SplitResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const asItems = (arr: unknown[]): string[] => arr.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
  if (Array.isArray(parsed)) {
    return parsed.length >= MIN_ITEMS ? { head: "", items: asItems(parsed), tail: "", joiner: "\n" } : null;
  }
  if (parsed && typeof parsed === "object") {
    const entries = Object.entries(parsed as Record<string, unknown>);
    const arrays = entries.filter(([, v]) => Array.isArray(v) && (v as unknown[]).length >= MIN_ITEMS);
    if (arrays.length !== 1) return null;
    const [key, value] = arrays[0]!;
    const rest = Object.fromEntries(entries.filter(([k]) => k !== key));
    return {
      head: `${JSON.stringify(rest)}\n${key}:`,
      items: asItems(value as unknown[]),
      tail: "",
      joiner: "\n",
    };
  }
  return null;
}

function splitBlocks(text: string): SplitResult | null {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  if (blocks.length === 0) return null;
  const head: string[] = [];
  const tail: string[] = [];
  while (blocks.length > 0 && looksLikeHeader(blocks[0]!)) head.push(blocks.shift()!);
  while (blocks.length > 0 && looksLikeFooter(blocks[blocks.length - 1]!)) tail.unshift(blocks.pop()!);
  if (blocks.length >= MIN_ITEMS) {
    return { head: head.join("\n\n"), items: blocks, tail: tail.join("\n\n"), joiner: "\n\n" };
  }
  const largest = blocks.reduce((best, b) => (b.length > best.length ? b : best), "");
  const lines = largest.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < MIN_ITEMS) return null;
  const lengths = lines.map((l) => l.length).sort((a, b) => a - b);
  if ((lengths[Math.floor(lengths.length / 2)] ?? 0) < 40) return null;
  const at = blocks.indexOf(largest);
  return {
    head: [...head, ...blocks.slice(0, at)].join("\n\n"),
    items: lines,
    tail: [...blocks.slice(at + 1), ...tail].join("\n\n"),
    joiner: "\n",
  };
}

export function splitResultItems(text: string): SplitResult | null {
  return splitJson(text) ?? splitBlocks(text);
}

export interface SiftOutcome {
  text: string;
  kept: number;
  total: number;
  charsBefore: number;
  charsAfter: number;
}

export function selectItems(
  items: readonly string[],
  scores: ReadonlyMap<string, number>,
  threshold: number,
  charBudget: number,
): Set<number> {
  const ranked = items
    .map((item, index) => ({ index, size: item.length, score: scores.get(String(index)) }))
    .sort((a, b) => (b.score ?? 1) - (a.score ?? 1) || a.index - b.index);
  const keep = new Set<number>();
  let used = 0;
  for (const entry of ranked) {
    const wanted = entry.score === undefined || entry.score >= threshold || keep.size < MIN_KEEP;
    if (!wanted) continue;
    if (keep.size >= MIN_KEEP && used + entry.size > charBudget) continue;
    keep.add(entry.index);
    used += entry.size;
  }
  return keep;
}

export async function siftToolResult(params: {
  toolName: string;
  content: string;
  task: string;
  charBudget: number;
}): Promise<SiftOutcome | null> {
  const { toolName, content, task } = params;
  if (!jevEnabled() || !task.trim() || content.length < MIN_CHARS) return null;
  const split = splitResultItems(content);
  if (!split || split.items.length < MIN_ITEMS || split.items.length > MAX_ITEMS) return null;

  const started = Date.now();
  const indexed = split.items.map((text, index) => ({ text, index }));
  const scores = await jevScoreItems(
    `The user's request:\n${task.slice(0, 4_000)}\n\nThe agent called the tool \`${toolName}\` and it returned a list of items.`,
    indexed,
    {
      purpose: "result-sift",
      key: (item) => String(item.index),
      instructions: (item) =>
        `This item contains information that helps answer the user's request: ${item.text.slice(0, ITEM_PREVIEW_CHARS)}`,
      timeoutMs: SIFT_TIMEOUT_MS,
    },
  );
  if (!scores) return null;

  const threshold = jevThreshold("JEV_RESULT_THRESHOLD", 0.3);
  const keep = selectItems(split.items, scores, threshold, params.charBudget);
  const keptItems = split.items.filter((_, index) => keep.has(index));
  const body = keptItems.join(split.joiner);
  const charsAfter = split.head.length + body.length + split.tail.length;
  if (charsAfter > content.length * (1 - MIN_REDUCTION)) {
    metric.count("result_sift_skipped", { tool: toolName, reason: "low_reduction" });
    return null;
  }

  metric.observe("result_sift_ms", Date.now() - started, { tool: toolName });
  metric.observe("result_sift_kept_pct", Math.round((keptItems.length / split.items.length) * 100), { tool: toolName });
  recordJudgeOutcome(
    "result-sift",
    `${toolName}: kept ${keptItems.length} of ${split.items.length} items · ${content.length} → ${charsAfter} chars at ≥${threshold}`,
    {
      tool: toolName,
      kept: keptItems.length,
      total: split.items.length,
      charsBefore: content.length,
      charsAfter,
      threshold,
      droppedSample: split.items
        .map((text, index) => ({ index, score: scores.get(String(index)), text: text.slice(0, 120) }))
        .filter((entry) => !keep.has(entry.index))
        .slice(0, 8),
    },
  );

  return {
    text: [split.head, body, split.tail].filter((part) => part.length > 0).join(split.joiner === "\n" ? "\n" : "\n\n"),
    kept: keptItems.length,
    total: split.items.length,
    charsBefore: content.length,
    charsAfter,
  };
}
