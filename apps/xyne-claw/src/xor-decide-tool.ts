import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildSandboxStoreKey, getSandboxSession, sandboxConversationIdFromMeta, xorDecideTool } from "xyne-claw-shared";
import { decideBatch, formatDecisions, MAX_ITEMS, validateQuestions, type DecideItem, type DecideQuestion, type DecideResult } from "./xor-decide.js";
import { recordDebug } from "./citations.js";
import { currentSubagentMcpId } from "./subagent-mcp-context.js";
import { isImageDataUrl } from "./xor.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("xor-decide");
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ID = /^[a-zA-Z0-9_.:-]{1,80}$/;

function text(t: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text: t }], details };
}

async function readSandboxImage(meta: Record<string, string>, path: string): Promise<string | null> {
  const key = buildSandboxStoreKey(meta["userId"], sandboxConversationIdFromMeta(meta), meta["agentSlug"]);
  const session = key ? getSandboxSession(key) : undefined;
  if (!session) return null;
  try {
    const buf = await session.files.read(path);
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    const mime = /\.jpe?g$/i.test(path) ? "jpeg" : /\.webp$/i.test(path) ? "webp" : "png";
    return `data:image/${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function prepareItems(
  raw: unknown,
  meta: Record<string, string>,
  readImage: (path: string) => Promise<string | null> = (p) => readSandboxImage(meta, p),
): Promise<{ items: DecideItem[] } | { error: string }> {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "items must be a non-empty array" };
  if (raw.length > MAX_ITEMS) return { error: `at most ${MAX_ITEMS} items per call — split the rest into another call` };
  const seen = new Set<string>();
  const items: DecideItem[] = [];
  for (const it of raw as Array<Record<string, unknown>>) {
    const id = typeof it?.["id"] === "string" ? it["id"] : "";
    if (!ID.test(id) || seen.has(id)) return { error: `every item needs a unique id (letters, digits, . : _ -), bad: ${JSON.stringify(it?.["id"])}` };
    seen.add(id);
    const t = typeof it["text"] === "string" ? it["text"].slice(0, 12_000) : undefined;
    let image = typeof it["image"] === "string" ? it["image"] : undefined;
    if (image && !isImageDataUrl(image)) return { error: `item "${id}": image must be a base64 data URL (data:image/png;base64,…)` };
    if (!image && typeof it["imagePath"] === "string") {
      image = (await readImage(it["imagePath"])) ?? undefined;
      if (!image) return { error: `item "${id}": could not read image ${it["imagePath"]} from your sandbox (missing, empty or over 8 MB)` };
    }
    if (!t && !image) return { error: `item "${id}" needs text, image or imagePath` };
    items.push({ id, ...(t ? { text: t } : {}), ...(image ? { image } : {}) });
  }
  return { items };
}

const HOUR_MS = 3_600_000;
const usage = new Map<string, Array<{ at: number; items: number }>>();
const REVIEW_RATE = Math.min(1, Math.max(0, Number(process.env["XOR_REVIEW_SAMPLE_RATE"] ?? 0.2)));
const REVIEW_PER_CALL = 2;

export function quotaCheck(key: string, items: number, perHour: number, now = Date.now()): { ok: true } | { ok: false; used: number } {
  const recent = (usage.get(key) ?? []).filter((u) => now - u.at < HOUR_MS);
  const used = recent.reduce((n, u) => n + u.items, 0);
  if (used + items > perHour) {
    usage.set(key, recent);
    return { ok: false, used };
  }
  recent.push({ at: now, items });
  usage.set(key, recent);
  return { ok: true };
}

export function resetXorQuotas(): void {
  usage.clear();
}

export interface ReviewSample {
  item: string;
  questionId: string;
  question: string;
  value: string | number | boolean;
  confidence: number;
}

export function pickReviewSamples(items: DecideItem[], questions: DecideQuestion[], result: DecideResult, rate = REVIEW_RATE, random: () => number = Math.random): ReviewSample[] {
  if (rate <= 0 || random() >= rate) return [];
  const pool: ReviewSample[] = [];
  for (const [i, it] of result.items.entries()) {
    const source = items[i];
    for (const q of questions) {
      const a = it.answers[q.id];
      if (!a || a.unsure || a.value === null || a.confidence === null) continue;
      pool.push({ item: source?.text ? source.text.slice(0, 400) : "[image]", questionId: q.id, question: q.question, value: a.value, confidence: a.confidence });
    }
  }
  const out: ReviewSample[] = [];
  while (out.length < REVIEW_PER_CALL && pool.length > 0) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  return out;
}

export function decideStats(questions: DecideQuestion[], result: DecideResult, ms: number) {
  return {
    items: result.items.length,
    questions: questions.length,
    answers: result.items.length * questions.length,
    unsure: result.summary.reduce((n, s) => n + s.unsure, 0),
    failedExpect: result.summary.reduce((n, s) => n + s.failedExpect, 0),
    unavailable: result.unavailable,
    cached: result.cached,
    ms,
  };
}

export function buildXorDecideTool(meta: Record<string, string>, options: { itemsPerHour?: Record<string, number> } = {}): ToolDefinition {
  const tool: ToolDefinition = {
    name: xorDecideTool.slug,
    label: "xor decide",
    description: xorDecideTool.description,
    parameters: Type.Unsafe(xorDecideTool.inputSchema as unknown as Record<string, unknown>),
    async execute(toolCallId: string, params: unknown, signal?: AbortSignal) {
      const p = (params ?? {}) as { items?: unknown; questions?: unknown; context?: unknown };
      const q = validateQuestions(p.questions);
      if ("error" in q) return text(`Error: ${q.error}`);
      const it = await prepareItems(p.items, meta);
      if ("error" in it) return text(`Error: ${it.error}`);
      const subagentId = currentSubagentMcpId();
      const perHour = subagentId ? options.itemsPerHour?.[subagentId] : undefined;
      if (subagentId && perHour) {
        const q2 = quotaCheck(subagentId, it.items.length, perHour);
        if (!q2.ok) {
          metric.count("xor_decide_quota", { subagent: subagentId });
          recordDebug(toolCallId, { xor: { quotaBlocked: true, items: it.items.length } });
          return text(`Error: this subagent's xor quota is ${perHour} items per hour and ${q2.used} were used in the last hour. Report what you have and say the rest was not checked because of the quota.`);
        }
      }
      const started = Date.now();
      const result = await decideBatch({
        items: it.items,
        questions: q.questions,
        ...(typeof p.context === "string" ? { context: p.context.slice(0, 4_000) } : {}),
        purpose: "xor-decide",
        ...(signal ? { signal } : {}),
      });
      const unsure = result.summary.reduce((n, s) => n + s.unsure, 0);
      metric.count("xor_decide_call", { items: it.items.length, questions: q.questions.length, unsure, unavailable: result.unavailable, cached: result.cached });
      const review = pickReviewSamples(it.items, q.questions, result);
      recordDebug(toolCallId, { xor: decideStats(q.questions, result, Date.now() - started), ...(review.length ? { review } : {}) });
      log.info(`[xor-decide] ${it.items.length} items × ${q.questions.length} questions in ${Date.now() - started}ms unsure=${unsure} unavailable=${result.unavailable}`);
      return text(formatDecisions(q.questions, result), { result });
    },
  };
  Object.assign(tool, { slug: xorDecideTool.slug, source: xorDecideTool.source });
  return tool;
}
