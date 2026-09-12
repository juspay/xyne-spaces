import { experimentRepository } from "../../repositories/index.js";
import { formatDuration } from "../experiment.js";

export function experimentCounts(findings: Array<{ status: string }>): { conjecture: number; proved: number; refuted: number } {
  return {
    conjecture: findings.filter((f) => f.status === "conjecture").length,
    proved: findings.filter((f) => f.status === "proved").length,
    refuted: findings.filter((f) => f.status === "refuted").length,
  };
}

const EXPERIMENT_FINDINGS_MAX_BYTES = 200 * 1024;

export function capExperimentFindingsMarkdown(markdown: string): string {
  if (Buffer.byteLength(markdown, "utf8") <= EXPERIMENT_FINDINGS_MAX_BYTES) return markdown;
  const suffix = "\n\n---\n\n_Report truncated at 200KB for Spaces file delivery._\n";
  let capped = markdown;
  while (Buffer.byteLength(capped + suffix, "utf8") > EXPERIMENT_FINDINGS_MAX_BYTES && capped.length > 0) {
    capped = capped.slice(0, Math.max(0, capped.length - 4096));
  }
  return `${capped.trimEnd()}${suffix}`;
}

export function experimentFindingsFilename(agentSlug: string, date = new Date()): string {
  const safeSlug = agentSlug.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "agent";
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, "").replace(/:/g, "-");
  return `experiment-findings-${safeSlug}-${stamp}.md`;
}

export function formatExperimentStatus(
  run: Awaited<ReturnType<typeof experimentRepository.findActiveByConversation>>,
  findings: Array<{ status: string; title: string; epoch: number; createdAt: Date }>,
): string {
  if (!run) return "No active /experiment in this thread.";
  const elapsedMs = Date.now() - run.createdAt.getTime();
  const remainingMs = Math.max(0, run.deadlineAt.getTime() - Date.now());
  const counts = experimentCounts(findings);
  const recent = [...findings]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5);
  const icon = (status: string) => status === "proved" ? "✓" : status === "refuted" ? "✗" : "◉";
  return [
    `**/experiment status** — epoch ${run.epoch}`,
    `Elapsed: ${formatDuration(elapsedMs)} · Remaining: ${formatDuration(remainingMs)}`,
    ...(run.provider ? [`Model: ${formatExperimentModel(run.provider, run.modelId)}`] : []),
    `Now: ${run.currentHypothesis?.trim() || "(no current hypothesis recorded)"}`,
    `Findings: ${counts.conjecture} open · ${counts.proved} proved · ${counts.refuted} refuted`,
    recent.length
      ? ["", ...recent.map((f) => `${icon(f.status)} [epoch ${f.epoch}] ${f.title}`)].join("\n")
      : "\nNo findings recorded yet.",
  ].join("\n");
}

export function formatExperimentModel(provider: string, modelId?: string | null): string {
  return modelId?.trim() ? `${provider}/${modelId.trim()}` : `${provider} (default)`;
}
