/**
 * Per-user subsystem taxonomy hint for the Digital Twin's system prompt: the
 * clusters the user's approved memories fall under, so the twin knows what it
 * can search via the memory-search tool. Recall itself lives in memory-search.ts.
 */

import { bankIdForAgent, getMemoryProvider } from "xyne-claw-shared";
import { HINDSIGHT } from "./config.js";

import { createLogger } from "./logger.js";
const log = createLogger("memory");

export interface SubsystemSummary {
  name: string;
  memoryCount: number;
  sampleContent: string;
}

/**
 * List the subsystem taxonomy of the Digital Twin's memory bank, counted only
 * over memories tagged `userTag` (e.g. "user:abc123"). CRITICAL: the twin bank
 * holds every opted-in user's personal memories, distinguished only by that
 * tag. Without the filter the hint would aggregate per-subsystem counts across
 * ALL users — a privacy leak (one user could infer that another exists and
 * roughly what they've populated).
 */
export async function listSubsystemTaxonomy(agentSlug: string, userTag: string): Promise<SubsystemSummary[]> {
  if (!HINDSIGHT.enabled) return [];
  try {
    const provider = getMemoryProvider();
    const bankId = bankIdForAgent(agentSlug);
    const page = await provider.listMemories(bankId, { limit: 200 });
    const acc = new Map<string, { count: number; sample: string }>();
    for (const m of page.memories) {
      const tags = m.tags ?? [];
      // Per-user scoping: drop anything that doesn't carry the requested user tag.
      if (!tags.includes(userTag)) continue;
      const subsystemTag = tags.find((t) => t.startsWith("subsystem:"));
      if (!subsystemTag) continue;
      const name = subsystemTag.slice("subsystem:".length).trim();
      if (!name) continue;
      const cur = acc.get(name);
      if (cur) {
        cur.count += 1;
      } else {
        acc.set(name, { count: 1, sample: (m.content ?? "").slice(0, 80) });
      }
    }
    return Array.from(acc, ([name, v]) => ({ name, memoryCount: v.count, sampleContent: v.sample }))
      .sort((a, b) => b.memoryCount - a.memoryCount);
  } catch (err) {
    log.warn(`[memory] listSubsystemTaxonomy failed for agent=${agentSlug}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** The system-prompt injection that lists the user's top memory clusters. */
export function buildTaxonomyInjection(taxonomy: readonly SubsystemSummary[]): { id: string; label: string; content: string } {
  const lines = taxonomy
    .slice(0, 12)
    .map(
      (s) =>
        `- ${s.name} (${s.memoryCount} ${s.memoryCount === 1 ? "memory" : "memories"})`,
    )
    .join("\n");
  return {
    id: "__memory-taxonomy",
    label: "Your Personal Memory",
    content: [
      "You have a personal memory bank — facts about THIS user that they",
      "themselves approved. Currently you have memories under these clusters:",
      "",
      lines,
      "",
      "When you need to know how the user works, who they collaborate with,",
      "what they prefer, or what they own, call `memory-search` FIRST with a",
      "specific natural-language query. Never invent facts about the user —",
      "only use what the tool returns.",
    ].join("\n"),
  };
}
