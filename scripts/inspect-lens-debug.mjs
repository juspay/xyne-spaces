#!/usr/bin/env node

/**
 * Summarise a large Xyne Lens debug JSON without printing model reasoning,
 * full prompts, file bodies, or binary artifact payloads.
 *
 * Usage: node scripts/inspect-lens-debug.mjs debug_lens.json
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/inspect-lens-debug.mjs <debug-json>");
  process.exit(2);
}

const trace = JSON.parse(await readFile(file, "utf8"));
const text = (value, max = 180) => typeof value === "string"
  ? value.replace(/\s+/g, " ").trim().slice(0, max)
  : "";
const errorExcerpt = (value, max = 1_600) => {
  const normalized = text(value, Number.MAX_SAFE_INTEGER);
  if (normalized.length <= max) return normalized;
  const edge = Math.floor((max - 45) / 2);
  return `${normalized.slice(0, edge)} … [${normalized.length - edge * 2} chars omitted] … ${normalized.slice(-edge)}`;
};
const invocations = Array.isArray(trace.toolInvocations) ? trace.toolInvocations : [];
const byTool = new Map();
const failures = [];
const errorSignatures = new Set();
const isExplicitFailure = (result) => {
  const trimmed = result.trim();
  return trimmed.startsWith("Error:")
    || trimmed.startsWith("{\"error\"")
    || trimmed.startsWith("{\"content\":[{\"type\":\"text\",\"text\":\"Error:")
    || result.includes("Manim render failed")
    || result.includes("oldText was not found");
};
for (const invocation of invocations) {
  const name = typeof invocation.toolName === "string" ? invocation.toolName : "unknown";
  byTool.set(name, (byTool.get(name) ?? 0) + 1);
  const result = typeof invocation.result === "string" ? invocation.result : JSON.stringify(invocation.result ?? "");
  for (const match of result.matchAll(/\b([A-Z][A-Za-z]*(?:Error|Exception):.{0,220})/g)) {
    const signature = match[1].split(/\\n|\r?\n/, 1)[0].trim();
    if (signature) errorSignatures.add(signature);
  }
  if (invocation.isError || invocation.status === "error" || isExplicitFailure(result)) {
    failures.push({ tool: name, args: text(JSON.stringify(invocation.args ?? {})), result: errorExcerpt(result) });
  }
}

const serialized = JSON.stringify(trace);
const count = (needle) => serialized.split(needle).length - 1;

console.log(`Trace: ${basename(file)}`);
console.log(`Conversation: ${trace.conversationId ?? "unknown"}`);
console.log(`Agent/model: ${trace.agentSlug ?? "unknown"} / ${trace.model ?? "unknown"}`);
console.log(`Messages: ${Array.isArray(trace.messages) ? trace.messages.length : 0}`);
console.log(`Tool invocations: ${invocations.length}`);
console.log("\nTool counts:");
for (const [tool, total] of Array.from(byTool.entries()).sort((a, b) => b[1] - a[1])) console.log(`- ${tool}: ${total}`);
console.log("\nSkill bundle markers in trace:");
for (const marker of ["name: xyne-lens", "scene-catalog.md", "long-form-lessons.md", "references/scenes-cs-architecture.py", "session-skills"]) {
  console.log(`- ${marker}: ${count(marker)}`);
}
console.log("\nFailed/error-like tool results:");
for (const failure of failures.slice(0, 80)) console.log(`- ${failure.tool} | ${failure.args}\n  ${failure.result}`);
if (errorSignatures.size) {
  console.log("\nObserved error signatures:");
  for (const signature of errorSignatures) console.log(`- ${signature}`);
}
