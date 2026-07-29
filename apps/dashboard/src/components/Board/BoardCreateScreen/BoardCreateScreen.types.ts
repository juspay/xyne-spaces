import type { FormContextType, FieldEnumOption } from '@xyne/shared';

export interface BoardRow {
  id: string;
  title: string;
  createdBy: string;
  createdByUserId: string;
  automations: number;
  customFields: number;
  projectId: string;
  stages?: number;
  customFieldNames?: string[];
}

export const CreationMode = {
  TEMPLATE: 'template',
  DUPLICATE: 'duplicate',
  NEW: 'new',
} as const;

export type CreationMode = (typeof CreationMode)[keyof typeof CreationMode];

export interface User {
  id: string;
  name: string;
  email?: string;
}

export interface FormContextMapping {
  contextType: FormContextType;
  contextId: string;
}

export interface FormField {
  id: string;
  fieldName: string;
  fieldType: string;
  fieldEnum?: readonly FieldEnumOption[];
  isOptional?: boolean;
}

export interface FormMapping {
  id: string;
  formContextMappings?: readonly FormContextMapping[];
  formFields?: readonly FormField[];
}
