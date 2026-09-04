/**
 * Vespa reads for entity extraction: a channel's threads, its messages, and its
 * tickets.
 *
 * In Spaces this lived on the backend's `vespaClient.channelService` (built with
 * YqlBuilder). claw-auth has no YqlBuilder, so the four queries are written as
 * raw YQL against the same schemas and executed through `callVespa` — the same
 * client the direct-Vespa MCP tools use.
 *
 * No ACL guard on any of these: this is a workspace-level job over a channel an
 * operator explicitly chose, not a per-user search. That mirrors the Spaces
 * original (`requirePermissions: false`) and is why the routes that trigger it
 * are admin-gated.
 */

import { CONFIG } from "../../config.js";
import { errMsg } from "../../lib/errors.js";
import { callVespa, esc } from "../../mcp/servers/vespa-direct.js";
import { createLogger, createTraceId } from "../../logger.js";

const logger = createLogger("entity-channel-source", createTraceId());

const MESSAGE_SCHEMA = "chat_message";
const TICKET_SCHEMA = "ticket";
const MAIL_SCHEMA = "mail";
const CHANNEL_SCHEMA = "chat_container";

/** Messages per page when walking a channel's threads. */
const MESSAGE_PAGE = 400;

export interface ChannelThreadMessage {
  id: string;
  text: string;
  threadId: string;
  userId: string;
  createdAtTimestamp: number;
}

export interface ThreadMail {
  id: string;
  /** Subject line — human-written and high-signal, so it leads the doc text. */
  subject: string;
  /** Body, reassembled from the schema's `chunks` array. */
  body: string;
  threadId: string;
  timestamp: number;
}

export interface ChannelTicket {
  id: string;
  title: string;
  description: string;
  /** The ticket's conversation thread, so its full discussion can be fetched. */
  threadId: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
  description?: string;
  /**
   * The channel's own workspace. Authoritative for scoping a run: a run belongs
   * to the workspace that owns the channel, not to whatever workspace the
   * triggering session happens to be scoped to.
   */
  workspaceId?: string;
}

interface VespaHit {
  fields?: Record<string, unknown>;
}

interface VespaResponse {
  root?: { children?: unknown[] };
}

async function query(payload: Record<string, unknown>): Promise<VespaResponse> {
  return (await callVespa(payload, CONFIG.vespaQueryEndpoint)) as VespaResponse;
}

