/**
 * People-KB extraction — turns chat into findings, one channel window at a time.
 *
 * Self-scheduling via setTimeout, same pattern as digitalTwinDaily.ts. Fires at
 * 1:30 AM IST (20:00 UTC), before the KB merge that consumes what this writes.
 *
 * Progress is a WATERMARK per channel (`KbChannel.extractedThrough`), not a
 * per-night date. Three things fall out of that:
 *
 *   - Backfill and nightly incremental are the same code path. A channel added
 *     today with a year of history just has further to walk.
 *   - A failed window is retried, because the watermark is only advanced when
 *     the window completes.
 *   - "Is this channel caught up?" is a column rather than a log search.
 *
 * SELECTION IS CODE, NOT THE AGENT. Window size, row caps and batch sizes are
 * enforced here, so a model that decides to be thorough cannot pull the corpus.
 *
 * Failures are non-fatal per channel and per batch: one channel's outage must
 * not abandon the rest.
 */
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { acquireCronLeaderLock } from "../lib/cron-leader-lock.js";
import { attachKbGrantsToConfig } from "../lib/spaces-kb.js";
import { consumeClawStream } from "../lib/consume-claw-stream.js";

const logger = createLogger("kb-extract");

/** Fallback extractor when a project does not name its own. */
const DEFAULT_AGENT_SLUG = process.env["KB_EXTRACT_AGENT_SLUG"] ?? "kb-extract";

/** How much time one window covers. Keeps a long backfill interruptible. */
const WINDOW_HOURS = 24;

/** Windows per channel per run, so one far-behind channel cannot take a whole night. */
const MAX_WINDOWS_PER_RUN = 7;

/**
 * Higher cap while a channel is still catching up (nothing extracted yet).
 *
 * The steady-state cap is there so one busy channel cannot monopolise a night,
 * which is the wrong constraint for a first backfill — at 7 windows a night a
 * year of history would take two months to ingest.
 */
const MAX_WINDOWS_BACKFILL = 60;

/** Chars per batch — an approximation of tokens, as in userMemoryBatcher. */
const BATCH_CHAR_BUDGET = 100_000;

/** One pasted stack trace can be 100 KB; the head carries the signal. */
const MSG_CHAR_CAP = 3_000;

/** A long thread truncates rather than blowing a batch on its own. */
const MAX_MSGS_PER_THREAD = 80;

/** Hard ceiling per window, so a busy day cannot run away. */
const MAX_MSGS_PER_WINDOW = 5_000;

/** Acknowledgements ("ok", "thanks") are most of the volume and carry no signal. */
const MIN_MSG_CHARS = 40;

/** Tickets per channel. Only those matching a fetched thread are used. */
const MAX_TICKETS_PER_CHANNEL = 800;

/** A ticket description can be a whole design doc; the head carries the intent. */
const TICKET_DESC_CAP = 1_500;

/** How long one extraction session may run before it is treated as stuck. */
const SESSION_WAIT_MS = Number(process.env["KB_EXTRACT_SESSION_WAIT_MS"] ?? 15 * 60 * 1000);

/**
 * Batches in flight at once.
 *
 * Unlike the merge, extraction batches are independent — each writes its own
 * findings object and none reads the KB — so they need no ordering between
 * them. Serialising them would make a 60-window backfill take days. The cap is
 * here only so one channel cannot open a session per batch against the model
 * provider all at once.
 */
const MAX_CONCURRENT_BATCHES = 4;

/** Base for citation links. Wrong-but-present beats a synthesised id. */
const SPACES_BASE_URL = (process.env["SPACES_PUBLIC_URL"] ?? "https://spaces.juspay.in").replace(/\/+$/, "");

interface Message {
  docId: string;
  threadId: string;
  userId: string;
  username: string | undefined;
  text: string;
  /** Display string, e.g. "13/05/2026". Not sortable — see createdAtTimestamp. */
  createdAt: string;
  /** Epoch ms. The only orderable time field on chat_message. */
  createdAtTimestamp: number;
}

