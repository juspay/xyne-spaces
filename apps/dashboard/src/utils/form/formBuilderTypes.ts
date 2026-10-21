import type { FormContextType, FormEntityType, FormFieldType } from '@xyne/shared';

export interface BuilderFieldOption {
  id: string;
  value: string;
}

export interface BuilderField {
  /** Client uuid — stable React key / dnd id. Never persisted. */
  rowId: string;
  /**
   * Resolved definition id: global_fields.id for global rows, form_fields.id for legacy rows
   * (where it equals membershipId). REST payload `fieldId`; Zero mutator `id`.
   */
  definitionId?: string;
  /** form_fields membership row id. Zero mutator `membershipId`. */
  membershipId?: string;
  fieldName: string;
  fieldType: FormFieldType;
  isOptional: boolean;
  fieldEnum?: BuilderFieldOption[];
  parentOptionId?: string | null;
}

export interface FormBuilderData {
  formName: string;
  formDescription: string;
  fields: BuilderField[];
}

export interface FormBuilderRequestContext {
  contextType: FormContextType;
  entityType: FormEntityType;
  projectId?: string;
}
