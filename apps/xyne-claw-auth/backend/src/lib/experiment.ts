import type { ExperimentFinding, ExperimentRun } from "@prisma/client";
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
  | { sub: "start"; durationMs: number; focus?: string; provider?: string; model?: string; invalidProvider?: string }
  | { sub: "status" }
  | { sub: "stop" }
  | { sub: "findings" };

/** Providers a /experiment run may pin (must stay a subset of the /internal/run
 *  proxy's OVERRIDABLE set — personal-cred providers still require the
 *  requester's own key, enforced by the proxy at dispatch time). */
export const EXPERIMENT_PROVIDERS = new Set(["spaces", "litellm", "claude", "codex", "copilot"]);

const LEADING_MENTIONS = /^(?:@[\w.\-]+(?:\s+[\w.\-]+)*\s*)+/;

export function parseExperimentCommand(text: string | undefined | null): ExperimentCommand | null {
  if (!text) return null;
  const trimmed = text.trim().replace(LEADING_MENTIONS, "");
  if (!trimmed.toLowerCase().startsWith("/experiment")) return null;
  const rest = trimmed.slice("/experiment".length).trim();
  if (!rest) return { sub: "start", durationMs: DEFAULT_DURATION_MS };
  const [first, ...tail] = rest.split(/\s+/);
  const firstLower = first?.toLowerCase() ?? "";
  if (firstLower === "status") return { sub: "status" };
  if (firstLower === "stop") return { sub: "stop" };
  if (firstLower === "findings") return { sub: "findings" };

  let durationMs = DEFAULT_DURATION_MS;
  let focusParts = rest.split(/\s+/);
  const durationMatch = /^(\d+)(m|h)$/i.exec(firstLower);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    durationMs = durationMatch[2]!.toLowerCase() === "h"
      ? amount * 60 * 60 * 1000
      : amount * 60 * 1000;
    focusParts = tail;
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
  };
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

export function buildLedgerMarkdown(run: ExperimentRun, findings: ExperimentFinding[]): string {
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

export function buildFindingsMarkdown(run: ExperimentRun, findings: ExperimentFinding[]): string {
  const counts = countsByStatus(findings);
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

export async function dispatchExperimentEpoch(run: ExperimentRun): Promise<{ sessionId: string }> {
  const findings = await experimentRepository.listFindings(run.id);
  const ledger = buildLedgerMarkdown(run, findings);
  const task = buildEpochTask(run, ledger);
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
    task,
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
    task,
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
  await registerRunRecovery({
    rootSessionId: body.sessionId,
    maxRetries: CONFIG.runRecoveryMaxRetries,
    timeoutMs: CONFIG.runRecoveryTimeoutMs,
    retryBackoffMs: CONFIG.runRecoveryBackoffMs,
    dispatchPayload,
    sessionContext,
  });
  await experimentRepository.update(run.id, {
    currentSessionId: body.sessionId,
    epoch: run.epoch,
  });
  log.info(`[experiment] dispatched epoch=${run.epoch} id=${run.id} session=${body.sessionId}`);
  return { sessionId: body.sessionId };
}
