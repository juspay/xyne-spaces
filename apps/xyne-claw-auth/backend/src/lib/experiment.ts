import type { ExperimentFinding, ExperimentReview, ExperimentRun } from "@prisma/client";
import { CONFIG } from "../config.js";
import { experimentRepository, agentRepository } from "../repositories/index.js";
import { setSession, type SessionContext } from "./session-context.js";
import { registerRunRecovery } from "../queue/run-recovery-worker.js";
import { createTraceId, createLogger } from "../logger.js";
import { decryptStoredField, spacesAppFetch } from "../surfaces/spaces/client.js";

const log = createLogger("experiment");

const MAX_DURATION_MS = 8 * 60 * 60 * 1000;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export type ExperimentCommand =
  | { sub: "start"; durationMs: number; focus?: string; provider?: string; model?: string; invalidProvider?: string; kind?: "understanding" }
  | { sub: "status" }
  | { sub: "stop" }
  | { sub: "findings"; id?: string }
  | { sub: "list" }
  | { sub: "unknown"; token: string };

/** Providers a /experiment run may pin (must stay a subset of the /internal/run
 *  proxy's OVERRIDABLE set — personal-cred providers still require the
 *  requester's own key, enforced by the proxy at dispatch time). */
export const EXPERIMENT_PROVIDERS = new Set(["spaces", "litellm", "claude", "codex", "copilot"]);

const LEADING_MENTIONS = /^(?:@[\w.\-]+(?:\s+[\w.\-]+)*\s*)+/;

export function parseExperimentCommand(text: string | undefined | null): ExperimentCommand | null {
  if (!text) return null;
  const trimmed = text.trim().replace(LEADING_MENTIONS, "");
  const lower = trimmed.toLowerCase();
  // /understanding is /experiment's coverage-gated sibling: identical epoch loop
  // and subcommands, but the run is tagged so end-experiment stays locked until
  // the open-conjecture frontier is exhausted (the epoch runtime keys off the
  // dispatch payload's `kind`). Everything below is shared parsing.
  const commandWord = lower.startsWith("/understanding")
    ? "/understanding"
    : lower.startsWith("/experiment")
      ? "/experiment"
      : null;
  if (!commandWord) return null;
  const kind = commandWord === "/understanding" ? ("understanding" as const) : undefined;
  const rest = trimmed.slice(commandWord.length).trim();
  if (!rest) return { sub: "start", durationMs: DEFAULT_DURATION_MS, ...(kind ? { kind } : {}) };
  const [first, ...tail] = rest.split(/\s+/);
  const firstLower = first?.toLowerCase() ?? "";
  if (firstLower === "status") return { sub: "status" };
  if (firstLower === "stop") return { sub: "stop" };
  if (firstLower === "findings") return { sub: "findings", ...(tail[0] ? { id: tail[0] } : {}) };
  if (firstLower === "list" || firstLower === "runs") return { sub: "list" };

  let durationMs = DEFAULT_DURATION_MS;
  let focusParts = rest.split(/\s+/);
  const durationMatch = /^(\d+)(m|h)$/i.exec(firstLower);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    durationMs = durationMatch[2]!.toLowerCase() === "h"
      ? amount * 60 * 60 * 1000
      : amount * 60 * 1000;
    focusParts = tail;
  } else if (focusParts.length === 1 && !/^(?:focus|provider|model)=/i.test(firstLower)) {
    return { sub: "unknown", token: first! };
  }
  durationMs = Math.min(Math.max(durationMs, 1), MAX_DURATION_MS);
  const { focusParts: cleanedFocusParts, provider, model, invalidProvider } = extractProviderOverride(focusParts);
  const focus = normalizeFocus(cleanedFocusParts.join(" "));
  const resolvedProvider = invalidProvider === undefined
    ? provider ?? (model ? "spaces" : undefined)
    : undefined;
  return {
    sub: "start",
    durationMs,
    ...(focus ? { focus } : {}),
    ...(resolvedProvider ? { provider: resolvedProvider } : {}),
    ...(model ? { model } : {}),
    ...(invalidProvider !== undefined ? { invalidProvider } : {}),
    ...(kind ? { kind } : {}),
  };
}

