/**
 * Generic auto-citations.
 *
 * When an agent enables `autoToolCitations` (agentConfig), EVERY tool result
 * that doesn't already self-cite is split into chunks, each prefixed with an
 * inline `[clf-<toolCallId>#N]` token, and one lightweight structured citation
 * (kind: "external", no url, label = tool name) is recorded per chunk. This lets
 * the model cite ANY tool's output the same way the hand-written spaces/google
 * tool citations do — without touching those tools: a result that already
 * carries a `[clf-…]` token is detected and left untouched, so the existing
 * citation system is unaffected.
 *
 * The wrapper that calls this lives in agent.ts (`wrapAutoCitations`), applied
 * to the assembled `options.customTools` — which is EVERY tool the agent uses
 * (scoped file tools, MCP, sandbox). pi's `execute(toolCallId, …)` contract
 * gives us the toolCallId uniformly, so this is the one chokepoint that covers
 * all tools.
 */
import type { Citation } from "xyne-claw-shared";
import { toolIconKey } from "xyne-claw-shared";
import { recordCitations } from "./citations.js";

/** Matches an existing inline clf citation token (same shape agent.ts's citation
 *  reflection uses). A result already carrying one is self-citing — we skip it
 *  so tools that emit their own citations are never double-processed. */
const CLF_TOKEN_RE = /\[clf-[a-z0-9._:-]+#\d+\]/i;

/** Paragraphs shorter than this are merged forward so we don't mint a citation
 *  per stray line. */
const MIN_CHUNK_CHARS = 120;
/** Hard cap on chunks per result — a noisy tool can't mint dozens of citations;
 *  overflow folds into the final chunk. */
const MAX_CHUNKS = 24;

/**
 * Split arbitrary tool text into citeable chunks. Paragraph-based (blank-line
 * separated), merging tiny fragments forward and capping the total. A single
 * blob (JSON / one paragraph) stays one chunk.
 */
export function chunkToolText(text: string): string[] {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paras.length <= 1) {
    const trimmed = text.trim();
    return trimmed ? [trimmed] : [];
  }
  const merged: string[] = [];
  for (const para of paras) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.length < MIN_CHUNK_CHARS) {
      merged[merged.length - 1] = `${last}\n\n${para}`;
    } else {
      merged.push(para);
    }
  }
  if (merged.length > MAX_CHUNKS) {
    const head = merged.slice(0, MAX_CHUNKS - 1);
    head.push(merged.slice(MAX_CHUNKS - 1).join("\n\n"));
    return head;
  }
  return merged;
}

/**
 * Prefix each chunk of `text` with an inline `[clf-<toolCallId>#N]` token and
 * record one generic citation per chunk under `toolCallId`. Returns the
 * tokenized text. No-op (returns the input unchanged) when the text is empty or
 * already self-cites.
 */
export function applyAutoCitations(
  text: string,
  toolCallId: string,
  toolName: string,
): string {
  if (!text || !text.trim()) return text;
  if (CLF_TOKEN_RE.test(text)) return text; // already self-cited — leave it alone
  const chunks = chunkToolText(text);
  if (chunks.length === 0) return text;
  const label = toolName || "Tool result";
  // Wrench mark, colored deterministically per tool call so each source is
  // visually distinct (stable across reloads). Set on iconKey explicitly so
  // stampIconKeys leaves it (citationIconKey returns nothing for a url-less
  // external).
  const iconKey = toolIconKey(toolCallId);
  const citations: Citation[] = [];
  const tokenized = chunks.map((chunk, i) => {
    const chunkIndex = i + 1;
    // Generic citation: no url (not a linkable resource). The dashboard chip
    // opens the tool call in the debug panel; the v3 panel shows the chunk text
    // parsed straight from this tokenized result.
    citations.push({ kind: "external", label, chunkIndex, iconKey });
    return `[clf-${toolCallId}#${chunkIndex}] ${chunk}`;
  });
  recordCitations(toolCallId, citations);
  return tokenized.join("\n\n");
}
