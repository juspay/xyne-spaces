import { AttachmentEntityType, ChannelScopeType } from '@xyne/shared';
import { db } from '@/database/client';
import { resolveFieldDefinitionsByIds } from '@/utils/fieldDefinition';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { flowMessageSearchText } from '@/utils/flowJson';
import { extractLinksFromContent } from '@/utils/urlUtils';
import { buildFormFields, type TicketDynamicFieldValue } from '@/zero/vespa-injection/core/form-fields';
import { SubApp } from '@/vespa/src/types';

/**
 * The display fields of search hits, read from Postgres: the values the Vespa mapper (zero/vespa-injection/core/mapper.ts)
 * indexed, for the fields a hashed Vespa returns as hashes. Read-only, unlike the mapper, which also writes while it
 * builds a document (a chat message re-updates every other message of its thread in Vespa): search must not write.
 * One query per table for all the hits of a schema, instead of one mapper call per hit.
 *
 * Each loader takes the hits' own fields (docId plus the plaintext ids the summary returns, e.g. channelId, subApp)
 * and returns docId -> { field: value }, computed as the mapper computes it (file:line of the mapper in each comment).
 * Schemas with no Postgres source (memory, sam_transcript, chat_attachment, mail_attachment, sdlc_*) have no loader.
 */

export type DisplayFields = Record<string, unknown>;
type HitFields = Record<string, unknown>;
type Loader = (hits: HitFields[]) => Promise<Map<string, DisplayFields>>;

const ids = (values: unknown[]): string[] =>
  [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))];

/** Channel names as the chat_container document has them: DM and group-DM names are the members' names (mapper.ts:139). */
export async function resolvedChannelNames(channelIds: string[]): Promise<Map<string, string>> {
  if (channelIds.length === 0) return new Map();
  const channels = await db.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true, scopeType: true } });
  const isDm = (scopeType: string | null) => scopeType === ChannelScopeType.DM || scopeType === ChannelScopeType.GROUP_DM;
  const memberIds = ids(channels.filter((c) => isDm(c.scopeType) && c.name).flatMap((c) => c.name.split(',')));
  const users = memberIds.length
    ? await db.user.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return new Map(channels.map((c) => [c.id,
    isDm(c.scopeType) && c.name ? c.name.split(',').map((id) => nameOf.get(id)).filter((n) => n != null).join(',') : c.name]));
}

/** Raw channel names (Channel.name), which a few file descriptions and call documents use unresolved. */
async function rawChannelNames(channelIds: string[]): Promise<Map<string, string>> {
  if (channelIds.length === 0) return new Map();
  const channels = await db.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true } });
  return new Map(channels.map((c) => [c.id, c.name]));
}

/** threadSenders: the distinct senders of a conversation's messages (getThreadInfo, mapper.ts:211). */
async function threadSenders(conversationIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (conversationIds.length === 0) return out;
  const messages = await db.message.findMany({ where: { conversationId: { in: conversationIds } }, select: { conversationId: true, senderId: true } });
  for (const m of messages) {
    const senders = out.get(m.conversationId) ?? [];
    if (!senders.includes(m.senderId)) senders.push(m.senderId);
    out.set(m.conversationId, senders);
  }
  return out;
}

/** Ticket form fields (loadTicketFormFields, mapper.ts:64), for many tickets at once. */
async function ticketFormFields(ticketIds: string[]): Promise<Map<string, ReturnType<typeof buildFormFields>>> {
  const out = new Map<string, ReturnType<typeof buildFormFields>>();
  if (ticketIds.length === 0) return out;
  const values = await db.formEntityValues.findMany({
    where: { entityId: { in: ticketIds }, entityType: 'TICKET' },
    select: { entityId: true, fieldId: true, actualFieldValue: true },
  });
  const definitions = await resolveFieldDefinitionsByIds(db, ids(values.map((v) => v.fieldId)));
  const fieldTypeByFieldId = new Map([...definitions].map(([fieldId, d]) => [fieldId, d.fieldType]));
  const byTicket = new Map<string, TicketDynamicFieldValue[]>();
  for (const { entityId, fieldId, actualFieldValue } of values) {
    byTicket.set(entityId, [...(byTicket.get(entityId) ?? []), { fieldId, actualFieldValue } as TicketDynamicFieldValue]);
  }
  for (const id of ticketIds) out.set(id, buildFormFields(byTicket.get(id) ?? [], fieldTypeByFieldId));
  return out;
}