export async function cancelRunSession(sessionId: string, userId: string): Promise<void> {
  const cancelRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      "x-user-id": userId,
    },
  });
  if (!cancelRes.ok) {
    const body = (await cancelRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Cancel failed: HTTP ${cancelRes.status}`);
  }
}

function normalizeFocus(raw: string): string | undefined {
  const value = raw.trim().replace(/^focus=/i, "").trim();
  return value ? value.slice(0, 1000) : undefined;
}

function extractProviderOverride(parts: string[]): {
  focusParts: string[];
  provider?: string;
  model?: string;
  invalidProvider?: string;
} {
  let provider: string | undefined;
  let model: string | undefined;
  let invalidProvider: string | undefined;
  const focusParts: string[] = [];

  for (const part of parts) {
    const match = /^([^=]+)=(.*)$/.exec(part);
    const key = match?.[1]?.toLowerCase();
    if (key === "provider") {
      const rawProvider = match?.[2] ?? "";
      const normalizedProvider = rawProvider.toLowerCase();
      if (EXPERIMENT_PROVIDERS.has(normalizedProvider)) {
        provider = normalizedProvider;
      } else {
        invalidProvider = rawProvider;
      }
      continue;
    }
    if (key === "model") {
      const rawModel = match?.[2] ?? "";
      if (rawModel) model = rawModel;
      continue;
    }
    focusParts.push(part);
  }

  return {
    focusParts,
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(invalidProvider !== undefined ? { invalidProvider } : {}),
  };
}

function formatRemaining(deadlineAt: Date): string {
  const ms = Math.max(0, deadlineAt.getTime() - Date.now());
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

export function buildLedgerMarkdown(
  run: ExperimentRun,
  findings: ExperimentFinding[],
  reviews: ExperimentReview[] = [],
): string {
  // Latest verdict per finding. Surfaced inline so the next epoch reads the
  // checker's objection at the point it would otherwise build on the finding.
  const verdictByFinding = new Map<string, ExperimentReview>();
  for (const review of reviews) verdictByFinding.set(review.findingId, review);
  const groups = {
    conjecture: findings.filter((f) => f.status === "conjecture"),
    proved: findings.filter((f) => f.status === "proved"),
    refuted: findings.filter((f) => f.status === "refuted"),
  };
  const lines = [
    `# /experiment ledger`,
    ``,
    `- Epoch: ${run.epoch}`,
    `- Deadline: ${run.deadlineAt.toISOString()}`,
    `- Remaining: ${formatRemaining(run.deadlineAt)}`,
    `- Focus: ${run.focus?.trim() || "(none)"}`,
    ``,
  ];
  // Cap what each group renders: this markdown is injected into EVERY later
  // epoch's task, so unbounded growth compounds over an 8h run. Newest entries
  // win (they carry the freshest context); older ones stay in the DB and the
  // status/report paths, just not in the per-epoch prompt.
  const MAX_PER_GROUP = 20;
  const appendGroup = (heading: string, rows: ExperimentFinding[]) => {
    lines.push(`## ${heading}`);
    if (rows.length === 0) {
      lines.push(`- (none)`, ``);
      return;
    }
    const shown = rows.slice(-MAX_PER_GROUP);
    if (rows.length > shown.length) {
      lines.push(`- (… ${rows.length - shown.length} older entr${rows.length - shown.length === 1 ? "y" : "ies"} omitted — full ledger is in the database)`);
    }
    for (const f of shown) {
      lines.push(`- [epoch ${f.epoch}] ${f.title}`);
      lines.push(`  Hypothesis: ${f.hypothesis}`);
      if (f.note?.trim()) lines.push(`  Note: ${f.note.trim()}`);
      if (f.proofArtifactPath?.trim()) lines.push(`  Proof: ${f.proofArtifactPath.trim()}`);
      const verdict = verdictByFinding.get(f.id);
      if (verdict && verdict.verdict !== "confirms") {
        lines.push(`  ⚠️ CHECKER (epoch ${verdict.epoch}) says ${verdict.verdict.toUpperCase()}: ${verdict.reason}`);
      }
    }
    lines.push(``);
  };
  appendGroup("Open conjectures", groups.conjecture);
  appendGroup("Proved", groups.proved);
  appendGroup("Refuted", groups.refuted);
  return lines.join("\n").trimEnd();
}

function countsByStatus(findings: ExperimentFinding[]): { conjecture: number; proved: number; refuted: number } {
  return {
    conjecture: findings.filter((f) => f.status === "conjecture").length,
    proved: findings.filter((f) => f.status === "proved").length,
    refuted: findings.filter((f) => f.status === "refuted").length,
  };
}

