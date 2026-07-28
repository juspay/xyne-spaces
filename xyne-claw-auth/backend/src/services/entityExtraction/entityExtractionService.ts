/**
 * Type discovery for one channel.
 *
 * Called from the entity-extraction worker only — never from an HTTP handler.
 * A request creates a run row, enqueues a job, and reads state back.
 *
 * Scope is type discovery: read the channel, discover a candidate type set,
 * and stop at AWAITING_TYPE_APPROVAL.
 *
 * claw-auth owns the VOCABULARY (EntityTypeDefinition) and the discovery run,
 * not the entity registry. Resolving mentions to entities, and storing
 * Entity/EntityAlias rows, belongs to the Spaces backend — it owns message
 * ingest and the Vespa write path, and keeping alias matching next to that data
 * avoids a network hop inside the sequential resolve loop.
 *
 * Mention extraction and entity resolution are deliberately absent: they belong
 * to the Spaces backend, which owns Entity/EntityAlias and the message-level
 * Vespa writes.
 */

import { CONFIG } from "../../config.js";
import { prisma } from "../../db.js";
import { createLogger, createTraceId } from "../../logger.js";
import { entityLlm } from "./entityLlmClient.js";
import {
  getChannel,
  getChannelMailThreadIds,
  getChannelThreadIds,
  getChannelTickets,
  getThreadMails,
  getThreadMessages,
  type ChannelInfo,
} from "./channelSource.js";
import {
  buildThreadDocument,
  buildTicketDocument,
  channelMetaDocument,
  discoverTypeCandidates,
  mapWithConcurrency,
  mergeConfig,
  proposeTypes,
  type BootstrapConfig,
  type SourceDocument,
  type SourceMessage,
} from "./pipeline/index.js";
import type { Logger as PipelineLogger } from "./pipeline/ports.js";

const logger = createLogger("entity-extraction", createTraceId());

/** The pipeline's Logger port. The shared logger already satisfies it. */
const pipelineLogger: PipelineLogger = logger;

function settings(): BootstrapConfig {
  return mergeConfig({
    // Keep whole threads intact: a thread's full context is what makes it
    // useful for discovering types. Only genuinely huge threads (beyond the
    // model's context) split, and never truncate.
    fetchMessages: { maxThreadChars: 60_000 },
    extract: {
      maxDocChars: 60_000,
      maxBatchChars: 60_000,
      concurrency: CONFIG.entityExtraction.concurrency,
    },
  });
}

/** Read the channel, discover a candidate type set, pause for approval. */
export async function discoverTypes(runId: string): Promise<void> {
  const run = await requireRun(runId);
  const conf = settings();

  await setStage(runId, "FETCHING_MESSAGES");
  const channel = await getChannel(run.channelId);
  const { docs, stats } = await collectDocuments(channel, conf);

  if (docs.length === 0) {
    throw new Error(
      `No usable documents in channel ${run.channelId} ` +
        `(${stats.threads} threads, ${stats.messages} messages, ${stats.tickets} tickets)`,
    );
  }

  logger.info("[entity-extraction] documents built", {
    runId,
    ...stats,
    documents: docs.length,
  });

  await prisma.entityExtractionRun.update({
    where: { id: runId },
    data: { messageCount: stats.messages, documentCount: docs.length },
  });

  await setStage(runId, "DISCOVERING_TYPES");

  // Org framing (who the data belongs to) plus any per-channel context supplied
  // at trigger time, prepended to both prompts so the model knows whose data it
  // is reading and what this channel is about.
  const channelContext = (run.settings as { channelContext?: string } | null)?.channelContext;
  const context = buildContext(CONFIG.entityExtraction.orgContext, channelContext);

  // Every thread goes through discovery — thread count is already bounded by
  // maxThreadsPerChannel, and type discovery wants full coverage so rare types
  // are not sampled away. discoverTypeCandidates batches by size internally.
  const candidates = await discoverTypeCandidates(docs, entityLlm, conf, pipelineLogger, context);

  // Existing workspace types are passed in so a second channel reuses GATEWAY
  // rather than inventing GATEWAY_2. Without this, ten channels produce forty
  // near-duplicate types and type filters silently miss half their entities.
  const existing = await prisma.entityTypeDefinition.findMany({
    where: { workspaceId: run.workspaceId, status: "APPROVED" },
    select: { name: true, prefix: true, rule: true },
  });

  const { typeSet, dropped } = await proposeTypes(
    candidates,
    entityLlm,
    pipelineLogger,
    existing,
    context,
  );

  await prisma.entityExtractionRun.update({
    where: { id: runId },
    data: {
      status: "AWAITING_TYPE_APPROVAL",
      proposedTypes: { types: typeSet.types, dropped } as never,
    },
  });

  logger.info("[entity-extraction] awaiting type approval", {
    runId,
    channelId: run.channelId,
    proposed: typeSet.types.length,
    dropped: dropped.length,
    reusedFromWorkspace: existing.length,
  });
}

