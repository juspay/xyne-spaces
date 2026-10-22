/**
 * Ticket form fields as XOR questions, and XOR's answers as field values. Shared by every
 * feature that has XOR fill a form: desk email fields (emailFormFields) and stage forms
 * (stageFormSuggestions).
 */

import { FormFieldType } from '@xyne/shared';
import type { DecisionAnswer, DecisionQuestion } from '@/services/decision/types';
import type { ResolvedFormFieldDefinition } from '@/utils/fieldDefinition';
import { parseGlobalFieldEnum } from '@/utils/globalFieldEnum';

/** Added to every dropdown question so XOR is not forced to pick; never written to a field. */
const NONE_OPTION = 'none';

/** One form field as asked: its question, and for a dropdown, option id → the label to write. */
export interface AskedField {
  fieldId: string;
  fieldName: string;
  question: DecisionQuestion;
  options?: Record<string, string>;
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
 * A field → an XOR question; `hint` is extra text describing the field, sent with it.
 *   text / number / date → `value`: XOR reads the value out of the state or its images.
 *   dropdown              → `choice` over its options, plus "none".
 *   yes/no                → `noul`: the probability that it is true.
 *   user / doc / ticket fields hold references to records text never states: not asked.
 */
export function askField(field: ResolvedFormFieldDefinition, hint = ''): AskedField | null {
  const { id: fieldId, fieldName: name } = field;
  const fromText = `as stated in the text or its attached images.${hint}`;
  switch (field.fieldType) {
    case FormFieldType.STRING:
      return { fieldId, fieldName: name, question: { type: 'value', dtype: 'string', instructions: `The ticket's "${name}", ${fromText}` } };
    case FormFieldType.NUMBER:
      return { fieldId, fieldName: name, question: { type: 'value', dtype: 'float', instructions: `The ticket's "${name}" as a number, ${fromText}` } };
    case FormFieldType.DATE:
      return { fieldId, fieldName: name, question: { type: 'value', dtype: 'string', instructions: `The ticket's "${name}" as a YYYY-MM-DD date, ${fromText}` } };
    case FormFieldType.BOOLEAN:
      return { fieldId, fieldName: name, question: { type: 'noul', instructions: `Is "${name}" true for this ticket?${hint}` } };
    case FormFieldType.SINGLE_SELECT:
    case FormFieldType.MULTI_SELECT: {
      const labels = optionLabels(field.fieldEnum);
      if (labels.length === 0) return null;
      const options = Object.fromEntries(labels.map((label, i) => [`o${i}`, label]));
      return {
        fieldId,
        fieldName: name,
        options,
        question: {
          type: 'choice',
          instructions: `Which "${name}" fits this ticket?${hint}`,
          criteria: { ...options, [NONE_OPTION]: 'None of these, or the text does not say' },
        },
      };
    }
    default:
      return null;
  }
}

/** The questions, keyed by question id (f0, f1, ...), to send to XOR. */
export const fieldQuestions = (fields: Map<string, AskedField>): Record<string, DecisionQuestion> =>
  Object.fromEntries([...fields].map(([id, { question }]) => [id, question]));

/**
 * What XOR answered for each field, as the form stores it:
 *   value  → the value, unless XOR says the text does not hold it;
 *   choice → the option's label, unless XOR picked "none";
 *   noul   → "true" or "false".
 * Fields XOR gave no value for are left out.
 */
export function readFieldAnswers(
  fields: Map<string, AskedField>,
  answers: Record<string, DecisionAnswer>,
): { field: AskedField; value: string }[] {
  const values: { field: AskedField; value: string }[] = [];
  for (const [id, field] of fields) {
    const answer = answers[id];
    if (answer?.type === 'value' && answer.value !== null) values.push({ field, value: String(answer.value) });
    if (answer?.type === 'choice' && field.options?.[answer.choice]) values.push({ field, value: field.options[answer.choice] });
    if (answer?.type === 'noul') values.push({ field, value: String(answer.noul >= 0.5) });
  }
  return values;
}
