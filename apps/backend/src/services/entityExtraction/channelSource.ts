import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import vespaClient from '@/vespa/client';
import { messageSchema, ticketSchema } from '@/vespa/src/types';
import type { ResolvedRef } from '@/services/entityExtraction/entityResolver';
import {
  buildThreadDocument,
  type BootstrapConfig,
  type SourceDocument,
  type SourceMessage,
} from '@/services/entityExtraction/pipeline';

/**
 * Reads a thread from Vespa (chat + ticket header + mails) and builds the source
 * document mention extraction runs over, plus the reverse write-back. No LLM, no
 * persistence beyond that — the fetch-and-shape step for the per-thread worker.
 */

const prisma = DatabaseClient.getInstance();

export interface ChannelInfo {
  id: string;
  name: string;
}

/**
 * Build the source document(s) for ONE thread — the worker's entry point. Pulls
 * the thread's chat messages plus, if it is a ticket thread, the ticket header
 * (as the root) and its linked mails.
 */
export async function collectThreadDocuments(
  channel: ChannelInfo,
  threadId: string,
  settings: BootstrapConfig,
): Promise<SourceDocument[]> {
  const ticket = await vespaClient.channelService.getThreadTicket(threadId);
  const { messages } = await threadSourceMessages(channel, threadId, ticket ?? undefined);
  if (messages.length === 0) return [];
  return buildThreadDocument(threadId, messages, channel, settings);
}

/**
 * Assemble one thread's messages: chat messages, plus (for ticket threads) the
 * ticket header as the root and the linked mails, merged chronologically. The
 * ticket header and mails carry synthetic (`ticket:`/`mail:`) ids so the entity
 * write-back skips them — they are not chat_message docs.
 */
async function threadSourceMessages(
  channel: ChannelInfo,
  threadId: string,
  ticket?: { id: string; title: string; description: string },
): Promise<{ messages: SourceMessage[]; chatCount: number }> {
  const threadMessages = await vespaClient.channelService.getThreadMessages(threadId);
  const messages: SourceMessage[] = threadMessages.map((m) => ({
    id: m.id,
    channelId: channel.id,
    text: m.text,
    ts: m.createdAtTimestamp,
    threadId: m.threadId,
    ...(m.userId ? { authorId: m.userId } : {}),
  }));

  if (ticket) {
    // Mail-originated tickets carry their content in the emails (same threadId);
    // merge with their own timestamp so they sort with the chat replies.
    const mails = await vespaClient.channelService.getThreadMails(threadId);
    for (const mail of mails) {
      const text = [mail.subject, mail.body].filter((p) => p && p.trim()).join('\n');
      if (text) messages.push({ id: `mail:${mail.id}`, channelId: channel.id, text, ts: mail.timestamp, threadId });
    }
    // Prepend the ticket header as the thread's root (ts:0 sorts it first).
    const headerText = [ticket.title, ticket.description].filter((p) => p && p.trim()).join('\n');
    if (headerText) {
      messages.unshift({ id: `ticket:${ticket.id}`, channelId: channel.id, text: headerText, ts: 0, threadId });
    }
  }

  return { messages, chatCount: threadMessages.length };
}

/**
 * Write resolved entities back onto Vespa via partial updates — the step that
 * makes the registry searchable. Two targets:
 *   - each chat_message doc of a thread gets that thread's entities (coarse but
 *     right for "find the conversation about X"), and
 *   - the ticket doc gets the thread's entities unioned across its chunks
 *     (ticket.sd has the entity fields), so tickets — including mail-only ones
 *     with no chat messages — are searchable too.
 * Mails aren't written (mail.sd has no entity fields); their entities reach the
 * registry and the ticket. Returns the counts of docs updated.
 */
export async function writeEntitiesToVespa(
  byDoc: Map<string, ResolvedRef[]>,
  docs: SourceDocument[],
): Promise<{ messages: number; tickets: number }> {
  const entityIds = new Set<string>();
  for (const refs of byDoc.values()) for (const r of refs) entityIds.add(r.entityId);
  if (entityIds.size === 0) return { messages: 0, tickets: 0 };

  // One query for all canonical names, rather than per-entity lookups.
  const entities = await prisma.entity.findMany({
    where: { id: { in: [...entityIds] } },
    select: { id: true, canonicalName: true },
  });
  const nameById = new Map(entities.map((e) => [e.id, e.canonicalName]));
  const fieldsFor = (ids: string[], surfaceForms: string[]) => ({
    entityIds: ids,
    entityNames: ids.map((id) => nameById.get(id)).filter((n): n is string => !!n),
    entitySurfaceForms: surfaceForms,
  });

  const docById = new Map(docs.map((d) => [d.id, d]));
  const messageUpdates: { docId: string; fields: Record<string, unknown> }[] = [];
  const ticketEntityIds = new Map<string, Set<string>>();
  const ticketSurface = new Map<string, Set<string>>();

  for (const [docId, refs] of byDoc) {
    const doc = docById.get(docId);
    if (!doc) continue;
    const ids = [...new Set(refs.map((r) => r.entityId))];
    const surfaceForms = [...new Set(refs.map((r) => r.surfaceForm))];

    for (const messageId of doc.messageIds ?? []) {
      messageUpdates.push({ docId: messageId, fields: fieldsFor(ids, surfaceForms) });
    }
    if (doc.ticketId) {
      const eids = ticketEntityIds.get(doc.ticketId) ?? new Set();
      const sfs = ticketSurface.get(doc.ticketId) ?? new Set();
      for (const r of refs) {
        eids.add(r.entityId);
        sfs.add(r.surfaceForm);
      }
      ticketEntityIds.set(doc.ticketId, eids);
      ticketSurface.set(doc.ticketId, sfs);
    }
  }

  const ticketUpdates = [...ticketEntityIds.entries()].map(([ticketId, eids]) => ({
    docId: ticketId,
    fields: fieldsFor([...eids], [...(ticketSurface.get(ticketId) ?? [])]),
  }));

  if (messageUpdates.length) await vespaClient.crudService.update(messageUpdates, messageSchema);
  if (ticketUpdates.length) await vespaClient.crudService.update(ticketUpdates, ticketSchema);

  logger.info('[ENTITY_EXTRACTION] entities written to Vespa', {
    entities: entityIds.size,
    messages: messageUpdates.length,
    tickets: ticketUpdates.length,
  });
  return { messages: messageUpdates.length, tickets: ticketUpdates.length };
}
