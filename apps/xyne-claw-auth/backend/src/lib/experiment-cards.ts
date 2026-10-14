import type { ExperimentEpoch, ExperimentRun } from "@prisma/client";
import { buildExperimentEpochFlow, buildExperimentStatusFlow, withSpacesAppId, type ExperimentCardRouting } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import {
  agentRepository,
  agentRunRepository,
  experimentEpochRepository,
  experimentRepository,
} from "../repositories/index.js";
import { decryptStoredField, spacesAppFetch, spacesAppFetchMultipart } from "../surfaces/spaces/client.js";
import { getRecoveryRootSessionId } from "../queue/run-recovery-worker.js";
import { errMsg } from "./errors.js";
import { buildExperimentEpochCard, buildExperimentStatusCard, planItemsFrom, splitMentionLines } from "./experiment-card-model.js";

const log = createLogger("experiment-cards");

interface CardIdentity {
  appToken: string;
  spacesAppUserId: string;
  spacesAppId: string | null;
}

interface CardSessionContext {
  isExperiment?: boolean | undefined;
  suppressThreadReply?: boolean | undefined;
  channelDelivery?: unknown;
  conversationId?: string | undefined;
}

export interface ExperimentPlanTodo {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

export interface ExperimentEpochLinks {
  previewUrl?: string | undefined;
  codeUrl?: string | undefined;
  terminalUrl?: string | undefined;
}

export interface ExperimentEpochAttachment {
  fileName: string;
  mimeType: string;
  data: string;
}

export interface ExperimentEpochOutcome {
  status: "done" | "failed" | "cancelled";
  text?: string;
  error?: string;
  attachments?: ExperimentEpochAttachment[];
}

type EpochTarget = { kind: "epoch"; epoch: ExperimentEpoch } | { kind: "silent" } | null;

export function experimentCardsEnabled(): boolean {
  return CONFIG.experimentCardsEnabled;
}

async function identityFor(run: Pick<ExperimentRun, "orgId" | "agentSlug" | "conversationId">): Promise<CardIdentity | null> {
  if (!experimentCardsEnabled() || !run.orgId) return null;
  const { chatTargetFor } = await import("../surfaces/messaging/commands.js");
  if (await chatTargetFor(run.conversationId)) return null;
  const agent = await agentRepository.findBySlug(run.agentSlug, run.orgId);
  if (!agent?.spacesAppToken || !agent.spacesAppUserId) return null;
  return {
    appToken: decryptStoredField(agent.spacesAppToken),
    spacesAppUserId: agent.spacesAppUserId,
    spacesAppId: agent.spacesAppId ?? null,
  };
}

function routingFor(run: ExperimentRun): ExperimentCardRouting {
  return {
    agentSlug: run.agentSlug,
    channelId: run.channelId,
    conversationId: run.conversationId,
    userId: run.userId,
  };
}

function messageIdOf(response: unknown): string | undefined {
  const resp = response as { messageId?: string; id?: string; data?: { messageId?: string; id?: string } } | null;
  return resp?.messageId ?? resp?.id ?? resp?.data?.messageId ?? resp?.data?.id;
}

interface Queue {
  chain: Promise<void>;
  pending: boolean;
  lastRun: number;
}

const queues = new Map<string, Queue>();

function enqueue(key: string, gapMs: number, work: () => Promise<void>): Promise<void> {
  let queue = queues.get(key);
  if (!queue) {
    queue = { chain: Promise.resolve(), pending: false, lastRun: 0 };
    queues.set(key, queue);
  }
  if (queue.pending) return queue.chain;
  const current = queue;
  current.pending = true;
  current.chain = current.chain
    .catch(() => undefined)
    .then(async () => {
      const wait = current.lastRun + gapMs - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      current.pending = false;
      current.lastRun = Date.now();
      await work();
    });
  const settled = current.chain;
  void settled.catch(() => undefined).finally(() => {
    if (queues.get(key) === current && current.chain === settled && !current.pending) {
      setTimeout(() => {
        if (queues.get(key) === current && current.chain === settled && !current.pending) queues.delete(key);
      }, Math.max(gapMs, 1_000)).unref?.();
    }
  });
  return settled;
}

async function renderStatusCard(runId: string): Promise<void> {
  const run = await experimentRepository.findById(runId);
  if (!run) return;
  const identity = await identityFor(run);
  if (!identity) return;
  const [findings, reviews, epochs] = await Promise.all([
    experimentRepository.listFindings(run.id),
    experimentRepository.listReviews(run.id),
    experimentEpochRepository.listByExperiment(run.id),
  ]);
  const card = buildExperimentStatusCard({ run, findings, reviews, epochs });
  const flow = withSpacesAppId(buildExperimentStatusFlow(card, routingFor(run)), identity.spacesAppId);
  if (run.statusMessageId) {
    await spacesAppFetch(
      "/chat/updateMessage",
      { messageId: run.statusMessageId, flowJSON: flow, userId: identity.spacesAppUserId, channelId: run.channelId },
      identity.appToken,
    );
    return;
  }
  const messageId = messageIdOf(await spacesAppFetch(
    "/chat/postMessage",
    { channelId: run.channelId, conversationId: run.conversationId, flow, userId: identity.spacesAppUserId },
    identity.appToken,
  ));
  if (messageId) await experimentRepository.update(run.id, { statusMessageId: messageId });
}

async function renderEpochCard(sessionId: string): Promise<void> {
  const epoch = await experimentEpochRepository.findBySessionId(sessionId);
  if (!epoch) return;
  const run = await experimentRepository.findById(epoch.experimentId);
  if (!run) return;
  const identity = await identityFor(run);
  if (!identity) return;
  const [findings, reviews] = await Promise.all([
    experimentRepository.listFindings(run.id),
    experimentRepository.listReviews(run.id),
  ]);
  const card = buildExperimentEpochCard({ run, epoch, findings, reviews });
  const flow = withSpacesAppId(buildExperimentEpochFlow(card, epoch.sessionId, routingFor(run)), identity.spacesAppId);
  if (epoch.messageId) {
    await spacesAppFetch(
      "/chat/updateMessage",
      { messageId: epoch.messageId, flowJSON: flow, userId: identity.spacesAppUserId, channelId: run.channelId },
      identity.appToken,
    );
    return;
  }
  const messageId = messageIdOf(await spacesAppFetch(
    "/chat/postMessage",
    { channelId: run.channelId, conversationId: run.conversationId, flow, userId: identity.spacesAppUserId },
    identity.appToken,
  ));
  if (messageId) await experimentEpochRepository.update(sessionId, { messageId });
}

export function refreshExperimentStatusCard(runId: string): Promise<void> {
  return enqueue(`status:${runId}`, CONFIG.experimentStatusCardGapMs, () => renderStatusCard(runId)).catch((err) => {
    log.warn(`[experiment-cards] status card refresh failed run=${runId}: ${errMsg(err)}`);
  });
}

export function refreshExperimentEpochCard(sessionId: string): Promise<void> {
  return enqueue(`epoch:${sessionId}`, CONFIG.experimentEpochCardGapMs, () => renderEpochCard(sessionId)).catch((err) => {
    log.warn(`[experiment-cards] epoch card refresh failed session=${sessionId}: ${errMsg(err)}`);
  });
}

export async function postExperimentStatusCard(runId: string): Promise<boolean> {
  try {
    await renderStatusCard(runId);
    const run = await experimentRepository.findById(runId);
    return Boolean(run?.statusMessageId);
  } catch (err) {
    log.warn(`[experiment-cards] status card post failed run=${runId}: ${errMsg(err)}`);
    return false;
  }
}

export async function openExperimentEpochCard(run: ExperimentRun, sessionId: string): Promise<void> {
  if (!(await identityFor(run))) return;
  try {
    await experimentEpochRepository.create({ experimentId: run.id, epoch: run.epoch, sessionId });
    await refreshExperimentEpochCard(sessionId);
    void refreshExperimentStatusCard(run.id);
  } catch (err) {
    log.warn(`[experiment-cards] epoch card open failed run=${run.id} session=${sessionId}: ${errMsg(err)}`);
  }
}

async function adoptRecoveredEpoch(run: ExperimentRun, sessionId: string): Promise<ExperimentEpoch | null> {
  const root = await getRecoveryRootSessionId(sessionId).catch(() => null);
  if (!root || root === sessionId) return null;
  const running = await experimentEpochRepository.listRunning(run.id);
  for (const epoch of running) {
    const epochRoot: string | null = epoch.sessionId === root
      ? root
      : await getRecoveryRootSessionId(epoch.sessionId).catch(() => null);
    if (epochRoot === root) {
      return experimentEpochRepository.update(epoch.sessionId, { sessionId, retries: { increment: 1 } });
    }
  }
  return null;
}

async function waitForOwnEpoch(sessionId: string, runId: string | null): Promise<ExperimentEpoch | null> {
  const deadline = Date.now() + CONFIG.experimentEpochOpenWaitMs;
  for (;;) {
    const epoch = await experimentEpochRepository.findBySessionId(sessionId);
    if (epoch || Date.now() >= deadline) return epoch;
    const run = runId ? await experimentRepository.findById(runId) : null;
    if (run?.checkerSessionIds.includes(sessionId)) return null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function epochTarget(sessionId: string, ctx: CardSessionContext | null | undefined): Promise<EpochTarget> {
  if (!experimentCardsEnabled() || !ctx?.isExperiment || ctx.channelDelivery) return null;
  if (ctx.suppressThreadReply) return { kind: "silent" };
  const run = ctx.conversationId ? await experimentRepository.findActiveByConversation(ctx.conversationId) : null;
  const own = await waitForOwnEpoch(sessionId, run?.id ?? null);
  if (own) return { kind: "epoch", epoch: own };
  if (!run) return null;
  const adopted = await adoptRecoveredEpoch(run, sessionId);
  if (adopted) return { kind: "epoch", epoch: adopted };
  return run.statusMessageId ? { kind: "silent" } : null;
}

export async function routeExperimentPlan(
  sessionId: string,
  ctx: CardSessionContext | null | undefined,
  todos: ExperimentPlanTodo[],
): Promise<boolean> {
  const target = await epochTarget(sessionId, ctx).catch(() => null);
  if (!target) return false;
  if (target.kind === "silent") return true;
  await experimentEpochRepository.update(target.epoch.sessionId, {
    plan: todos.map((todo) => ({ id: todo.id, title: todo.title, status: todo.status })),
  });
  void refreshExperimentEpochCard(target.epoch.sessionId);
  return true;
}

export async function routeExperimentPreview(
  sessionId: string,
  ctx: CardSessionContext | null | undefined,
  links: ExperimentEpochLinks,
): Promise<boolean> {
  const target = await epochTarget(sessionId, ctx).catch(() => null);
  if (!target) return false;
  if (target.kind === "silent") return true;
  await experimentEpochRepository.update(target.epoch.sessionId, {
    ...(links.previewUrl ? { previewUrl: links.previewUrl } : {}),
    ...(links.codeUrl ? { codeUrl: links.codeUrl } : {}),
    ...(links.terminalUrl ? { terminalUrl: links.terminalUrl } : {}),
  });
  void refreshExperimentEpochCard(target.epoch.sessionId);
  void refreshExperimentStatusCard(target.epoch.experimentId);
  return true;
}

export async function recordExperimentHypothesis(run: ExperimentRun, hypothesis: string): Promise<void> {
  if (!experimentCardsEnabled() || !run.currentSessionId) return;
  const epoch = await experimentEpochRepository.findBySessionId(run.currentSessionId).catch(() => null);
  if (epoch?.status === "running") {
    await experimentEpochRepository.update(epoch.sessionId, { hypothesis }).catch(() => undefined);
    void refreshExperimentEpochCard(epoch.sessionId);
  }
  void refreshExperimentStatusCard(run.id);
}

async function attachToEpochCard(
  run: ExperimentRun,
  epoch: ExperimentEpoch,
  identity: CardIdentity,
  attachments: ExperimentEpochAttachment[],
): Promise<void> {
  const form = new FormData();
  for (const attachment of attachments) {
    const blob = new Blob([Buffer.from(attachment.data, "base64")], { type: attachment.mimeType });
    form.append("files", blob, attachment.fileName);
  }
  form.append("channelId", run.channelId);
  form.append("conversationId", run.conversationId);
  form.append("userId", identity.spacesAppUserId);
  if (epoch.messageId) form.append("messageId", epoch.messageId);
  form.append("metadata", JSON.stringify({ contentFormat: "markdown", experimentEpoch: epoch.epoch }));
  await spacesAppFetchMultipart("/files/filesUpload", form, identity.appToken);
}

export async function finishExperimentEpoch(
  sessionId: string,
  ctx: CardSessionContext | null | undefined,
  outcome: ExperimentEpochOutcome,
): Promise<boolean> {
  const target = await epochTarget(sessionId, ctx).catch(() => null);
  if (!target || target.kind === "silent") return false;
  const epoch = target.epoch;
  const run = await experimentRepository.findById(epoch.experimentId);
  if (!run) return false;
  const identity = await identityFor(run);
  if (!identity) return false;

  const { body, mentionLines } = splitMentionLines(outcome.text ?? "");
  const attachments = outcome.attachments ?? [];
  let attachmentNames = attachments.map((attachment) => attachment.fileName);
  if (attachments.length > 0) {
    try {
      await attachToEpochCard(run, epoch, identity, attachments);
    } catch (err) {
      log.warn(`[experiment-cards] attaching files to epoch card failed session=${sessionId}: ${errMsg(err)}`);
      attachmentNames = [];
    }
  }
  const agentRun = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
  const retries = Math.max(epoch.retries, agentRun?.llmRetries ?? 0);
  const plan = planItemsFrom(epoch.plan).map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status === "in_progress" ? "pending" : item.status,
  }));
  await experimentEpochRepository.update(epoch.sessionId, {
    status: outcome.status,
    endedAt: new Date(),
    retries,
    ...(plan.length > 0 ? { plan } : {}),
    ...(body ? { summary: body } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
    ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
    ...(mentionLines.length > 0 ? { needsYou: mentionLines.map((line) => splitMentionLines(line).body) } : {}),
  });
  if (attachments.length > 0 && attachmentNames.length === 0) {
    await spacesAppFetch(
      "/chat/postMessage",
      {
        channelId: run.channelId,
        conversationId: run.conversationId,
        markdownText: `_Couldn't attach ${attachments.length} file(s) from epoch ${epoch.epoch} to its card._`,
        userId: identity.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      },
      identity.appToken,
    ).catch(() => undefined);
  }
  if (mentionLines.length > 0) {
    await spacesAppFetch(
      "/chat/postMessage",
      {
        channelId: run.channelId,
        conversationId: run.conversationId,
        markdownText: mentionLines.join("\n"),
        userId: identity.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      },
      identity.appToken,
    ).catch((err) => log.warn(`[experiment-cards] needs-you post failed session=${sessionId}: ${errMsg(err)}`));
  }
  await refreshExperimentEpochCard(epoch.sessionId);
  void refreshExperimentStatusCard(run.id);
  return true;
}

export async function failRunningExperimentEpochs(runId: string, reason: string): Promise<void> {
  if (!experimentCardsEnabled()) return;
  const running = await experimentEpochRepository.listRunning(runId);
  for (const epoch of running) {
    await experimentEpochRepository.update(epoch.sessionId, { status: "failed", error: reason, endedAt: new Date() });
    void refreshExperimentEpochCard(epoch.sessionId);
  }
}

export async function settleExperimentCards(runId: string): Promise<void> {
  if (!experimentCardsEnabled()) return;
  const running = await experimentEpochRepository.listRunning(runId).catch(() => []);
  for (const epoch of running) {
    await experimentEpochRepository.update(epoch.sessionId, { status: "cancelled", endedAt: new Date() }).catch(() => undefined);
    void refreshExperimentEpochCard(epoch.sessionId);
  }
  await refreshExperimentStatusCard(runId);
}