/**
 * A ticket attached to a thread.
 *
 * Threads and tickets are the same conversation seen from two sides: the thread
 * carries the diagnosis, the ticket carries the resolution and who owned it.
 * Extracting one without the other loses half of most findings.
 */
interface Ticket {
  xyneId: string;
  title: string;
  description: string;
  status: string;
  stage: string;
  assignedToName: string;
  createdByName: string;
  threadId: string;
}

interface Thread {
  threadId: string;
  messages: Message[];
  ticket: Ticket | undefined;
  chars: number;
}

interface Window {
  from: Date;
  to: Date;
}

interface ExtractTarget {
  channelId: string;
  channelName: string;
  /** The user the KB listing is read as, for the known-entity vocabulary. */
  userId: string;
  /** Chosen per project, so one project can trial a different prompt. */
  agentSlug: string;
  project: { id: string; code: string; name: string };
  workspaceId: string;
}

// ---------------------------------------------------------------------------
// Vespa
// ---------------------------------------------------------------------------

/** Vespa rejects any single request above this; larger reads must page. */
const VESPA_PAGE_SIZE = 400;

async function vespaPage(yql: string, hits: number, offset: number): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${CONFIG.vespaQueryEndpoint}/search/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ yql, hits, offset, timeout: "20s" }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`vespa query failed (${response.status}): ${await response.text()}`);
  }

  const body = (await response.json()) as {
    root?: {
      children?: Array<{ fields?: Record<string, unknown> }>;
      errors?: Array<{ message?: string }>;
    };
  };
  // Vespa answers 200 with an `errors` array for a rejected query, so a bad
  // request would otherwise look like an empty result — indistinguishable from
  // a quiet channel.
  const failure = body.root?.errors?.[0]?.message;
  if (failure) throw new Error(`vespa query rejected: ${failure}`);

  return (body.root?.children ?? []).map((child) => child.fields ?? {});
}

/**
 * Reads up to `limit` rows, paging around Vespa's per-request cap.
 *
 * Offset paging is NOT used: Vespa rejects offsets past ~1000, so a busy window
 * would truncate silently. Instead the caller supplies a `__CURSOR__` token in
 * the YQL, which is replaced with the highest createdAtTimestamp seen so far —
 * unbounded, and stable because the query is ordered.
 */
async function vespaQuery(yql: string, limit: number, cursorFrom?: number): Promise<Array<Record<string, unknown>>> {
  const cursored = yql.includes("__CURSOR__");
  if (!cursored) return vespaPage(yql, Math.min(VESPA_PAGE_SIZE, limit), 0);

  const rows: Array<Record<string, unknown>> = [];
  let cursor = cursorFrom ?? 0;

  while (rows.length < limit) {
    const page = await vespaPage(
      `${yql.replace("__CURSOR__", String(cursor))} order by createdAtTimestamp asc`,
      VESPA_PAGE_SIZE,
      0,
    );
    if (page.length === 0) break;
    rows.push(...page);

    const newest = Math.max(...page.map((r) => Number(r["createdAtTimestamp"] ?? 0)));
    // No forward progress means every row shares a timestamp; stop rather than
    // loop forever re-reading the same page.
    if (newest <= cursor) break;
    cursor = newest + 1;
    if (page.length < VESPA_PAGE_SIZE) break;
  }
  return rows;
}

