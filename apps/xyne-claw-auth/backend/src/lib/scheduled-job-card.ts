import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import { SpacesApiError, spacesAppFetch, spacesAppFetchMultipart } from "./spaces-api.js";

const log = createLogger("scheduled-job-card");

const CARD_TTL_SEC = Number(process.env["CLAW_SCHEDULED_JOB_CARD_TTL_SEC"] ?? String(90 * 24 * 60 * 60));
const LOCK_TTL_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 100;
const HISTORY_SIZE = 5;
const ERROR_PREVIEW_CHARS = 160;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface JobCardTarget {
  jobId: string;
  channelId: string;
  workspaceId: string;
  spacesAppUserId: string;
  appToken: string;
}

export interface JobCardJob {
  label: string | null;
  task: string;
  nextRunAt: Date | null;
}

export interface JobRunSummary {
  status: string;
  at: Date | null;
  error?: string | null;
}

export type JobRunDelivery =
  | { kind: "output"; markdownText: string; attachments?: Array<{ fileName: string; mimeType: string; data: string }> }
  | { kind: "failure"; error: string | null | undefined };

interface JobCardRef {
  channelId: string;
  conversationId: string;
  messageId: string;
  latestOutputMessageId?: string;
}

const cardKey = (jobId: string): string => `claw:schedjob:card:${jobId}`;
const lockKey = (jobId: string): string => `claw:schedjob:card-lock:${jobId}`;

const pad = (value: number): string => String(value).padStart(2, "0");

