/**
 * Desk email form fields, filled by XOR in the same request that picks the email's category.
 *
 * With the LLM, one free-text prompt does it all: the desk prompt names the ticket's form fields
 * ("Order ID", "Tone", ...) and the LLM writes them into its JSON next to the category. XOR does
 * not write JSON from a prompt; it answers typed questions. So when XOR classifies a desk email,
 * the fields the desk prompt names become XOR questions (steps 1-3), go out with the category
 * question and the email's screenshots, and XOR's answers become field values (step 4).
 */

import { AttachmentEntityType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import type { DecisionAnswer, DecisionQuestion } from '@/services/decision/types';
import { askField, fieldQuestions, readFieldAnswers, type AskedField } from '@/services/formFieldQuestions';
import { convertToBase64 } from '@/utils/attachmentBase64';
import {
  resolveBoardTicketFormId,
  resolveFormFieldDefinitionsForForm,
  type ResolvedFormFieldDefinition,
} from '@/utils/fieldDefinition';

/** The image types XOR reads. */
export const IMAGE_MIMETYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGES = 3;

/** What the category request carries to also fill the form. */
export interface EmailFormFields {
  /** Question id (f0, f1, ...) → the field it asks about. */
  fields: Map<string, AskedField>;
  /** The email's screenshots, as base64 data URLs. */
  images: string[];
}

// ─── Step 1: which fields to ask ─────────────────────────────────────────────────────────────

/**
 * The desk board's ticket-form fields that the desk prompt names. A field the prompt does not
 * name is one the desk never asked the AI to fill (an automation's, say), so it is not asked.
 */
async function fieldsTheDeskPromptNames(
  boardId: string,
  deskPrompt: string,
  skipFieldNames: (string | null | undefined)[],
): Promise<ResolvedFormFieldDefinition[]> {
  const db = DatabaseClient.getInstance();
  const formId = await resolveBoardTicketFormId(db, boardId);
  if (!formId) return [];
  const prompt = deskPrompt.toLowerCase();
  const skip = new Set(skipFieldNames.flatMap(name => name?.trim() || []));
  const fields = await resolveFormFieldDefinitionsForForm(db, formId);
  return fields.filter(field => !skip.has(field.fieldName) && prompt.includes(field.fieldName.trim().toLowerCase()));
}

// ─── Step 2: the email's screenshots ─────────────────────────────────────────────────────────

/** The email's first image attachments, as base64 data URLs. */
async function emailScreenshots(emailId: string): Promise<string[]> {
  const attachments = await DatabaseClient.getInstance().messageAttachment.findMany({
    where: { entityId: emailId, entityType: AttachmentEntityType.EMAIL, isDeleted: false, mimetype: { in: IMAGE_MIMETYPES } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    take: MAX_IMAGES,
  });
  const converted = await Promise.all(attachments.map(attachment => convertToBase64(attachment)));
  return converted.flatMap(image => (image?.dataUri ? [image.dataUri] : []));
}

// ─── Step 3: a field → an XOR question (formFieldQuestions.askField) ─────────────────────────

/** How the desk prompt describes the field: its first line naming it, sent with the question. */
function deskHint(deskPrompt: string, fieldName: string): string {
  const name = fieldName.trim().toLowerCase();
  const line = deskPrompt.split('\n').find(l => l.toLowerCase().includes(name))?.trim();
  return line ? ` The desk describes it as: ${line}` : '';
}

/**
 * Steps 1-3: the questions for the fields the desk prompt names, and the email's screenshots.
 * Null when the desk has no board form, or its prompt names none of the form's fields.
 */
export async function prepareEmailFormFields({
  boardId,
  deskPrompt,
  skipFieldNames,
  emailId,
}: {
  boardId: string | null;
  deskPrompt: string;
  skipFieldNames: (string | null | undefined)[];
  emailId?: string;
}): Promise<EmailFormFields | null> {
  if (!boardId || !deskPrompt.trim()) return null;
  const fields = new Map<string, AskedField>();
  for (const field of await fieldsTheDeskPromptNames(boardId, deskPrompt, skipFieldNames)) {
    const asked = askField(field, deskHint(deskPrompt, field.fieldName));
    if (asked) fields.set(`f${fields.size}`, asked);
  }
  if (fields.size === 0) return null;
  return { fields, images: emailId ? await emailScreenshots(emailId) : [] };
}

/** The field questions, keyed f0, f1, ..., to send next to the category question. */
export const formFieldQuestions = ({ fields }: EmailFormFields): Record<string, DecisionQuestion> => fieldQuestions(fields);

// ─── Step 4: XOR's answers → field values ────────────────────────────────────────────────────

/** XOR's values keyed by field name, as the LLM's JSON keys them (see formFieldQuestions.readFieldAnswers). */
export const readFormFieldAnswers = ({ fields }: EmailFormFields, answers: Record<string, DecisionAnswer>): Record<string, string> =>
  Object.fromEntries(readFieldAnswers(fields, answers).map(({ field, value }) => [field.fieldName, value]));
