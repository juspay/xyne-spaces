import type { Prisma } from '@prisma/client';
import { AttachmentEntityType, FormFieldType, MessageType, TicketStatusV2, isDeskChannelType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import { EmailRepository } from '@/database/repositories/emailRepository';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { storageService } from '@/services/storage';
import { parseTelephonyEmailBodyPayload } from '@/services/ozonetel/telephonyEmailService';
import { extractTranscriptBody, findCallTranscriptAttachment } from '@/services/ozonetel/callTranscript';
import { logger } from '@/utils/logger';
import vespaClient from '@/vespa/client';
import { ticketSchema } from '@/vespa/src/types';
import { stripHtml } from '@/tags/deskEmail';
import { resolveFieldDefinitionsByIds } from '@/utils/fieldDefinition';
import { summarizeTicketThread } from '@/agents/ticket-thread-summary';
import { causeKeyOf } from '@/agents/ticket-thread-summary/summaryText';
import { ticketDuplicateService } from '@/services/ticketDuplicateService';

const prisma = DatabaseClient.getInstance();
const emailRepository = new EmailRepository();
const attachmentRepository = new MessageAttachmentRepository();

// A raw transcript is only used when the call has no summary yet.
const CALL_TRANSCRIPT_LIMIT = 4_000;

async function readCallTranscript(emailId: string): Promise<string | null> {
  try {
    const attachment = findCallTranscriptAttachment(
      await attachmentRepository.findByEntityIdAndType(emailId, AttachmentEntityType.EMAIL),
    );
    if (!attachment) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of await storageService.createReadStream(attachment.url)) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return extractTranscriptBody(Buffer.concat(chunks).toString('utf8')) || null;
  } catch (error) {
    logger.warn('[TicketThreadSummary] Could not read call transcript', {
      emailId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** A call log is stored as its provider's JSON; give the summariser what was said instead. */
async function renderEmailBody(email: { id: string; body: string }): Promise<string> {
  const call = parseTelephonyEmailBodyPayload(email.body);
  if (!call) return stripHtml(email.body);

  const facts = [call.callType, call.status, call.duration].filter(Boolean).join(', ');
  const header = `Phone call${facts ? ` (${facts})` : ''}`;
  const transcription = call.transcription;
  if (transcription?.summary) return `${header}. Call summary:\n${transcription.summary}`;
  if (transcription?.status === 'done') {
    const transcript = await readCallTranscript(email.id);
    if (transcript) return `${header}. Transcript:\n${transcript.slice(0, CALL_TRANSCRIPT_LIMIT)}`;
  }
  return `${header}. No transcript.`;
}

// These hold ids (users, docs, tickets) that mean nothing to the summariser.
const SKIPPED_FIELD_TYPES = new Set<string>([FormFieldType.USER, FormFieldType.DOC, FormFieldType.TICKET]);

const fieldValueText = (value: Prisma.JsonValue): string => {
  if (value === null) return '';
  if (Array.isArray(value)) return value.map(fieldValueText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const option = value as Record<string, Prisma.JsonValue | undefined>;
    const label = option.label ?? option.name ?? option.value;
    return label === undefined ? '' : fieldValueText(label);
  }
  return String(value).trim();
};

/** The ticket's custom form fields as "Name: value" lines — often its category and reason. */
async function buildFormFieldLines(ticketId: string): Promise<string[]> {
  const values = await prisma.formEntityValues.findMany({
    where: { entityId: ticketId, entityType: 'TICKET' },
    select: { fieldId: true, actualFieldValue: true },
  });
  if (values.length === 0) return [];
  const definitions = await resolveFieldDefinitionsByIds(prisma, values.map(value => value.fieldId));
  return values.flatMap(value => {
    const definition = definitions.get(value.fieldId);
    if (!definition || SKIPPED_FIELD_TYPES.has(definition.fieldType)) return [];
    const text = value.actualFieldValue === null ? '' : fieldValueText(value.actualFieldValue);
    return text ? [`${definition.fieldName}: ${text}`] : [];
  });
}

// Recent summaries scanned for cause keys, and how many keys the summariser is shown.
const KNOWN_CAUSE_KEY_SCAN = 300;
const KNOWN_CAUSE_KEY_LIMIT = 40;

/** Cause keys already used on the desk's tickets, most frequent first. */
async function knownCauseKeys(channelId: string): Promise<string[]> {
  const recent = await prisma.ticketSummary.findMany({
    where: { channelId },
    select: { summary: true },
    orderBy: { updatedAt: 'desc' },
    take: KNOWN_CAUSE_KEY_SCAN,
  });
  const counts = new Map<string, number>();
  for (const { summary } of recent) {
    const key = causeKeyOf(summary);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, KNOWN_CAUSE_KEY_LIMIT)
    .map(([key]) => key);
}

/**
 * The team's own discussion on the ticket: chat messages on its conversation, which the
 * desk shows in the thread panel and the customer never sees. Often where the diagnosis
 * and the fix are actually written down.
 */
async function findInternalNotes(conversationId: string): Promise<Array<{ content: string; createdAt: Date }>> {
  const notes = await prisma.message.findMany({
    where: {
      conversationId,
      msgType: MessageType.USER,
      isDeleted: false,
      visibleTo: null,
      content: { not: '' },
    },
    orderBy: { createdAt: 'asc' },
    select: { content: true, createdAt: true },
  });
  return notes.filter(note => stripHtml(note.content).trim() !== '');
}

/**
 * The thread text, and whether support has spoken in it yet (an agent-sent email or an
 * internal note). A cause is only ever stated by support, so a customer-only thread is
 * summarised without the known cause keys: shown them, the summariser copies one in.
 */
async function buildTicketThread(
  ticketId: string,
  conversationId: string,
): Promise<{ thread: string; hasSupportVoice: boolean } | null> {
  const [emails, notes, fieldLines] = await Promise.all([
    emailRepository.findByConversationIdOrdered(conversationId),
    findInternalNotes(conversationId),
    buildFormFieldLines(ticketId),
  ]);
  if (emails.length === 0) return null;
  const hasSupportVoice = notes.length > 0 || emails.some(email => email.sentByUserId !== null);
  const entries = [
    ...emails.map(email => ({
      createdAt: email.createdAt,
      render: async (): Promise<string> =>
        `From: ${email.from}\nDate: ${email.createdAt.toISOString()}\n\n${await renderEmailBody(email)}`,
    })),
    ...notes.map(note => ({
      createdAt: note.createdAt,
      render: async (): Promise<string> =>
        `Internal team note (not sent to the customer)\nDate: ${note.createdAt.toISOString()}\n\n${stripHtml(note.content)}`,
    })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const sections = await Promise.all(entries.map(entry => entry.render()));
  const fields = fieldLines.length > 0 ? `Form fields:\n${fieldLines.map(line => `- ${line}`).join('\n')}\n\n` : '';
  return {
    thread: `Subject: ${emails[0]!.subject}\n\n${fields}${sections.join('\n\n---\n\n')}`,
    hasSupportVoice,
  };
}

/**
 * Summarise a desk ticket's whole email thread, store it, and push it to Vespa. While the
 * ticket is open, each summary also runs related-ticket detection with it as the query:
 * later emails add the detail that makes a match, and a Jev outage on one run costs
 * nothing. Links already made and dismissals are excluded by the detection itself, and its
 * maxLinks caps the total. Backfill passes `detectRelated: false` so historical tickets
 * are summarised, not linked.
 */
export async function refreshTicketThreadSummary(
  ticketId: string,
  { detectRelated = true }: { detectRelated?: boolean } = {},
): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      projectId: true,
      createdBy: true,
      workspaceId: true,
      channelId: true,
      conversationId: true,
      isArchived: true,
      statusV2: true,
      channel: { select: { type: true } },
    },
  });
  if (!ticket || ticket.isArchived || !isDeskChannelType(ticket.channel?.type)) return;

  const built = await buildTicketThread(ticket.id, ticket.conversationId);
  if (!built) return;
  const summary = await summarizeTicketThread(built.thread, {
    userId: ticket.createdBy,
    projectId: ticket.projectId,
    knownCauseKeys: built.hasSupportVoice ? await knownCauseKeys(ticket.channelId) : [],
  });
  if (!summary) return;

  await prisma.ticketSummary.upsert({
    where: { ticketId: ticket.id },
    create: { ticketId: ticket.id, workspaceId: ticket.workspaceId, channelId: ticket.channelId, summary },
    update: { summary },
  });

  try {
    await vespaClient.crudService.update(
      [{ docId: ticket.id, fields: { ticketSummary: summary } }],
      ticketSchema,
    );
  } catch (error) {
    // The next full ticket feed maps the stored summary, so this only delays it.
    logger.warn('[TicketThreadSummary] Vespa update failed', {
      ticketId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (detectRelated && ticket.statusV2 !== TicketStatusV2.COMPLETED) {
    await ticketDuplicateService.detectRelatedTickets(ticket.id, summary);
  }
}
