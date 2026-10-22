/**
 * Stage form suggestions: when a ticket moves to a stage that asks for fields, XOR reads the
 * ticket and its thread and suggests values for the stage form. The dashboard puts them into the
 * empty fields; nothing is saved until the agent submits the form.
 *
 * Desk and other tickets alike: every ticket has a conversation, which holds its emails (desk
 * tickets) and its chat messages.
 */

import { DatabaseClient } from '@/database/client';
import { askDecision } from '@/services/decision/ask';
import { isPrivateDecisionEngineConfigured } from '@/services/decision/targets';
import { IMAGE_MIMETYPES } from '@/services/emailFormFields';
import { askField, fieldQuestions, readFieldAnswers, type AskedField } from '@/services/formFieldQuestions';
import { convertToBase64 } from '@/utils/attachmentBase64';
import { resolveFormFieldDefinitionsForForm } from '@/utils/fieldDefinition';

/** The latest emails and messages read; older ones rarely hold what a later stage asks for. */
const MAX_THREAD_ENTRIES = 20;
/** XOR reads the text once per field, so a long thread costs it once per field. */
const MAX_TEXT_CHARS = 20_000;
const MAX_IMAGES = 3;
const XOR_TIMEOUT_MS = 15_000;

interface ThreadEntry {
  at: Date;
  text: string;
}

// ─── Step 1: the ticket and its thread, as text ──────────────────────────────────────────────

/** The conversation's latest emails and chat messages, oldest first. */
async function ticketThread(conversationId: string): Promise<ThreadEntry[]> {
  const db = DatabaseClient.getInstance();
  const [emails, messages] = await Promise.all([
    db.email.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: MAX_THREAD_ENTRIES,
      select: { from: true, subject: true, body: true, createdAt: true },
    }),
    db.message.findMany({
      where: { conversationId, isDeleted: false, content: { not: '' } },
      orderBy: { createdAt: 'desc' },
      take: MAX_THREAD_ENTRIES,
      select: { content: true, createdAt: true, sender: { select: { name: true } } },
    }),
  ]);
  const entries: ThreadEntry[] = [
    ...emails.map(e => ({ at: e.createdAt, text: `[${e.createdAt.toISOString()}] ${e.from}\nSubject: ${e.subject}\n${e.body}` })),
    ...messages.map(m => ({ at: m.createdAt, text: `[${m.createdAt.toISOString()}] ${m.sender.name}\n${m.content}` })),
  ];
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(-MAX_THREAD_ENTRIES);
}

/** The ticket, then its thread; when too long, the latest part is kept. */
function ticketText(ticket: { title: string; description: string }, thread: ThreadEntry[]): string {
  const text = [`Ticket: ${ticket.title}`, ticket.description, '', 'Thread (oldest first):', ...thread.map(e => e.text)].join('\n');
  return text.length > MAX_TEXT_CHARS ? `[…earlier cut]\n${text.slice(-MAX_TEXT_CHARS)}` : text;
}

// ─── Step 2: the thread's screenshots ────────────────────────────────────────────────────────

/** The latest image attachments in the conversation, emails and messages alike. */
async function threadImages(conversationId: string): Promise<string[]> {
  const attachments = await DatabaseClient.getInstance().messageAttachment.findMany({
    where: { conversationId, isDeleted: false, mimetype: { in: IMAGE_MIMETYPES } },
    orderBy: { createdAt: 'desc' },
    take: MAX_IMAGES,
  });
  const converted = await Promise.all(attachments.map(attachment => convertToBase64(attachment)));
  return converted.flatMap(image => (image?.dataUri ? [image.dataUri] : []));
}

// ─── Step 3: ask XOR, return the suggestions ─────────────────────────────────────────────────

/**
 * Suggested values for the stage form `formId`, read from the ticket and its thread: field id →
 * value, in the shape the stage form keeps (a list). Empty when XOR is not the deployer's own,
 * the form has no askable field, or XOR gave no answer.
 */
export async function suggestStageFormFields(
  ticket: { id: string; workspaceId: string },
  formId: string,
  signal?: AbortSignal,
): Promise<Record<string, string[]>> {
  if (!isPrivateDecisionEngineConfigured()) return {};
  const db = DatabaseClient.getInstance();

  const form = await db.form.findUnique({ where: { id: formId }, select: { workspaceId: true } });
  if (form?.workspaceId !== ticket.workspaceId) return {};
  const asked = new Map<string, AskedField>();
  for (const field of await resolveFormFieldDefinitionsForForm(db, formId)) {
    const question = askField(field);
    if (question) asked.set(`f${asked.size}`, question);
  }
  if (asked.size === 0) return {};

  const details = await db.ticket.findUnique({
    where: { id: ticket.id },
    select: { title: true, description: true, conversationId: true },
  });
  if (!details) return {};
  const [thread, images] = await Promise.all([ticketThread(details.conversationId), threadImages(details.conversationId)]);

  const answers = await askDecision('stage_form_fields', ticketText(details, thread), fieldQuestions(asked), XOR_TIMEOUT_MS, signal, {
    images,
  });
  if (!answers) return {};
  return Object.fromEntries(readFieldAnswers(asked, answers).map(({ field, value }) => [field.fieldId, [value]]));
}
