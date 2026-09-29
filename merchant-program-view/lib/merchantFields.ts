import type { Ticket } from './types';

/**
 * Merchant IDs live in `Ticket.merchantId` and in custom form fields named
 * "Merchant Id" / "Merchant ID" / "MID". Values are MID strings, possibly comma-separated.
 */

const MERCHANT_FIELD_NAME = /^\s*(merchant\s*_?\s*id|mid)\s*$/i;
const PLACEHOLDERS = new Set(['na', 'n/a', 'all', 'none', 'null', 'nil', '-', 'sbx mid', 'tbd', 'any', 'multiple', 'various', 'all merchants', 'for all merchants']);

export function isMerchantFieldName(name: string | null | undefined): boolean {
  return MERCHANT_FIELD_NAME.test(name ?? '');
}

/** Split a stored value into MIDs: comma lists, trimmed, deduped; placeholders and prose (3+ words) dropped. */
export function parseMids(raw: unknown): string[] {
  if (Array.isArray(raw)) return [...new Set(raw.flatMap(parseMids))];
  if (typeof raw === 'number') return [String(raw)];
  if (typeof raw !== 'string') return [];
  const mids = raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '' && !PLACEHOLDERS.has(s.toLowerCase()) && s.split(/\s+/).length < 3);
  return [...new Set(mids)];
}

interface FieldValueLike {
  fieldId: string;
  fieldValue?: unknown;
  actualFieldValue?: unknown;
}

/** A ticket as returned with `formEntityValueFieldIds`: the values ride along at runtime. */
export type TicketWithFields = Ticket & { formEntityValues?: FieldValueLike[] };

/** Every MID on a ticket: the column plus each merchant custom field. */
export function resolveMids(t: TicketWithFields, merchantFieldIds: ReadonlySet<string>): string[] {
  const custom = (t.formEntityValues ?? [])
    .filter(v => merchantFieldIds.has(v.fieldId))
    .flatMap(v => [...parseMids(v.actualFieldValue), ...parseMids(v.fieldValue)]);
  return [...new Set([...parseMids(t.merchantId), ...custom])];
}

interface FieldLike {
  id: string;
  globalFieldId?: string | null;
  fieldName?: string | null;
  globalField?: { fieldName?: string | null; projectId?: string | null } | null;
}

export interface FormLike {
  id: string;
  formFields?: FieldLike[];
  formContextMappings?: { contextId: string; contextType: string }[];
}

export interface MerchantFields {
  /** Field ids as stored on values: the global field id for shared fields, else the form field id. */
  fieldIds: string[];
  /** Projects whose tickets can carry these fields. */
  projectIds: string[];
}

/** From `forms.list()`: the merchant fields, and the projects that can carry them. */
export function discoverMerchantFields(forms: FormLike[], boardProject: ReadonlyMap<string, string>): MerchantFields {
  const fieldIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const form of forms) {
    const matches = (form.formFields ?? []).filter(f => isMerchantFieldName(f.fieldName ?? f.globalField?.fieldName));
    if (matches.length === 0) continue;
    for (const f of matches) {
      fieldIds.add(f.globalFieldId ?? f.id);
      if (f.globalField?.projectId) projectIds.add(f.globalField.projectId);
    }
    for (const m of form.formContextMappings ?? []) {
      const project = m.contextType === 'BOARD' ? boardProject.get(m.contextId) : undefined;
      if (project) projectIds.add(project);
    }
  }
  return { fieldIds: [...fieldIds], projectIds: [...projectIds] };
}