/**
 * Fetch the channel's threads and its tickets, and build the source documents
 * for type discovery. No LLM. Shared by discoverTypes and previewContext.
 *
 * A ticket is the ROOT of its thread, but that root message's body is empty in
 * Vespa — the problem statement lives in the ticket's title/description. So we
 * index tickets by thread and prepend that text as the thread's opening
 * message; without it the thread has no subject and every "it"/"this" in the
 * replies refers to nothing. Tickets with no thread contribute a header doc.
 */
async function collectDocuments(
  channel: ChannelInfo,
  conf: BootstrapConfig,
  /** Hard cap on threads fetched. For fast previews; omit for a full run. */
  maxThreads?: number,
): Promise<{
  docs: SourceDocument[];
  stats: { threads: number; messages: number; tickets: number };
}> {
  const cap = maxThreads ?? CONFIG.entityExtraction.maxThreadsPerChannel;
  const channelThreadIds = await getChannelThreadIds(channel.id, cap);
  // Support channels hold the conversation in email, and a thread can be
  // mail-only — getChannelThreadIds reads chat_message and would never see it.
  const mailThreadIds = await getChannelMailThreadIds(channel.id, cap);

  const tickets = await getChannelTickets(channel.id, cap);
  const ticketByThread = new Map<string, (typeof tickets)[number]>();
  for (const ticket of tickets) {
    if (ticket.threadId) ticketByThread.set(ticket.threadId, ticket);
  }

  // Channel's own threads plus every ticket's conversation thread (so a ticket
  // discussion is read even if it fell outside the recency cap).
  let threadIds = [
    ...new Set([...channelThreadIds, ...mailThreadIds, ...ticketByThread.keys()]),
  ];
  if (maxThreads) threadIds = threadIds.slice(0, maxThreads);

  let messages = 0;
  let ticketsSeen = 0;
  const docs: SourceDocument[] = [];
  const meta = channelMetaDocument(channel, conf);
  if (meta) docs.push(meta);

  const perThread = await mapWithConcurrency(threadIds, 8, async (threadId) => {
    // A thread can carry chat AND mail (support channels routinely do), so both
    // streams are fetched and merged chronologically rather than chosen between.
    const [threadMessages, threadMails] = await Promise.all([
      getThreadMessages(threadId),
      getThreadMails(threadId),
    ]);
    messages += threadMessages.length + threadMails.length;

    const built: SourceMessage[] = [
      ...threadMessages.map((m) => ({
        id: m.id,
        channelId: channel.id,
        text: m.text,
        ts: m.createdAtTimestamp,
        threadId: m.threadId,
        ...(m.userId ? { authorId: m.userId } : {}),
      })),
      // Subject leads the body: it is human-written, names the problem, and is
      // often the only place an entity appears in an otherwise quoted reply.
      ...threadMails.map((m) => ({
        id: m.id,
        channelId: channel.id,
        text: m.subject ? `${m.subject}\n${m.body}` : m.body,
        ts: m.timestamp,
        threadId: m.threadId,
      })),
    ];
    // buildThreadDocument orders by ts, so the merge just needs both present.

    // Prepend the ticket header as the thread's root (ts:0 sorts it first).
    const ticket = ticketByThread.get(threadId);
    if (ticket) {
      const headerText = [ticket.title, ticket.description]
        .filter((p) => p && p.trim())
        .join("\n");
      if (headerText) {
        ticketsSeen++;
        built.unshift({
          id: `ticket:${ticket.id}`,
          channelId: channel.id,
          text: headerText,
          ts: 0,
          threadId,
        });
      }
    }
    return buildThreadDocument(threadId, built, channel, conf);
  });
  for (const threadDocs of perThread) docs.push(...threadDocs);

  for (const ticket of tickets) {
    if (ticket.threadId) continue;
    const ticketDoc = buildTicketDocument(ticket, channel, conf);
    if (ticketDoc) {
      docs.push(ticketDoc);
      ticketsSeen++;
    }
  }

  return { docs, stats: { threads: threadIds.length, messages, tickets: ticketsSeen } };
}

async function requireRun(runId: string) {
  const run = await prisma.entityExtractionRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`Entity extraction run ${runId} not found`);
  return run;
}

async function setStage(runId: string, stage: string): Promise<void> {
  await prisma.entityExtractionRun.update({ where: { id: runId }, data: { stage } });
}

/**
 * Assemble the framing prepended to the discovery prompts: the org description
 * (who the data belongs to) plus any per-channel context supplied at trigger
 * time. Empty string when neither is set.
 */
function buildContext(orgContext?: string, channelContext?: string): string {
  const parts: string[] = [];
  if (orgContext && orgContext.trim()) parts.push(orgContext.trim());
  if (channelContext && channelContext.trim()) {
    parts.push(`About this specific channel: ${channelContext.trim()}`);
  }
  return parts.join("\n\n");
}