export function buildFindingsMarkdown(
  run: ExperimentRun,
  findings: ExperimentFinding[],
  reviews: ExperimentReview[] = [],
): string {
  const counts = countsByStatus(findings);
  // The checker's verdict travels WITH the finding into triage. A finding a
  // second agent contradicted must never reach a human looking identical to
  // one it confirmed.
  const verdictByFinding = new Map<string, ExperimentReview>();
  for (const review of reviews) verdictByFinding.set(review.findingId, review);
  const model = run.provider?.trim()
    ? `${run.provider.trim()}${run.modelId?.trim() ? `/${run.modelId.trim()}` : " (default)"}`
    : "(agent default)";
  const appendGroup = (lines: string[], heading: string, rows: ExperimentFinding[]) => {
    lines.push(`## ${heading}`);
    if (rows.length === 0) {
      lines.push(``, `(none)`, ``);
      return;
    }
    for (const f of rows) {
      lines.push(``, `### ${f.title}`, ``);
      lines.push(`- Epoch: ${f.epoch}`);
      lines.push(`- Hypothesis: ${f.hypothesis}`);
      lines.push(`- Note: ${f.note?.trim() || "(none)"}`);
      lines.push(`- Proof artifact path: ${f.proofArtifactPath?.trim() || "(none)"}`);
      const verdict = verdictByFinding.get(f.id);
      lines.push(verdict
        ? `- Checker verdict: **${verdict.verdict}** (epoch ${verdict.epoch}) — ${verdict.reason}${verdict.duplicateOf ? ` [duplicate of ${verdict.duplicateOf}]` : ""}`
        : `- Checker verdict: (not reviewed)`);
    }
    lines.push(``);
  };

  const lines = [
    `# /experiment findings for ${run.agentSlug} - ${run.createdAt.toISOString().slice(0, 10)}`,
    ``,
    `- Experiment id: ${run.id}`,
    `- Agent: ${run.agentSlug}`,
    `- Model: ${model}`,
    `- Focus: ${run.focus?.trim() || "(none)"}`,
    `- Duration: ${run.createdAt.toISOString()} -> ${run.deadlineAt.toISOString()} (${formatDuration(run.deadlineAt.getTime() - run.createdAt.getTime())})`,
    `- Status: ${run.status}`,
    `- Epochs completed: ${Math.max(0, run.epoch - (run.status === "running" ? 1 : 0))}`,
    `- Counts by status: ${counts.proved} proved, ${counts.conjecture} conjecture, ${counts.refuted} refuted`,
    ``,
  ];
  appendGroup(lines, "Confirmed / Proved", findings.filter((f) => f.status === "proved"));
  appendGroup(lines, "Open conjectures", findings.filter((f) => f.status === "conjecture"));
  appendGroup(lines, "Refuted", findings.filter((f) => f.status === "refuted"));
  if (run.finalReport?.trim()) {
    lines.push(`## Final report`, ``, run.finalReport.trim(), ``);
  }
  return lines.join("\n").trimEnd();
}

export async function postExperimentNotice(run: { channelId: string; conversationId: string; agentSlug: string; orgId: string | null; finalReport?: string | null }): Promise<void> {
  if (!run.orgId) return;
  const agent = await agentRepository.findBySlug(run.agentSlug, run.orgId);
  if (!agent?.spacesAppToken || !agent.spacesAppUserId) return;
  const appToken = decryptStoredField(agent.spacesAppToken);
  await spacesAppFetch("/chat/postMessage", {
    channelId: run.channelId,
    conversationId: run.conversationId,
    markdownText: run.finalReport?.trim()
      ? `**/experiment ended**\n\n${run.finalReport.trim()}`
      : "**/experiment ended**\n\n(experiment ended without final report)",
    userId: agent.spacesAppUserId,
    metadata: { contentFormat: "markdown" },
  }, appToken);
}