const loaders: Record<string, Loader> = {
  // mapMessage (mapper.ts:420). channelName is imported from chat_container (see IMPORTED in hydrateHits.ts).
  chat_message: async (hits) => {
    const messages = await db.message.findMany({
      where: { messageId: { in: ids(hits.map((h) => h.docId)) } },
      select: { messageId: true, conversationId: true, senderId: true, content: true },
    });
    const [senders, threads, channelNames] = await Promise.all([
      db.user.findMany({ where: { id: { in: ids(messages.map((m) => m.senderId)) } }, select: { id: true, name: true } }),
      threadSenders(ids(messages.map((m) => m.conversationId))),
      resolvedChannelNames(ids(hits.map((h) => h.channelId))),
    ]);
    const senderName = new Map(senders.map((u) => [u.id, u.name]));
    const channelOf = new Map(hits.map((h) => [String(h.docId), h.channelId as string | undefined]));
    return new Map(messages.map((m) => {
      const content = m.content || '';
      const channelId = channelOf.get(m.messageId);
      return [m.messageId, {
        text: flowMessageSearchText(content) || extractPlainTextFromHtml(content) || '',
        username: senderName.get(m.senderId) || '',
        threadSenders: threads.get(m.conversationId) ?? [],
        links: extractLinksFromContent(content),
        ...(channelId && channelNames.has(channelId) ? { messageChannelName: channelNames.get(channelId) } : {}),
      }];
    }));
  },

  // mapChannel (mapper.ts:333). entityTypeDefs is written by xyne-claw from its own database: not available here.
  chat_container: async (hits) => {
    const channelIds = ids(hits.map((h) => h.docId));
    const [channels, names] = await Promise.all([
      db.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, description: true } }),
      resolvedChannelNames(channelIds),
    ]);
    return new Map(channels.map((c) => [c.id, { channelName: names.get(c.id), description: c.description || '', topic: '' }]));
  },

  // mapTicket (mapper.ts:601). channelName is the ticket's own channel (Ticket.channelId), resolved.
  ticket: async (hits) => {
    const tickets = await db.ticket.findMany({
      where: { id: { in: ids(hits.map((h) => h.docId)) } },
      select: { id: true, title: true, description: true, xyneId: true, assignedTo: true, conversationId: true, channelId: true },
    });
    const [threads, formFields, channelNames] = await Promise.all([
      threadSenders(ids(tickets.map((t) => t.conversationId))),
      ticketFormFields(tickets.map((t) => t.id)),
      resolvedChannelNames(ids(tickets.map((t) => t.channelId))),
    ]);
    return new Map(tickets.map((t) => [t.id, {
      title: t.title,
      description: t.description,
      xyneId: t.xyneId,
      assignedTo: t.assignedTo || '',
      threadSenders: (t.conversationId && threads.get(t.conversationId)) || [],
      formFields: formFields.get(t.id) ?? [],
      ...(t.channelId && channelNames.has(t.channelId) ? { channelName: channelNames.get(t.channelId) } : {}),
    }]));
  },

  // The file schema holds several sources, told apart by subApp (fetchDataBySchema, mapper.ts:1672).
  file: async (hits) => {
    const bySubApp = (app: string) => ids(hits.filter((h) => h.subApp === app).map((h) => h.docId));
    const out = new Map<string, DisplayFields>();

    const attachmentIds = [...bySubApp(SubApp.CHAT_ATTACHMENT), ...bySubApp(SubApp.TICKET_ATTACHMENT)];
    const canvasIds = bySubApp(SubApp.CANVAS), transcriptIds = bySubApp(SubApp.TRANSCRIPT);
    const rcaIds = bySubApp(SubApp.RCA), collectionFileIds = bySubApp(SubApp.COLLECTIONS);

    const [attachments, canvases, calls, rcas, items] = await Promise.all([
      attachmentIds.length ? db.messageAttachment.findMany({ where: { id: { in: attachmentIds } }, select: { id: true, originalFilename: true, url: true, conversationId: true } }) : [],
      canvasIds.length ? db.canvas.findMany({ where: { id: { in: canvasIds } }, select: { id: true, title: true, channelId: true } }) : [],
      transcriptIds.length ? db.call.findMany({ where: { id: { in: transcriptIds } }, select: { id: true, title: true, aiSummary: true, transcript: true } }) : [],
      rcaIds.length ? db.rCA.findMany({ where: { id: { in: rcaIds } }, select: { id: true, ticketId: true, summary: true } }) : [],
      collectionFileIds.length ? db.collectionItem.findMany({ where: { fileId: { in: collectionFileIds }, isLatest: true }, select: { id: true, fileId: true, name: true } }) : [],
    ]);

    // mapFile (mapper.ts:1270): the channel is the conversation's, its raw name.
    const conversations = attachments.length
      ? await db.conversation.findMany({ where: { conversationId: { in: ids(attachments.map((a) => a.conversationId)) } }, select: { conversationId: true, channelId: true } })
      : [];
    const channelOfConversation = new Map(conversations.map((c) => [c.conversationId, c.channelId]));
    const [channelNames, rcaTickets, collectionAttachments] = await Promise.all([
      rawChannelNames(ids([...conversations.map((c) => c.channelId), ...canvases.map((c) => c.channelId)])),
      rcas.length ? db.ticket.findMany({ where: { id: { in: ids(rcas.map((r) => r.ticketId)) } }, select: { id: true, title: true } }) : [],
      items.length ? db.messageAttachment.findMany({ where: { entityId: { in: items.map((i) => i.id) }, entityType: AttachmentEntityType.COLLECTION }, select: { entityId: true, url: true } }) : [],
    ]);

    for (const a of attachments) {
      const channelId = a.conversationId ? channelOfConversation.get(a.conversationId) : undefined;
      out.set(a.id, {
        fileName: a.originalFilename || 'Untitled File',
        description: `File uploaded in ${(channelId && channelNames.get(channelId)) || 'Unknown Channel'}`,
        urlInternal: a.url,
        urlOriginal: a.url,
      });
    }
    for (const c of canvases) {   // mapCanvas (mapper.ts:937)
      out.set(c.id, {
        fileName: c.title || 'Untitled Canvas',
        description: `Canvas document in ${(c.channelId && channelNames.get(c.channelId)) || 'Unknown Channel'}`,
        urlInternal: '', urlOriginal: '',
      });
    }
    for (const c of calls) {      // mapTranscript (mapper.ts:1017)
      out.set(c.id, { fileName: c.title || 'Transcript', description: c.aiSummary || '', urlInternal: c.transcript || '', urlOriginal: c.transcript || '' });
    }
    const ticketTitle = new Map(rcaTickets.map((t) => [t.id, t.title]));
    for (const r of rcas) {       // mapRCA (mapper.ts:1208); getRCAById adds the ticket's title
      const name = ticketTitle.get(r.ticketId) || r.ticketId;
      out.set(r.id, {
        fileName: `RCA-${name}`,
        description: r.summary || `Root Cause Analysis for ticket ${name}`,
        urlInternal: `/rca/${r.id}`, urlOriginal: `/rca/${r.id}`,
      });
    }
    const urlOfItem = new Map<string, string>();
    for (const a of collectionAttachments) if (!urlOfItem.has(a.entityId)) urlOfItem.set(a.entityId, a.url);
    for (const i of items) {      // mapCollection (mapper.ts:749): the doc id is the item's fileId
      if (out.has(i.fileId)) continue;   // a file with two isLatest items: the first one, as the mapper's findFirst
      out.set(i.fileId, { fileName: i.name, description: '', urlInternal: urlOfItem.get(i.id) || '', urlOriginal: '' });
    }
    return out;
  },

  // mapEmail (mapper.ts:1464). The ticket is the first one on the email's conversation. channelName is imported.
  mail: async (hits) => {
    const emails = await db.email.findMany({
      where: { id: { in: ids(hits.map((h) => h.docId)) } },
      select: { id: true, subject: true, from: true, to: true, conversationId: true },
    });
    const tickets = await db.ticket.findMany({
      where: { conversationId: { in: ids(emails.map((e) => e.conversationId)) } },
      select: { id: true, conversationId: true, xyneId: true },
    });
    const ticketOf = new Map<string, (typeof tickets)[number]>();
    for (const t of tickets) if (t.conversationId && !ticketOf.has(t.conversationId)) ticketOf.set(t.conversationId, t);
    const formFields = await ticketFormFields([...ticketOf.values()].map((t) => t.id));
    return new Map(emails.map((e) => {
      const ticket = e.conversationId ? ticketOf.get(e.conversationId) : undefined;
      const fields = (ticket && formFields.get(ticket.id)) || [];
      return [e.id, {
        subject: e.subject,
        from: e.from,
        to: e.to,
        ...(ticket?.xyneId != null ? { xyneId: ticket.xyneId } : {}),
        ticketFormFields: fields,
        ticketFormFieldValues: Array.from(new Set(fields.map((f) => f.fieldValue))),
      }];
    }));
  },

  // transformUserToVespa (services/vespaTransformers.ts:429)
  user: async (hits) => {
    const users = await db.user.findMany({ where: { id: { in: ids(hits.map((h) => h.docId)) } }, select: { id: true, name: true, email: true } });
    return new Map(users.map((u) => [u.id, { name: u.name || '', email: u.email || '' }]));
  },

  // mapApp (mapper.ts:571)
  app: async (hits) => {
    const apps = await db.apps.findMany({
      where: { id: { in: ids(hits.map((h) => h.docId)) } },
      select: { id: true, name: true, description: true, createdBy: true, orgId: true },
    });
    const [creators, orgs] = await Promise.all([
      db.user.findMany({ where: { id: { in: ids(apps.map((a) => a.createdBy)) } }, select: { id: true, name: true, email: true } }),
      db.organization.findMany({ where: { orgId: { in: ids(apps.map((a) => a.orgId)) } }, select: { orgId: true, name: true } }),
    ]);
    const creator = new Map(creators.map((u) => [u.id, u]));
    const orgName = new Map(orgs.map((o) => [o.orgId, o.name]));
    return new Map(apps.map((a) => [a.id, {
      name: a.name,
      description: a.description ?? '',
      creatorName: creator.get(a.createdBy)?.name ?? '',
      creatorEmail: creator.get(a.createdBy)?.email ?? '',
      orgName: orgName.get(a.orgId) ?? '',
    }]));
  },

  // mapCall (mapper.ts:1122). channelName is the raw Channel.name.
  call: async (hits) => {
    const calls = await db.call.findMany({
      where: { id: { in: ids(hits.map((h) => h.docId)) } },
      select: { id: true, title: true, roomLink: true, channelId: true },
    });
    const participants = calls.length
      ? await db.callParticipant.findMany({ where: { callId: { in: calls.map((c) => c.id) } }, select: { callId: true, userId: true, displayName: true, isExternal: true } })
      : [];
    const [users, channelNames] = await Promise.all([
      db.user.findMany({ where: { id: { in: ids(participants.filter((p) => !p.isExternal).map((p) => p.userId)) } }, select: { id: true, name: true, email: true } }),
      rawChannelNames(ids(calls.map((c) => c.channelId))),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    return new Map(calls.map((c) => {
      const mine = participants.filter((p) => p.callId === c.id);
      const participantNames = mine.map((p) => (p.isExternal ? p.displayName || '' : userById.get(p.userId ?? '')?.name || '').trim());
      const participantEmails = mine.map((p) => (p.isExternal ? '' : (userById.get(p.userId ?? '')?.email || '').trim()));
      const channelName = c.channelId ? channelNames.get(c.channelId) : undefined;
      return [c.id, {
        roomLink: c.roomLink || '',
        title: c.title || '',
        channelName: channelName || '',
        participantNames,
        participantEmails,
        displayTitle: c.title?.trim() || channelName?.trim() || participantNames.filter(Boolean).slice(0, 2).join(', ')
          || participantEmails.filter(Boolean).slice(0, 2).join(', ') || '',
      }];
    }));
  },

  // mapProject (mapper.ts:542)
  project: async (hits) => {
    const projects = await db.project.findMany({ where: { id: { in: ids(hits.map((h) => h.docId)) } }, select: { id: true, name: true, description: true } });
    return new Map(projects.map((p) => [p.id, { name: p.name, description: p.description || '' }]));
  },
};

/** docId -> display fields for the hits of one schema; undefined when the schema has no Postgres source. */
export function displayFieldLoader(schema: string): Loader | undefined {
  return loaders[schema];
}