function hitsOf(res: VespaResponse): VespaHit[] {
  return (res.root?.children ?? []) as VespaHit[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * A Vespa grouping response nests group buckets under root.children. Each
 * bucket carries the group key as `value`. Walk the tree and collect them.
 */
function collectGroupValues(res: VespaResponse): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { value?: unknown; children?: unknown[] };
    if (typeof n.value === "string") out.push(n.value);
    if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  (res.root?.children ?? []).forEach(walk);
  return out;
}

/** Channel name/description from Vespa; falls back to the id. */
export async function getChannel(channelId: string): Promise<ChannelInfo> {
  try {
    // The channel's human label is `channelName` on chat_container, NOT `name`
    // (which doesn't exist on this schema and comes back null). `description`
    // is a real, human-authored channel description and is worth the prompt
    // weight — channelMetaDocument treats channel meta as a high-confidence
    // signal precisely because a human wrote it.
    const yql =
      `select docId, channelName, description, workspaceId from sources ${CHANNEL_SCHEMA} ` +
      `where docId contains "${esc(channelId)}"`;
    const res = await query({ yql, hits: 1, "ranking.profile": "unranked" });
    const fields = hitsOf(res)[0]?.fields ?? {};
    const description = str(fields["description"]);
    const workspaceId = str(fields["workspaceId"]);
    return {
      id: channelId,
      name: str(fields["channelName"]) || channelId,
      ...(description ? { description } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    };
  } catch (err) {
    logger.error("[entity-source] channel lookup failed", {
      channelId,
      err: errMsg(err),
    });
    return { id: channelId, name: channelId };
  }
}

/**
 * The most recent thread ids in a channel, via a group-by-threadId query.
 *
 * The caller then fetches and processes one thread at a time
 * (getThreadMessages), so no more than a single thread is ever held in memory.
 */
export async function getChannelThreadIds(channelId: string, maxThreads = 300): Promise<string[]> {
  try {
    // hits:0 — grouping returns only the buckets, no document hits.
    const yql =
      `select threadId from sources ${MESSAGE_SCHEMA} ` +
      `where channelId contains "${esc(channelId)}" and messageType contains "USER" ` +
      `| all(group(threadId) max(${Math.trunc(maxThreads)}) ` +
      `order(-max(createdAtTimestamp)) each(output(count())))`;
    const res = await query({ yql, hits: 0, "ranking.profile": "unranked" });
    return collectGroupValues(res);
  } catch (err) {
    logger.error("[entity-source] thread ids failed", {
      channelId,
      err: errMsg(err),
    });
    return [];
  }
}

/**
 * Every USER message of one thread, oldest first. Paged by timestamp cursor so
 * a long thread comes back complete, never truncated at a hit cap.
 */
export async function getThreadMessages(threadId: string): Promise<ChannelThreadMessage[]> {
  const messages: ChannelThreadMessage[] = [];
  let before = Number.MAX_SAFE_INTEGER;

  try {
    for (;;) {
      const yql =
        `select docId, text, threadId, userId, createdAtTimestamp from sources ${MESSAGE_SCHEMA} ` +
        `where threadId contains "${esc(threadId)}" and messageType contains "USER" ` +
        `and createdAtTimestamp < ${before} ` +
        `order by createdAtTimestamp desc`;
      const res = await query({ yql, hits: MESSAGE_PAGE, "ranking.profile": "unranked" });

      const hits = hitsOf(res);
      if (hits.length === 0) break;

      for (const hit of hits) {
        const f = hit.fields ?? {};
        const ts = typeof f["createdAtTimestamp"] === "number" ? f["createdAtTimestamp"] : 0;
        if (ts && ts < before) before = ts;

        const text = str(f["text"]);
        const docId = str(f["docId"]);
        if (!text || !docId) continue;
        messages.push({
          id: docId,
          text,
          threadId,
          userId: str(f["userId"]),
          createdAtTimestamp: ts,
        });
      }

      if (hits.length < MESSAGE_PAGE) break;
    }
  } catch (err) {
    logger.error("[entity-source] thread messages failed", {
      threadId,
      err: errMsg(err),
    });
  }
  return messages;
}

/**
 * Every mail on one thread, for support channels where the conversation happens
 * over email rather than chat. Tickets join to mail on the SAME `threadId` they
 * join to chat messages on, and a thread can carry both — so callers merge the
 * two streams chronologically rather than choosing between them.
 *
 * Deliberately does NOT fetch the sender. `from` is a YQL reserved word: bare
 * `from` is a parse error, and `"from"` parses but silently returns nothing —
 * only `select *` yields it, which drags back all 18 summary fields including
 * chunk_embeddings on every thread. The pipeline never reads authorId anyway,
 * so a narrow select is strictly better here.
 */
export async function getThreadMails(threadId: string): Promise<ThreadMail[]> {
  try {
    const yql =
      `select docId, subject, timestamp, chunks from sources ${MAIL_SCHEMA} ` +
      `where threadId contains "${esc(threadId)}"`;
    const res = await query({ yql, hits: MESSAGE_PAGE, "ranking.profile": "unranked" });

    const out: ThreadMail[] = [];
    for (const hit of hitsOf(res)) {
      const f = hit.fields ?? {};
      const id = str(f["docId"]);
      // The body is chunked at ingest; rejoin so the thread reads as prose.
      const chunks = Array.isArray(f["chunks"]) ? (f["chunks"] as unknown[]).filter((c): c is string => typeof c === "string") : [];
      const body = chunks.join("\n");
      const subject = str(f["subject"]);
      if (!id || (!subject && !body)) continue;
      out.push({
        id,
        subject,
        body,
        threadId,
        timestamp: typeof f["timestamp"] === "number" ? f["timestamp"] : 0,
      });
    }
    return out;
  } catch (err) {
    logger.error("[entity-source] thread mails failed", {
      threadId,
      err: errMsg(err),
    });
    return [];
  }
}

/**
 * Thread ids that carry MAIL in this channel. Support channels can have threads
 * with no chat message at all, which getChannelThreadIds would never surface.
 */
export async function getChannelMailThreadIds(channelId: string, maxThreads = 300): Promise<string[]> {
  try {
    const yql =
      `select threadId from sources ${MAIL_SCHEMA} ` +
      `where channelId contains "${esc(channelId)}" ` +
      `| all(group(threadId) max(${Math.trunc(maxThreads)}) ` +
      `order(-max(timestamp)) each(output(count())))`;
    const res = await query({ yql, hits: 0, "ranking.profile": "unranked" });
    return collectGroupValues(res);
  } catch (err) {
    logger.error("[entity-source] mail thread ids failed", {
      channelId,
      err: errMsg(err),
    });
    return [];
  }
}

/**
 * Every ticket attached to a channel, via the ticket schema's channelRef.
 *
 * Tickets are high-signal for type discovery: title + description are
 * human-authored and name entities explicitly, often more cleanly than chat.
 * Closed tickets are included on purpose — resolved incidents are some of the
 * richest entity data a channel has.
 */
export async function getChannelTickets(
  channelId: string,
  // Vespa rejects a single query asking for more than 400 hits, so this is the
  // ceiling. A channel with more tickets would need cursor pagination.
  maxTickets = 400,
): Promise<ChannelTicket[]> {
  try {
    // Filter on the imported `channelId` (ticket.sd: `import field
    // channelRef.docId as channelId`). The raw channelRef holds a full Vespa
    // document id, so matching it against a bare channel id never hits.
    const yql =
      `select docId, title, description_clean, description, threadId from sources ${TICKET_SCHEMA} ` +
      `where channelId contains "${esc(channelId)}"`;
    const res = await query({
      yql,
      hits: Math.min(Math.trunc(maxTickets), 400),
      "ranking.profile": "unranked",
    });

    const out: ChannelTicket[] = [];
    for (const hit of hitsOf(res)) {
      const f = hit.fields ?? {};
      const id = str(f["docId"]);
      // description_clean is the normalized body; fall back to raw description.
      const description = str(f["description_clean"]) || str(f["description"]);
      const title = str(f["title"]);
      const threadId = str(f["threadId"]);
      if (!id || (!title && !description)) continue;
      out.push({ id, title, description, threadId });
    }
    return out;
  } catch (err) {
    logger.error("[entity-source] channel tickets failed", {
      channelId,
      err: errMsg(err),
    });
    return [];
  }
}