export function formatCardTime(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

function runIcon(status: string): string {
  if (status === "completed") return "✅";
  if (status === "failed" || status === "cancelled") return "❌";
  return "⏳";
}

function runLabel(status: string): string {
  if (status === "completed") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  return "Running";
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function jobCardName(job: Pick<JobCardJob, "label" | "task">): string {
  return oneLine(job.label?.trim() || job.task, 80);
}

export function jobThreadMessageUrl(channelId: string, conversationId: string, messageId: string): string | null {
  const base = CONFIG.spacesAppUrl?.replace(/\/+$/, "");
  if (!base) return null;
  const thread = `${base}/chat/dir/${encodeURIComponent(channelId)}/${encodeURIComponent(conversationId)}`;
  return `${thread}#origin=${encodeURIComponent(conversationId)}&messageId=${encodeURIComponent(messageId)}`;
}

export function jobCardText(input: {
  name: string;
  history: readonly JobRunSummary[];
  nextRunAt: Date | null;
  latestOutputUrl: string | null;
}): string {
  const rows: string[] = [];
  const last = input.history[0];
  if (last) {
    const when = last.at ? ` · ${formatCardTime(last.at)}` : "";
    const why = last.status === "failed" && last.error?.trim() ? ` — ${oneLine(last.error, ERROR_PREVIEW_CHARS)}` : "";
    rows.push(`Last run: ${runIcon(last.status)} ${runLabel(last.status)}${when}${why}`);
  } else {
    rows.push("Last run: —");
  }
  rows.push(`Next run: ${input.nextRunAt ? formatCardTime(input.nextRunAt) : "—"}`);
  if (input.history.length > 1) {
    rows.push(
      `Recent: ${input.history
        .map((run) => `${runIcon(run.status)} ${run.at ? formatCardTime(run.at).replace(" UTC", "") : "—"}`)
        .join(" · ")}`,
    );
  }
  const footer = [
    ...(input.latestOutputUrl ? [`[Latest output](${input.latestOutputUrl})`] : []),
    "_Each run replies in this thread._",
  ].join(" · ");
  return [`**🗓 ${input.name}** · scheduled job`, rows.map((row) => `- ${row}`).join("\n"), footer].join("\n\n");
}

async function readRef(jobId: string): Promise<JobCardRef | null> {
  try {
    const raw = await redisService.getConnection().get(cardKey(jobId));
    return raw ? (JSON.parse(raw) as JobCardRef) : null;
  } catch (err) {
    log.warn("readRef failed", { jobId, error: errMsg(err) });
    return null;
  }
}

async function writeRef(jobId: string, ref: JobCardRef): Promise<void> {
  await redisService.getConnection().set(cardKey(jobId), JSON.stringify(ref), "EX", CARD_TTL_SEC).catch((err: unknown) => {
    log.warn("writeRef failed", { jobId, error: errMsg(err) });
  });
}

async function dropRef(jobId: string): Promise<void> {
  await redisService.getConnection().del(cardKey(jobId)).catch(() => {});
}

async function withJobLock<T>(jobId: string, work: () => Promise<T>): Promise<T> {
  const redis = redisService.getConnection();
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;
  let held = false;
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!held && Date.now() < deadline) {
    held = (await redis.set(lockKey(jobId), token, "PX", LOCK_TTL_MS, "NX").catch(() => null)) === "OK";
    if (!held) await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  if (!held) log.warn("card lock not acquired in time, continuing", { jobId });
  try {
    return await work();
  } finally {
    if (held && (await redis.get(lockKey(jobId)).catch(() => null)) === token) {
      await redis.del(lockKey(jobId)).catch(() => {});
    }
  }
}

async function loadHistory(jobId: string): Promise<JobRunSummary[]> {
  const runs = await prisma.scheduledJobRun.findMany({
    where: { scheduledJobId: jobId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_SIZE,
    select: { status: true, completedAt: true, startedAt: true, error: true },
  });
  return runs.map((run) => ({ status: run.status, at: run.completedAt ?? run.startedAt, error: run.error }));
}

async function postCard(target: JobCardTarget, markdownText: string): Promise<JobCardRef | null> {
  const resp = (await spacesAppFetch(
    "/chat/postMessage",
    {
      channelId: target.channelId,
      markdownText,
      userId: target.spacesAppUserId,
      workspaceId: target.workspaceId,
      metadata: { contentFormat: "markdown" },
    },
    target.appToken,
  )) as { messageId?: string; conversationId?: string } | null;
  if (!resp?.messageId || !resp.conversationId) return null;
  return { channelId: target.channelId, conversationId: resp.conversationId, messageId: resp.messageId };
}

async function editCard(target: JobCardTarget, ref: JobCardRef, markdownText: string): Promise<void> {
  await spacesAppFetch(
    "/chat/updateMessage",
    {
      messageId: ref.messageId,
      channelId: ref.channelId,
      markdownText,
      userId: target.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    },
    target.appToken,
  );
}

async function postReply(
  target: JobCardTarget,
  ref: JobCardRef,
  delivery: Extract<JobRunDelivery, { kind: "output" }>,
): Promise<string | undefined> {
  if (delivery.attachments?.length) {
    const form = new FormData();
    for (const att of delivery.attachments) {
      form.append("files", new Blob([Buffer.from(att.data, "base64")], { type: att.mimeType }), att.fileName);
    }
    form.append("channelId", ref.channelId);
    form.append("conversationId", ref.conversationId);
    form.append("userId", target.spacesAppUserId);
    form.append("workspaceId", target.workspaceId);
    form.append("markdownText", delivery.markdownText);
    form.append("metadata", JSON.stringify({ contentFormat: "markdown" }));
    const resp = (await spacesAppFetchMultipart("/files/filesUpload", form, target.appToken)) as { messageId?: string } | null;
    return resp?.messageId;
  }
  const resp = (await spacesAppFetch(
    "/chat/postMessage",
    {
      channelId: ref.channelId,
      conversationId: ref.conversationId,
      markdownText: delivery.markdownText,
      userId: target.spacesAppUserId,
      workspaceId: target.workspaceId,
      metadata: { contentFormat: "markdown" },
    },
    target.appToken,
  )) as { messageId?: string } | null;
  return resp?.messageId;
}

const threadGone = (err: unknown): boolean =>
  err instanceof SpacesApiError && (err.status === 404 || err.status === 400);

export async function deliverToJobThread(target: JobCardTarget, job: JobCardJob, delivery: JobRunDelivery): Promise<void> {
  await withJobLock(target.jobId, async () => {
    const name = jobCardName(job);
    const cardFor = async (latestOutputUrl: string | null): Promise<string> =>
      jobCardText({ name, history: await loadHistory(target.jobId), nextRunAt: job.nextRunAt, latestOutputUrl });

    let ref = await readRef(target.jobId);
    if (ref && ref.channelId !== target.channelId) ref = null;

    const ensureCard = async (): Promise<JobCardRef> => {
      if (ref) return ref;
      const created = await postCard(target, await cardFor(null));
      if (!created) throw new Error("Spaces did not return the card's message and thread ids");
      ref = created;
      await writeRef(target.jobId, ref);
      return ref;
    };

    let card = await ensureCard();
    if (delivery.kind === "output") {
      let outputMessageId: string | undefined;
      try {
        outputMessageId = await postReply(target, card, delivery);
      } catch (err) {
        if (!threadGone(err)) throw err;
        log.warn("job thread is gone, starting a new card", { jobId: target.jobId, error: errMsg(err) });
        await dropRef(target.jobId);
        ref = null;
        card = await ensureCard();
        outputMessageId = await postReply(target, card, delivery);
      }
      if (outputMessageId) card = { ...card, latestOutputMessageId: outputMessageId };
    }

    const latestOutputUrl = card.latestOutputMessageId
      ? jobThreadMessageUrl(card.channelId, card.conversationId, card.latestOutputMessageId)
      : null;
    try {
      await editCard(target, card, await cardFor(latestOutputUrl));
      await writeRef(target.jobId, card);
    } catch (err) {
      log.warn("card edit failed, the next run starts a new card", { jobId: target.jobId, error: errMsg(err) });
      await dropRef(target.jobId);
    }
  });
}
