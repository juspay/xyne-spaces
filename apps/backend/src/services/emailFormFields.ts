/**
 * Desk email form fields, filled by XOR in the same request that picks the email's category.
 *
 * With the LLM, one free-text prompt does it all: the desk prompt names the ticket's form fields
 * ("Order ID", "Tone", ...) and the LLM writes them into its JSON next to the category. XOR does
 * not write JSON from a prompt; it answers typed questions. So when XOR classifies a desk email,
 * the fields the desk prompt names become XOR questions (steps 1-3), go out with the category
 * question and the email's screenshots, and XOR's answers become field values (step 4).
 */

import { AttachmentEntityType, FormFieldType } from '@xyne/shared';
import { DatabaseClient } from '@/database/client';
import type { DecisionAnswer, DecisionQuestion } from '@/services/decision/types';
import { convertToBase64 } from '@/utils/attachmentBase64';
import {
  resolveBoardTicketFormId,
  resolveFormFieldDefinitionsForForm,
  type ResolvedFormFieldDefinition,
} from '@/utils/fieldDefinition';
import { parseGlobalFieldEnum } from '@/utils/globalFieldEnum';

/** The image types XOR reads. */
const IMAGE_MIMETYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGES = 3;
/** Added to every dropdown question so XOR is not forced to pick; never written to a field. */
const NONE_OPTION = 'none';

/** One form field as asked: its question, and for a dropdown, option id → the label to write. */
interface AskedField {
  fieldName: string;
  question: DecisionQuestion;
  options?: Record<string, string>;
}

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

// ─── Step 3: a field → an XOR question ───────────────────────────────────────────────────────

/** How the desk prompt describes the field: its first line naming it, sent with the question. */
function deskHint(deskPrompt: string, fieldName: string): string {
  const name = fieldName.trim().toLowerCase();
  const line = deskPrompt.split('\n').find(l => l.toLowerCase().includes(name))?.trim();
  return line ? ` The desk describes it as: ${line}` : '';
}

/** A dropdown's option labels. Options are stored as strings or {id, value}, often JSON-stringified. */
function optionLabels(fieldEnum: unknown): string[] {
  const options = parseGlobalFieldEnum(fieldEnum);
  if (!Array.isArray(options)) return [];
  const labels = options.map((option: unknown) =>
    typeof option === 'string' ? option : String((option as { value?: unknown } | null)?.value ?? ''),
  );
  return [...new Set(labels.map(label => label.trim()).filter(Boolean))];
}

/**
 * text / number / date → `value`: XOR reads the value out of the email or a screenshot.
 * dropdown              → `choice` over its options, plus "none".
 * yes/no                → `noul`: the probability that it is true.
 * user / doc / ticket fields hold references to records an email never states: not asked.
 */
function askField(field: ResolvedFormFieldDefinition, deskPrompt: string): AskedField | null {
  const name = field.fieldName;
  const hint = deskHint(deskPrompt, name);
  const fromEmail = `as stated in the email or its attached images.${hint}`;
  switch (field.fieldType) {
    case FormFieldType.STRING:
      return { fieldName: name, question: { type: 'value', dtype: 'string', instructions: `The ticket's "${name}", ${fromEmail}` } };
    case FormFieldType.NUMBER:
      return { fieldName: name, question: { type: 'value', dtype: 'float', instructions: `The ticket's "${name}" as a number, ${fromEmail}` } };
    case FormFieldType.DATE:
      return { fieldName: name, question: { type: 'value', dtype: 'string', instructions: `The ticket's "${name}" as a YYYY-MM-DD date, ${fromEmail}` } };
    case FormFieldType.BOOLEAN:
      return { fieldName: name, question: { type: 'noul', instructions: `Is "${name}" true for this ticket?${hint}` } };
    case FormFieldType.SINGLE_SELECT:
    case FormFieldType.MULTI_SELECT: {
      const labels = optionLabels(field.fieldEnum);
      if (labels.length === 0) return null;
      const options = Object.fromEntries(labels.map((label, i) => [`o${i}`, label]));
      return {
        fieldName: name,
        options,
        question: {
          type: 'choice',
          instructions: `Which "${name}" fits this ticket?${hint}`,
          criteria: { ...options, [NONE_OPTION]: 'None of these, or the email does not say' },
        },
      };
    }
    default:
      return null;
  }
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
    const asked = askField(field, deskPrompt);
    if (asked) fields.set(`f${fields.size}`, asked);
  }
  if (fields.size === 0) return null;
  return { fields, images: emailId ? await emailScreenshots(emailId) : [] };
}

/** The field questions, keyed f0, f1, ..., to send next to the category question. */
export const formFieldQuestions = ({ fields }: EmailFormFields): Record<string, DecisionQuestion> =>
  Object.fromEntries([...fields].map(([id, { question }]) => [id, question]));

// ─── Step 4: XOR's answers → field values ────────────────────────────────────────────────────

/**
 * What XOR answered for each field, as the form stores it:
 *   value  → the value, unless XOR says the email does not hold it;
 *   choice → the option's label, unless XOR picked "none";
 *   noul   → "true" or "false".
 */
export function readFormFieldAnswers({ fields }: EmailFormFields, answers: Record<string, DecisionAnswer>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [id, { fieldName, options }] of fields) {
    const answer = answers[id];
    if (answer?.type === 'value' && answer.value !== null) values[fieldName] = String(answer.value);
    if (answer?.type === 'choice' && options?.[answer.choice]) values[fieldName] = options[answer.choice];
    if (answer?.type === 'noul') values[fieldName] = String(answer.noul >= 0.5);
  }
  return values;
}
