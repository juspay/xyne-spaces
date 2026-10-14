import type { ExperimentEpoch, ExperimentFinding, ExperimentReview, ExperimentRun } from "@prisma/client";
import type {
  ExperimentCardStatus,
  ExperimentEpochCard,
  ExperimentEpochStatus,
  ExperimentFindingRow,
  ExperimentKind,
  ExperimentLinks,
  ExperimentPlanItem,
  ExperimentPlanStatus,
  ExperimentStatusCard,
} from "xyne-claw-shared";
import { formatDuration } from "./experiment.js";
import { experimentCounts, formatExperimentModel } from "./webhook-commands/experiment-format.js";

const MAX_CARD_FINDINGS = 8;
const MAX_REPORT_CHARS = 1500;
const MAX_SUMMARY_CHARS = 4000;
const KINDS = new Set<ExperimentKind>(["experiment", "understanding", "framework", "security", "repo-history"]);
const PLAN_STATUSES = new Set<ExperimentPlanStatus>(["pending", "in_progress", "completed", "failed"]);

export function experimentKindOf(kind: string | null | undefined): ExperimentKind {
  return kind && KINDS.has(kind as ExperimentKind) ? (kind as ExperimentKind) : "experiment";
}

export function experimentExitRule(kind: string | null | undefined, durationMs: number): string {
  const cap = formatDuration(durationMs);
  switch (experimentKindOf(kind)) {
    case "understanding":
      return `Ends when every open code path is closed, or after ${cap} at most.`;
    case "framework":
      return `Ends when every candidate is closed, or after ${cap} at most.`;
    case "repo-history":
      return "Ends when the commit walk reaches HEAD.";
    case "security":
      return `Time-boxed: runs for the full ${cap}.`;
    default:
      return `Time-boxed: runs for the full ${cap}.`;
  }
}

export function experimentCardStatus(status: string): ExperimentCardStatus {
  if (status === "finishing") return "finishing";
  if (status === "done") return "done";
  if (status === "aborted") return "stopped";
  return "running";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function headline(focus: string | null | undefined, kind: ExperimentKind): string {
  const first = focus?.split("\n").find((line) => line.trim())?.trim();
  if (!first) return kind === "experiment" ? "Autonomous experiment" : `${kind} run`;
  const beforeColon = first.split(":")[0]?.trim() ?? "";
  return truncate(beforeColon.length >= 8 && beforeColon.length < first.length ? beforeColon : first, 90);
}

function latestVerdicts(reviews: ExperimentReview[]): Map<string, ExperimentReview> {
  const byFinding = new Map<string, ExperimentReview>();
  for (const review of [...reviews].sort((a, b) => a.epoch - b.epoch)) byFinding.set(review.findingId, review);
  return byFinding;
}

function findingRow(finding: ExperimentFinding, verdict: ExperimentReview | undefined): ExperimentFindingRow {
  const status = finding.status === "proved" || finding.status === "refuted" ? finding.status : "conjecture";
  return {
    title: truncate(finding.title, 200),
    status,
    epoch: finding.epoch,
    ...(finding.proofArtifactPath?.trim() ? { proof: finding.proofArtifactPath.trim().split("/").pop() ?? "" } : {}),
    ...(verdict && verdict.verdict !== "confirms" ? { verdict: verdict.verdict } : {}),
  };
}

export function experimentFindingRows(
  findings: ExperimentFinding[],
  reviews: ExperimentReview[],
  limit = MAX_CARD_FINDINGS,
): ExperimentFindingRow[] {
  const verdicts = latestVerdicts(reviews);
  return [...findings]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, limit)
    .map((finding) => findingRow(finding, verdicts.get(finding.id)));
}

export function epochLinks(epoch: Pick<ExperimentEpoch, "previewUrl" | "codeUrl" | "terminalUrl">): ExperimentLinks | undefined {
  const links: ExperimentLinks = {
    ...(epoch.previewUrl ? { preview: epoch.previewUrl } : {}),
    ...(epoch.codeUrl ? { code: epoch.codeUrl } : {}),
    ...(epoch.terminalUrl ? { terminal: epoch.terminalUrl } : {}),
  };
  return Object.keys(links).length > 0 ? links : undefined;
}