async function fetchMessages(channelId: string, window: Window): Promise<Message[]> {
  const safeChannelId = channelId.replace(/"/g, "");
  const yql =
    `select docId, threadId, userId, username, text, createdAt, createdAtTimestamp from chat_message where ` +
    `channelId contains "${safeChannelId}" and ` +
    `createdAtTimestamp >= __CURSOR__ and ` +
    `createdAtTimestamp < ${window.to.getTime()} and ` +
    `deletedAt = 0`;

  const rows = await vespaQuery(yql, MAX_MSGS_PER_WINDOW, window.from.getTime());

  return rows
    .map((row) => ({
      docId: String(row["docId"] ?? ""),
      threadId: String(row["threadId"] ?? row["docId"] ?? ""),
      userId: String(row["userId"] ?? ""),
      username: row["username"] ? String(row["username"]) : undefined,
      text: String(row["text"] ?? "").slice(0, MSG_CHAR_CAP),
      createdAt: String(row["createdAt"] ?? ""),
      createdAtTimestamp: Number(row["createdAtTimestamp"] ?? 0),
    }))
    .filter((message) => message.text.trim().length >= MIN_MSG_CHARS);
}

/** Tickets raised in this channel, keyed by the thread they belong to. */
async function fetchTickets(channelId: string): Promise<Map<string, Ticket>> {
  const safeChannelId = channelId.replace(/"/g, "");
  const yql =
    `select xyneId, title, description, status, stage, threadId, assignedToName, createdByName ` +
    `from ticket where channelId contains "${safeChannelId}"`;

  const byThread = new Map<string, Ticket>();
  try {
    for (const row of await vespaQuery(yql, MAX_TICKETS_PER_CHANNEL)) {
      const threadId = String(row["threadId"] ?? "");
      if (!threadId) continue;
      byThread.set(threadId, {
        xyneId: String(row["xyneId"] ?? ""),
        title: String(row["title"] ?? ""),
        description: String(row["description"] ?? "").slice(0, TICKET_DESC_CAP),
        status: String(row["status"] ?? ""),
        stage: String(row["stage"] ?? ""),
        assignedToName: String(row["assignedToName"] ?? ""),
        createdByName: String(row["createdByName"] ?? ""),
        threadId,
      });
    }
  } catch (err) {
    // Non-fatal: chat alone still yields findings, just poorer ones.
    logger.warn("[kb-extract] ticket fetch failed; continuing with chat only", {
      channelId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return byThread;
}

// ---------------------------------------------------------------------------
// Grouping and batching
// ---------------------------------------------------------------------------

/**
 * Groups messages into threads.
 *
 * The thread is the unit extraction works on. Per-message extraction was tried
 * first and produced rosters of 133 people, because a message read on its own
 * loses the context that gives it meaning.
 */
function groupThreads(messages: Message[], tickets: Map<string, Ticket>): Thread[] {
  const byThread = new Map<string, Message[]>();

  for (const message of messages) {
    const existing = byThread.get(message.threadId) ?? [];
    existing.push(message);
    byThread.set(message.threadId, existing);
  }

  const threads: Thread[] = [];
  for (const [threadId, threadMessages] of byThread) {
    const ordered = threadMessages
      // Sorted on the numeric field: `createdAt` is a display string like
      // "13/05/2026", which sorts lexicographically and therefore wrongly.
      .sort((a, b) => a.createdAtTimestamp - b.createdAtTimestamp)
      .slice(0, MAX_MSGS_PER_THREAD);

    threads.push({
      threadId,
      messages: ordered,
      ticket: tickets.get(threadId),
      chars: ordered.reduce((total, message) => total + message.text.length, 0),
    });
  }
  return threads;
}

/** Packs threads until the next would overflow. A thread is never split. */
function packBatches(threads: Thread[]): Thread[][] {
  const batches: Thread[][] = [];
  let current: Thread[] = [];
  let chars = 0;

  for (const thread of threads) {
    const wouldOverflow = current.length > 0 && chars + thread.chars > BATCH_CHAR_BUDGET;
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(thread);
    chars += thread.chars;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function renderBatch(threads: Thread[], channelId: string): string {
  return threads
    .map((thread) => {
      const header = `### Thread ${thread.threadId}\n` +
        // Real permalink, so citations in the KB are clickable. Synthesising one
        // from an id produces links that look right and go nowhere.
        `permalink: ${SPACES_BASE_URL}/c/${channelId}/t/${thread.threadId}\n`;

      const ticket = thread.ticket
        ? `[TICKET ${thread.ticket.xyneId}] status=${thread.ticket.status} stage=${thread.ticket.stage} ` +
          `assignee=${thread.ticket.assignedToName} reporter=${thread.ticket.createdByName}\n` +
          `permalink: ${SPACES_BASE_URL}/tickets/${thread.ticket.xyneId}\n` +
          `  title: ${thread.ticket.title}\n  description: ${thread.ticket.description}\n`
        : "";

      const lines = thread.messages
        .map((m) => `[${m.createdAt}] ${m.username ?? m.userId} (userId: ${m.userId}): ${m.text}`)
        .join("\n");

      return header + ticket + lines;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/**
 * The windows a channel still owes, oldest first.
 *
 * Starts at the watermark, or at `backfillFrom` when the channel has never run.
 * Capped so one far-behind channel cannot consume a whole night.
 */
function pendingWindows(channel: {
  extractedThrough: Date | null;
  backfillFrom: Date | null;
  includedAt: Date | null;
}): Window[] {
  const start = channel.extractedThrough ?? channel.backfillFrom ?? channel.includedAt ?? new Date();

  // Still catching up gets the higher cap. The test is how far behind the
  // watermark is, NOT whether one window has completed: after the first run a
  // backfilling channel has a watermark like any other, and treating that as
  // "caught up" would drop it to the steady-state cap with months still to go.
  const daysBehind = (Date.now() - start.getTime()) / (24 * 60 * 60 * 1000);
  const limit = daysBehind > MAX_WINDOWS_PER_RUN ? MAX_WINDOWS_BACKFILL : MAX_WINDOWS_PER_RUN;

  const windows: Window[] = [];
  const now = Date.now();
  let cursor = start.getTime();

  while (cursor < now && windows.length < limit) {
    const to = Math.min(cursor + WINDOW_HOURS * 60 * 60 * 1000, now);
    windows.push({ from: new Date(cursor), to: new Date(to) });
    cursor = to;
  }
  return windows;
}

/**
 * Entity names already in the KB for this project.
 *
 * Without it every batch is a blank slate and invents its own name for the same
 * thing — one day's findings produced `vespa`, `vespa-search-metrics` and
 * `askai` alongside an existing `ask-ai`. Naming is the one decision a batch
 * cannot make correctly in isolation, so the vocabulary is supplied rather than
 * left to the model.
 */
async function knownEntities(projectCode: string, userId: string): Promise<string[]> {
  const project = await prisma.kbProject.findUnique({ where: { projectCode } });
  if (!project || !userId) return [];

  try {
    const params = new URLSearchParams({ collectionId: project.collectionId, userId });
    const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/kb/list?${params}`, {
      headers: {
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey, "x-user-id": userId } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      // Silence here reads as "the KB is empty", and an empty vocabulary is
      // exactly what makes a batch invent its own names — the failure this
      // function exists to prevent. Usually an expired session for enabledBy.
      logger.warn("[kb-extract] known-entity list failed", {
        code: projectCode,
        status: String(res.status),
      });
      return [];
    }

    const body = (await res.json()) as { data?: { paths?: string[] } };
    const names = new Set<string>();
    for (const path of body.data?.paths ?? []) {
      // projects/<CODE>/<root>/<entity>/<file>.md
      const parts = path.split("/");
      if (parts.length >= 4) names.add(parts[3]!);
    }
    return [...names].sort();
  } catch {
    // Non-fatal: extraction still works, it just names less consistently.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

async function runBatch(
  batch: Thread[],
  target: ExtractTarget,
  window: Window,
  index: number,
  total: number,
  known: string[],
): Promise<void> {
  const agent = await prisma.agent.findFirst({ where: { slug: target.agentSlug } });
  if (!agent) throw new Error(`agent ${target.agentSlug} not found`);

  const agentConfig = await attachKbGrantsToConfig(
    agent.config as Record<string, unknown>,
    agent.id,
    prisma,
  );

  const day = window.from.toISOString().slice(0, 10);

  // Goes through claw-auth's own /internal/run, not claw directly: claw refuses
  // a run without a sessionId and sessionToken, and minting those is claw-auth's
  // job. Same path the scheduled-jobs worker uses.
  //
  // Consumed as SSE rather than fire-and-forget. Dispatch is not completion —
  // /internal/run answers as soon as the session is minted and the agent then
  // runs for minutes, so a batch whose agent died used to count as done and the
  // watermark advanced past threads nothing had read. The stream closing is the
  // completion signal, and it carries the terminal status with it.
  const stream = await consumeClawStream({
    url: `${CONFIG.internalUrl}/claw/api/v1/internal/run`,
    s2sKey: CONFIG.xyneClawS2sKey,
    // A hung agent must not hold the window open forever.
    signal: AbortSignal.timeout(SESSION_WAIT_MS),
    handlers: {
      onError: (sessionId, error) => {
        logger.error("[kb-extract] session error", { sessionId: sessionId ?? "?", error });
      },
    },
    body: {
      userId: agent.ownerUserId,
      agentSlug: target.agentSlug,
      systemPrompt: agent.systemPrompt,
      task:
        (known.length > 0
          ? `KNOWN ENTITIES — reuse these exact names when a finding refers to one, ` +
            `and only invent a name when it is genuinely something else:\n  ${known.join(", ")}\n\n`
          : "") +
        `Extract findings from these threads. Batch ${index + 1} of ${total}.\n` +
        `Project: ${target.project.name} (code ${target.project.code}).\n` +
        `Channel: ${target.channelName}.\n` +
        `Call emit-finding once per observation. Emit nothing if a thread carries no signal.`,
      context: renderBatch(batch, target.channelId),
      // Distinct per batch, so each is its own session rather than resuming the
      // previous batch's context.
      // Unique per attempt — a deterministic id resumes the previous session,
      // which then believes the window is already done and emits nothing.
      conversationId: `kb-extract-${target.project.code}-${target.channelId}-${day}-${index}-${Date.now()}`,
      agentConfig: {
        ...(agentConfig ?? {}),
        // Closed over by emit-finding, so the model cannot attribute a finding
        // to another project or get the project code wrong.
        findingScope: {
          workspaceId: target.workspaceId,
          project: target.project,
          // The window's date, so findings are filed by when the conversation
          // happened rather than when extraction ran. A backfill otherwise
          // dumps months into one prefix and the merge cannot process it in
          // order.
          day,
        },
      },
    },
  });

  // A stream that ends without a `done` frame means the run was lost, not that
  // it succeeded quietly — the batch's findings never reached storage either way.
  if (stream.result?.status !== "completed") {
    throw new Error(
      `extraction session ended as ${stream.result?.status ?? stream.errorReason ?? "no done frame"}`,
    );
  }
}

/**
 * Extracts one window for one channel, recording the attempt either way.
 *
 * Returns true when the window completed, which is the caller's signal to
 * advance the watermark. An empty window still completes — otherwise a quiet
 * channel would rescan the same range every night forever.
 */
async function runWindow(target: ExtractTarget, window: Window): Promise<boolean> {
  const run = await prisma.kbRun.create({
    data: {
      kind: "EXTRACT",
      projectId: target.project.id,
      projectCode: target.project.code,
      subject: target.channelName,
      channelId: target.channelId,
      windowFrom: window.from,
      windowTo: window.to,
    },
  });

  try {
    const [messages, tickets] = await Promise.all([
      fetchMessages(target.channelId, window),
      fetchTickets(target.channelId),
    ]);
    const threads = groupThreads(messages, tickets);
    const batches = packBatches(threads);
    // Fetched once per window: the vocabulary barely moves between batches, and
    // a list call per batch would be pure overhead.
    const known = await knownEntities(target.project.code, target.userId);

    let failedBatches = 0;
    // A few at a time, waiting for each group before starting the next. Every
    // batch is awaited to completion, so the window's status reflects what the
    // agents actually did rather than what was dispatched.
    for (let start = 0; start < batches.length; start += MAX_CONCURRENT_BATCHES) {
      const group = batches.slice(start, start + MAX_CONCURRENT_BATCHES);
      const outcomes = await Promise.allSettled(
        group.map((batch, offset) =>
          runBatch(batch, target, window, start + offset, batches.length, known),
        ),
      );

      outcomes.forEach((outcome, offset) => {
        if (outcome.status === "fulfilled") return;
        // Non-fatal: the remaining batches still carry findings worth having.
        failedBatches += 1;
        logger.error("[kb-extract] batch failed", {
          channel: target.channelName,
          batch: `${start + offset + 1}/${batches.length}`,
          err: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      });
    }

    const failed = failedBatches > 0;
    await prisma.kbRun.update({
      where: { id: run.id },
      data: {
        metrics: { threads: threads.length, batches: batches.length },
        status: failed ? "FAILED" : "COMPLETED",
        finishedAt: new Date(),
        ...(failed ? { error: `${failedBatches} of ${batches.length} batches failed` } : {}),
      },
    });

    // A partially failed window is not advanced past — those threads would
    // otherwise never be looked at again.
    return !failed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.kbRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: message, finishedAt: new Date() },
    });
    logger.error("[kb-extract] window failed", { channel: target.channelName, err: message });
    return false;
  }
}

/**
 * Walks every included channel forward to now.
 *
 * `onlyProjectCode` narrows to one project, which is how an admin triggers a KB
 * on demand rather than waiting for the nightly.
 */
export async function runKbExtraction(
  onlyProjectCode?: string,
  onlyChannelId?: string,
): Promise<void> {
  const channels = await prisma.kbChannel.findMany({
    where: {
      included: true,
      ...(onlyChannelId ? { channelId: onlyChannelId } : {}),
      project: {
        enabled: true,
        ...(onlyProjectCode ? { projectCode: onlyProjectCode } : {}),
      },
    },
    include: { project: true },
  });

  if (channels.length === 0) {
    logger.info("[kb-extract] no included channels — nothing to do", {
      ...(onlyProjectCode ? { requestedProject: onlyProjectCode } : {}),
      ...(onlyChannelId ? { requestedChannel: onlyChannelId } : {}),
    });
    return;
  }

  logger.info("[kb-extract] starting", { channels: String(channels.length) });

  for (const channel of channels) {
    const target: ExtractTarget = {
      channelId: channel.channelId,
      channelName: channel.name,
      project: {
        id: channel.project.projectId,
        code: channel.project.projectCode,
        name: channel.project.projectName,
      },
      workspaceId: channel.project.workspaceId,
      agentSlug: channel.project.extractAgentSlug ?? DEFAULT_AGENT_SLUG,
      userId: channel.project.enabledBy ?? "",
    };

    const windows = pendingWindows(channel);
    if (windows.length === 0) continue;

    logger.info("[kb-extract] channel", {
      channel: channel.name,
      project: channel.project.projectCode,
      windows: String(windows.length),
      from: windows[0]!.from.toISOString(),
    });

    for (const window of windows) {
      const completed = await runWindow(target, window);

      if (!completed) {
        // Stop at the first failure. Advancing past it would skip those threads
        // permanently; the next run retries this same window.
        await prisma.kbChannel.update({
          where: { channelId: channel.channelId },
          data: { lastRunAt: new Date(), lastError: "window failed — will retry" },
        });
        break;
      }

      await prisma.kbChannel.update({
        where: { channelId: channel.channelId },
        data: { extractedThrough: window.to, lastRunAt: new Date(), lastError: null },
      });
    }
  }

  logger.info("[kb-extract] finished");
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

function scheduleNextRun(): void {
  const now = new Date();
  // 1:30 AM IST = 20:00 UTC the previous calendar day.
  const nextRun = new Date(now);
  nextRun.setUTCHours(20, 0, 0, 0);
  if (nextRun <= now) nextRun.setUTCDate(nextRun.getUTCDate() + 1);

  logger.info("[kb-extract] next run scheduled", { nextRun: nextRun.toISOString() });

  setTimeout(async () => {
    try {
      // Multi-replica guard: every pod arms this timer, only one wins the lock.
      if (await acquireCronLeaderLock("kb-extract-daily")) {
        await runKbExtraction();
      } else {
        logger.info("[kb-extract] skipped — another replica is running tonight's extraction");
      }
    } catch (err) {
      logger.error("[kb-extract] unhandled error", {
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      scheduleNextRun();
    }
  }, nextRun.getTime() - now.getTime());
}

export function initKbExtractDaily(): void {
  if (process.env["ENABLE_KB_EXTRACT_DAILY"] !== "true") {
    logger.info("[kb-extract] disabled (set ENABLE_KB_EXTRACT_DAILY=true to enable)");
    return;
  }
  logger.info("[kb-extract] initialising");
  scheduleNextRun();
}