export function buildEpochTask(run: ExperimentRun, ledgerMarkdown: string): string {
  const remaining = formatRemaining(run.deadlineAt);
  const sandboxId = /(?:^|\s)sandboxId=([^\s]+)/.exec(run.sandboxNote ?? "")?.[1];
  const sandboxInstruction = sandboxId
    ? `YOUR SANDBOX: ${sandboxId}. This experiment has ONE machine. Reuse this sandbox for every command — do NOT create a new one. Only create a new sandbox if this one is provably unreachable, and if you do, immediately record the new id with experiment-ledger action=sandbox-note.`
    : "";
  const finalInstruction = run.status === "finishing"
    ? "\n\nDeadline reached - call end-experiment with your final report now. First deliver (sandbox-deliver-files) any proof artifact that has not yet been attached to this thread."
    : "";
  return [
    `You are in /experiment mode, epoch ${run.epoch}.`,
    sandboxInstruction,
    `Deadline: ${run.deadlineAt.toISOString()} (${remaining} remaining).`,
    ``,
    `Read the ledger below before doing anything. Do NOT re-test refuted hypotheses. Pick or advance ONE hypothesis. Use your sandbox tools to gather PROOF: a failing test, benchmark, profile, trace, log, or other concrete artifact. Record every conjecture/proof/refutation via the experiment-ledger tool.`,
    `PROOF DURABILITY: the sandbox is temporary. Any artifact that exists only inside the sandbox is LOST when it recycles. In the SAME epoch you create a proof artifact you MUST call sandbox-deliver-files to attach it to the thread, and record the DELIVERED filename in the ledger's proofArtifactPath. A finding whose proof was never delivered does not count as proved.`,
    `RECOVERY: previously delivered proof attachments can be restored instead of rebuilt: use spaces-thread-attachments to find them, then spaces-fetch-attachment to fetch them into a fresh workspace/sandbox.`,
    `You cannot end before the deadline - end-experiment will refuse until the deadline has been reached.`,
    run.sandboxNote?.trim() ? `\nSandbox note:\n${run.sandboxNote.trim()}` : "",
    finalInstruction,
    ``,
    ledgerMarkdown,
  ].filter((part) => part !== "").join("\n");
}

/** Shared dispatch plumbing for both the epoch agent and the checker agent.
 *  `claimAsCurrent` is the important flag: only the epoch run may become the
 *  experiment's currentSessionId. A checker that claimed it would make
 *  continueExperimentAfterResult chain the next epoch off the CHECKER's
 *  completion, double-running the experiment. */
async function dispatchExperimentRun(
  run: ExperimentRun,
  opts: { task: string; mode?: "review"; claimAsCurrent: boolean; recover: boolean },
): Promise<{ sessionId: string }> {
  const traceId = createTraceId();
  const agent = run.orgId
    ? await agentRepository.findBySlug(run.agentSlug, run.orgId)
    : null;
  if (!agent) throw new Error(`Experiment dispatch missing agent ${run.agentSlug} org=${run.orgId ?? ""}`);
  if (!agent.spacesAppToken || !agent.spacesAppId || !agent.spacesAppUserId) {
    throw new Error(`Experiment dispatch agent ${run.agentSlug} missing Spaces app identity`);
  }
  const appToken = decryptStoredField(agent.spacesAppToken);

  const dispatchPayload = {
    userId: run.userId,
    task: opts.task,
    conversationId: run.conversationId,
    agentSlug: run.agentSlug,
    orgId: run.orgId ?? agent.orgId,
    eventType: "APP_MENTIONED",
    traceId,
    callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
    progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
    channelId: run.channelId,
    ...(run.provider
      ? { providerOverride: { provider: run.provider, ...(run.modelId ? { model: run.modelId } : {}) } }
      : {}),
    experiment: {
      id: run.id,
      epoch: run.epoch,
      deadlineAt: run.deadlineAt.toISOString(),
      ...(run.focus ? { focus: run.focus } : {}),
      ...(opts.mode ? { mode: opts.mode } : {}),
      // Understanding runs advertise their coverage-gated intent to the epoch
      // runtime, which keeps end-experiment locked until the frontier empties.
      ...(run.kind === "understanding" ? { kind: "understanding" as const } : {}),
    },
  };

  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify(dispatchPayload),
  });
  const body = await res.json() as { success?: boolean; sessionId?: string; error?: string };
  if (!res.ok || !body.success || !body.sessionId) {
    throw new Error(`Experiment dispatch failed: HTTP ${res.status} ${body.error ?? ""}`.trim());
  }

  const sessionContext: SessionContext = {
    mentionedUserId: agent.spacesAppUserId,
    targetUserId: run.userId,
    senderId: run.userId,
    senderName: run.userId,
    channelId: run.channelId,
    channelName: run.channelId,
    conversationId: run.conversationId,
    task: opts.task,
    agentId: agent.id,
    agentOrgId: run.orgId ?? agent.orgId,
    agentSlug: run.agentSlug,
    responseMode: "conversation",
    appToken,
    spacesAppId: agent.spacesAppId,
    spacesAppUserId: agent.spacesAppUserId,
    traceId,
    rootAgentSlug: run.agentSlug,
  };
  await setSession(body.sessionId, sessionContext);
  if (opts.recover) {
    await registerRunRecovery({
      rootSessionId: body.sessionId,
      maxRetries: CONFIG.runRecoveryMaxRetries,
      timeoutMs: CONFIG.runRecoveryTimeoutMs,
      retryBackoffMs: CONFIG.runRecoveryBackoffMs,
      dispatchPayload,
      sessionContext,
    });
  }
  if (opts.claimAsCurrent) {
    await experimentRepository.update(run.id, {
      currentSessionId: body.sessionId,
      epoch: run.epoch,
    });
  }
  return { sessionId: body.sessionId };
}