export function buildExperimentStatusCard(args: {
  run: ExperimentRun;
  findings: ExperimentFinding[];
  reviews: ExperimentReview[];
  epochs: ExperimentEpoch[];
  now?: Date;
}): ExperimentStatusCard {
  const { run, findings, reviews, epochs } = args;
  const now = args.now ?? new Date();
  const kind = experimentKindOf(run.kind);
  const counts = experimentCounts(findings);
  const status = experimentCardStatus(run.status);
  const ended = status === "done" || status === "stopped";
  const newestFirst = [...epochs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const withLinks = newestFirst.find((epoch) => epochLinks(epoch));
  const withNeeds = newestFirst.find((epoch) => epoch.needsYou.length > 0);
  const links = withLinks ? epochLinks(withLinks) : undefined;
  return {
    runId: run.id,
    kind,
    status,
    title: headline(run.focus, kind),
    ...(run.focus?.trim() ? { focus: run.focus.trim() } : {}),
    model: run.provider ? formatExperimentModel(run.provider, run.modelId) : "agent default",
    exitRule: experimentExitRule(run.kind, run.deadlineAt.getTime() - run.createdAt.getTime()),
    startedAt: run.createdAt.toISOString(),
    deadlineAt: run.deadlineAt.toISOString(),
    ...(ended ? { endedAt: (run.lastEpochEndedAt ?? run.updatedAt).toISOString() } : {}),
    updatedAt: now.toISOString(),
    epoch: run.epoch,
    counts: { proved: counts.proved, refuted: counts.refuted, open: counts.conjecture },
    epochs: {
      completed: epochs.filter((epoch) => epoch.status === "done").length,
      failed: epochs.filter((epoch) => epoch.status === "failed").length,
    },
    ...(status === "running" && run.currentHypothesis?.trim() ? { hypothesis: truncate(run.currentHypothesis.trim(), 400) } : {}),
    findings: experimentFindingRows(findings, reviews),
    totalFindings: findings.length,
    needsYou: withNeeds ? withNeeds.needsYou.slice(0, 5) : [],
    ...(links && !ended ? { links } : {}),
    ...(ended && run.finalReport?.trim() ? { report: truncate(run.finalReport.trim(), MAX_REPORT_CHARS) } : {}),
  };
}

export function planItemsFrom(value: unknown): ExperimentPlanItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ExperimentPlanItem[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row["id"] === "string" ? row["id"] : "";
    const title = typeof row["title"] === "string" ? row["title"] : "";
    const status = typeof row["status"] === "string" && PLAN_STATUSES.has(row["status"] as ExperimentPlanStatus)
      ? (row["status"] as ExperimentPlanStatus)
      : "pending";
    return id && title ? [{ id, title, status }] : [];
  });
}

export function buildExperimentEpochCard(args: {
  run: ExperimentRun;
  epoch: ExperimentEpoch;
  findings: ExperimentFinding[];
  reviews: ExperimentReview[];
}): ExperimentEpochCard {
  const { run, epoch } = args;
  const running = epoch.status === "running";
  const hypothesis = epoch.hypothesis?.trim() ?? "";
  const epochFindings = args.findings.filter((finding) => finding.epoch === epoch.epoch);
  const links = running ? epochLinks(epoch) : undefined;
  return {
    runId: run.id,
    epoch: epoch.epoch,
    status: epoch.status as ExperimentEpochStatus,
    ...(hypothesis ? { hypothesis: truncate(hypothesis, 400) } : {}),
    plan: planItemsFrom(epoch.plan),
    ...(links ? { links } : {}),
    retries: epoch.retries,
    ...(epoch.error?.trim() ? { error: truncate(epoch.error.trim(), 400) } : {}),
    ...(epoch.summary?.trim() ? { summary: truncate(epoch.summary.trim(), MAX_SUMMARY_CHARS) } : {}),
    attachments: epoch.attachmentNames,
    findings: experimentFindingRows(epochFindings, args.reviews, 20),
    startedAt: epoch.startedAt.toISOString(),
    ...(epoch.endedAt ? { endedAt: epoch.endedAt.toISOString() } : {}),
  };
}

const USER_MENTION_SPAN = /<span[^>]*data-mention-type="user"[^>]*>(@[^<]*)<\/span>/g;

export function plainMentions(text: string): string {
  return text.replace(USER_MENTION_SPAN, "$1");
}

export function splitMentionLines(text: string): { body: string; mentionLines: string[] } {
  const blocks = text.split(/\n{2,}/);
  const mentionLines: string[] = [];
  for (const block of blocks) {
    for (const line of block.split("\n")) {
      if (/data-mention-type="user"/.test(line)) mentionLines.push(line.trim());
    }
  }
  return { body: plainMentions(text).trim(), mentionLines };
}

export function experimentFailureText(payload: { error?: string | null; emptyReason?: string | null; emptyReasonDetail?: string | null }): string {
  if (payload.emptyReason === "provider_capacity") {
    return `The AI provider had a temporary problem${payload.emptyReasonDetail ? ` — ${payload.emptyReasonDetail}` : ""}.`;
  }
  const raw = String(payload.error ?? "");
  if (/\b429\b|quota|rate.?limit|exceeded|out of credit/i.test(raw)) return "The provider is out of quota or rate-limited.";
  if (/cancel/i.test(raw)) return "Cancelled.";
  return "The epoch stopped with an internal error.";
}
