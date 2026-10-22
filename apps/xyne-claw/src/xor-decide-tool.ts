import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { buildSandboxStoreKey, getSandboxSession, sandboxConversationIdFromMeta, xorDecideTool } from "xyne-claw-shared";
import { decideBatch, formatDecisions, MAX_ITEMS, validateQuestions, type DecideItem } from "./xor-decide.js";
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

export function buildXorDecideTool(meta: Record<string, string>): ToolDefinition {
  const tool: ToolDefinition = {
    name: xorDecideTool.slug,
    label: "xor decide",
    description: xorDecideTool.description,
    parameters: Type.Unsafe(xorDecideTool.inputSchema as unknown as Record<string, unknown>),
    async execute(_toolCallId: string, params: unknown, signal?: AbortSignal) {
      const p = (params ?? {}) as { items?: unknown; questions?: unknown; context?: unknown };
      const q = validateQuestions(p.questions);
      if ("error" in q) return text(`Error: ${q.error}`);
      const it = await prepareItems(p.items, meta);
      if ("error" in it) return text(`Error: ${it.error}`);
      const started = Date.now();
      const result = await decideBatch({
        items: it.items,
        questions: q.questions,
        ...(typeof p.context === "string" ? { context: p.context.slice(0, 4_000) } : {}),
        purpose: "xor-decide",
        ...(signal ? { signal } : {}),
      });
      const unsure = result.summary.reduce((n, s) => n + s.unsure, 0);
      metric.count("xor_decide_call", { items: it.items.length, questions: q.questions.length, unsure, unavailable: result.unavailable });
      log.info(`[xor-decide] ${it.items.length} items × ${q.questions.length} questions in ${Date.now() - started}ms unsure=${unsure} unavailable=${result.unavailable}`);
      return text(formatDecisions(q.questions, result), { result });
    },
  };
  Object.assign(tool, { slug: xorDecideTool.slug, source: xorDecideTool.source });
  return tool;
}
