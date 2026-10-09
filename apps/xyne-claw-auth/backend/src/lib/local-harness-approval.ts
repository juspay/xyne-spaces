import type { LocalHarnessRun } from "@prisma/client";
import type { LocalHarnessProvider, LocalHarnessRunEnvelope } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
import { localHarnessRepository } from "../repositories/localHarnessRepository.js";
import { dispatchLocalHarnessRun, isLocalHarnessProvider, readServerFallback } from "./local-harness.js";

const log = createLogger("local-harness-approval");

export interface LocalHarnessResumeOutcome {
  handled: boolean;
  runId?: string;
  sessionId?: string;
  fellBackToServer?: boolean;
}

export function continuationTask(args: { tool: string; approved: boolean; resultText: string }): string {
  if (!args.approved) {
    return (
      `The user rejected ${args.tool}. Tool result:\n${args.resultText}\n` +
      `Continue from where you stopped without retrying it.`
    );
  }
  return `The user approved ${args.tool}. Tool result:\n${args.resultText}\nContinue from where you stopped.`;
}

export function rejectionResultText(tool: string): string {
  return `The user rejected ${tool}. It was not executed.`;
}

function trimResult(text: string, max = 4000): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function resumeCallbackUrl(callbackUrl: string, assistantMessageId: string | null): string {
  try {
    const url = new URL(callbackUrl);
    if (assistantMessageId) url.searchParams.set("assistantMessageId", assistantMessageId);
    else url.searchParams.delete("assistantMessageId");
    return url.toString();
  } catch {
    return callbackUrl;
  }
}

async function createResumePlaceholder(run: LocalHarnessRun, envelope: LocalHarnessRunEnvelope): Promise<string | null> {
  try {
    const parentId = await chatMessageRepository.latestMessageId(envelope.conversationId, run.agentSlug);
    const created = await chatMessageRepository.create({
      conversationId: envelope.conversationId,
      agentSlug: run.agentSlug,
      userId: run.userId,
      role: "assistant",
      content: "",
      status: "running",
      ...(parentId ? { parentId } : {}),
      orgId: run.orgId,
    });
    return created.id;
  } catch (err) {
    log.warn(`[local-harness] could not pre-create the resume placeholder run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function findLocalHarnessRunForAction(
  userId: string,
  signature: string,
): Promise<LocalHarnessRun | null> {
  if (!signature) return null;
  return localHarnessRepository.findRunByPendingActionId(signature, userId).catch(() => null);
}

async function carryOverSpacesSession(run: LocalHarnessRun, newSessionId: string): Promise<void> {
  try {
    const { getSession, setSession } = await import("../routes/webhook.js");
    const ctx = await getSession(run.sessionId);
    if (ctx) await setSession(newSessionId, ctx);
  } catch (err) {
    log.warn(`[local-harness] could not carry the Spaces session forward run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function fallbackToServerRun(run: LocalHarnessRun, task: string, toolResult: string): Promise<boolean> {
  const body = await readServerFallback(run.id);
  if (!body) {
    log.warn(`[local-harness] no stashed server fallback for run=${run.id} — approval continuation dropped`);
    return false;
  }

  const priorContext = typeof body["context"] === "string" ? (body["context"] as string) : "";
  const resumeBody = {
    ...body,
    task,
    context: priorContext ? `${priorContext}\n\n${toolResult}` : toolResult,
  };

  try {
    const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(resumeBody),
      signal: AbortSignal.timeout(30_000),
    });
    const parsed = (await res.json().catch(() => ({}))) as { success?: boolean; sessionId?: string; error?: string };
    if (!res.ok || !parsed.success || !parsed.sessionId) {
      throw new Error(parsed.error ?? `HTTP ${res.status}`);
    }
    await carryOverSpacesSession(run, parsed.sessionId);
    log.info(`[local-harness] approval continuation ran on the server run=${run.id} newSession=${parsed.sessionId}`);
    return true;
  } catch (err) {
    log.error(`[local-harness] approval continuation server fallback failed run=${run.id}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function resumeLocalHarnessRunForAction(args: {
  userId: string;
  signature: string;
  tool: string;
  approved: boolean;
  resultText: string;
}): Promise<LocalHarnessResumeOutcome> {
  const run = await findLocalHarnessRunForAction(args.userId, args.signature);
  if (!run) return { handled: false };

  const envelope = run.envelope as unknown as LocalHarnessRunEnvelope;
  const resultText = trimResult(args.resultText);
  const task = continuationTask({ tool: args.tool, approved: args.approved, resultText });

  const provider: LocalHarnessProvider | null = isLocalHarnessProvider(run.provider) ? run.provider : null;
  const devices = provider
    ? await localHarnessRepository.listOnlineDevicesForProvider(run.userId, provider).catch(() => [])
    : [];
  const device = devices[0];

  await localHarnessRepository.finishAwaitingApproval(run.id).catch(() => {});

  if (!provider || !device) {
    const ok = await fallbackToServerRun(run, task, `Tool result for ${args.tool}:\n${resultText}`);
    return { handled: true, runId: run.id, fellBackToServer: ok };
  }

  const fallbackBody = (await readServerFallback(run.id)) ?? {};
  const placeholderId = await createResumePlaceholder(run, envelope);
  const dispatched = await dispatchLocalHarnessRun({
    target: { provider, device },
    userId: run.userId,
    orgId: run.orgId,
    conversationId: envelope.conversationId,
    agentSlug: run.agentSlug,
    agentName: envelope.agentName,
    systemPrompt: envelope.systemPrompt,
    model: run.model,
    task,
    context: null,
    progressUrl: run.progressUrl,
    callbackUrl: resumeCallbackUrl(run.callbackUrl, placeholderId),
    serverFallbackBody: { ...fallbackBody, task },
    resumeSessionId: run.cliSessionId,
    continuation: false,
  });

  await agentRunRepository
    .start({
      sessionId: dispatched.sessionId,
      userId: run.userId,
      agentSlug: run.agentSlug,
      orgId: run.orgId,
      triggerSource: "chat",
      task,
      conversationId: envelope.conversationId,
    })
    .catch((err: unknown) => log.warn(`[local-harness] AgentRun.start failed for the resumed run: ${err instanceof Error ? err.message : String(err)}`));

  await carryOverSpacesSession(run, dispatched.sessionId);

  log.info(
    `[local-harness] resumed run=${run.id} → run=${dispatched.runId} tool=${args.tool} approved=${args.approved} ` +
      `cliSession=${run.cliSessionId ?? "(none)"}`,
  );

  return { handled: true, runId: run.id, sessionId: dispatched.sessionId };
}