export async function dispatchExperimentEpoch(run: ExperimentRun): Promise<{ sessionId: string }> {
  const [findings, reviews] = await Promise.all([
    experimentRepository.listFindings(run.id),
    experimentRepository.listReviews(run.id),
  ]);
  const task = buildEpochTask(run, buildLedgerMarkdown(run, findings, reviews));
  const result = await dispatchExperimentRun(run, { task, claimAsCurrent: true, recover: true });
  log.info(`[experiment] dispatched epoch=${run.epoch} id=${run.id} session=${result.sessionId}`);
  return result;
}

/** Second-agent pass over the findings the epoch that just ended recorded.
 *  Advisory: it writes verdicts, never statuses. Best-effort — a checker that
 *  fails must never block the next epoch. */
export async function dispatchExperimentChecker(run: ExperimentRun, epoch: number): Promise<void> {
  const findings = await experimentRepository.listFindingsByEpoch(run.id, epoch);
  if (findings.length === 0) return;
  const task = buildCheckerTask(run, epoch, findings);
  try {
    const result = await dispatchExperimentRun(run, {
      task,
      mode: "review",
      claimAsCurrent: false,
      recover: false,
    });
    log.info(`[experiment] dispatched checker epoch=${epoch} id=${run.id} findings=${findings.length} session=${result.sessionId}`);
  } catch (err) {
    log.warn(`[experiment] checker dispatch failed id=${run.id} epoch=${epoch}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function buildCheckerTask(run: ExperimentRun, epoch: number, findings: ExperimentFinding[]): string {
  const rows = findings.map((f) => [
    `- findingId: ${f.id}`,
    `  status: ${f.status}`,
    `  title: ${f.title}`,
    `  hypothesis: ${f.hypothesis}`,
    ...(f.note?.trim() ? [`  note: ${f.note.trim()}`] : []),
    `  proof: ${f.proofArtifactPath?.trim() || "(none)"}`,
  ].join("\n")).join("\n");

  return [
    `You are the CHECKER for an /experiment. You are NOT hunting for new findings — do not start one.`,
    ``,
    `Another agent just finished epoch ${epoch} and recorded the ${findings.length} finding(s) below. Your only job is to independently verify each one against the CURRENT code, then record a verdict with the experiment-review tool.`,
    ``,
    `For each finding:`,
    `1. Open the cited file and line in the repo. Read the real code, not the hypothesis text.`,
    `2. If a proof artifact was delivered to this thread, fetch it (spaces-thread-attachments then spaces-fetch-attachment) and check that it actually demonstrates the claim.`,
    `3. Compare against every OTHER finding in this experiment — if it restates one already recorded, that is a duplicate even when the wording differs completely.`,
    ``,
    `Verdicts:`,
    `- confirms      — the mechanism exists in current code and the proof supports it.`,
    `- contradicts   — the code does not do what the finding says, or the proof does not show it.`,
    `- stale         — it was true once but the current code already handles it (guard added, bug fixed).`,
    `- duplicate     — same defect as an earlier finding; set duplicateOf to that findingId.`,
    `- unverifiable  — cannot be settled from code plus the delivered artifact (needs a running system, external service, or timing measurement).`,
    ``,
    `Default to contradicts or unverifiable when you are unsure. Confirming a wrong finding is far more expensive than flagging a right one, because these become tickets a human then has to disprove.`,
    ``,
    `Reply with ONE short line when done: how many you checked and the verdict counts. Nothing else — the detail belongs in the verdicts.`,
    ``,
    `## Findings recorded in epoch ${epoch}`,
    rows,
  ].join("\n");
}
