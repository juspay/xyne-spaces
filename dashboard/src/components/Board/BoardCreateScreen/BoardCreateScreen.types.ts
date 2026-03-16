import type { FormContextType } from '@xyne/shared';

export interface TemplateCard {
  id: string;
  name: string;
  description: string;
  bgColor: string;
  borderColor: string;
  icon?: string;
}

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

export interface CreateBoardData {
  name: string;
  projectId: string;
  boardType: string;
  stages: Array<{
    name: string;
    sequenceNumber: number;
    defaultTicketStatusV2: string;
    eta?: number;
    prStatuses?: string[];
    approverIds?: string[];
  }>;
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
  fieldEnum?: readonly string[];
  isOptional?: boolean;
}

export interface FormMapping {
  id: string;
  formContextMappings?: readonly FormContextMapping[];
  formFields?: readonly FormField[];
}

export interface BoardFromQuery {
  id: string;
  name: string;
  createdBy: string;
  projectId: string;
  stages?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}
