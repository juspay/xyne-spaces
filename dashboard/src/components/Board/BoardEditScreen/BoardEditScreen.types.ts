import {
  TicketStatusV2,
  type BoardMetadata,
  type FieldOrderItem,
  FormFieldType,
} from '@xyne/shared';

// Re-export types from shared
export type { BoardMetadata, FieldOrderItem };

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Types for Board Edit Screen functionality
 */

// Types for field configuration
export interface TicketField {
  id: string;
  name: string;
  type:
    | 'text'
    | 'select'
    | 'multiselect'
    | 'date'
    | 'user'
    | 'status'
    | 'priority'
    | 'board'
    | 'project'
    | 'boolean'
    | 'workflow';
  label: string;
  required: boolean;
  order: number;
  options?: string[];
  visibleInCreate: boolean;
}

// Helper function to map FormFieldType to TicketField type
export const mapFromFormFieldType = (fieldType: FormFieldType): TicketField['type'] => {
  switch (fieldType) {
    case FormFieldType.STRING:
      return 'text';
    case FormFieldType.SINGLE_SELECT:
      return 'select';
    case FormFieldType.MULTI_SELECT:
      return 'multiselect';
    case FormFieldType.DATE:
      return 'date';
    case FormFieldType.USER:
      return 'user';
    case FormFieldType.BOOLEAN:
      return 'boolean';
    default:
      return 'text';
  }
};

// Helper function to map TicketField type to FormFieldType
export const mapToFormFieldType = (type: TicketField['type']): FormFieldType => {
  switch (type) {
    case 'text':
      return FormFieldType.STRING;
    case 'select':
      return FormFieldType.SINGLE_SELECT;
    case 'multiselect':
      return FormFieldType.MULTI_SELECT;
    case 'date':
      return FormFieldType.DATE;
    case 'user':
      return FormFieldType.USER;
    case 'boolean':
      return FormFieldType.BOOLEAN;
    default:
      return FormFieldType.STRING;
  }
};

export interface Stage {
  id?: string;
  tempId: number;
  name: string;
  eta: number;
  sequenceNumber: number;
  defaultTicketStatusV2: TicketStatusV2;
  prStatuses?: string[];
  approverIds: string[];
  formId?: string | undefined;
}

// Preview mode type
export type PreviewMode = 'create' | 'details';

// Default ticket fields configuration
export const DEFAULT_TICKET_FIELDS: TicketField[] = [
  {
    id: '6',
    name: 'status',
    type: 'status',
    label: 'Status',
    required: false,
    order: 1,
    visibleInCreate: false,
  },
  {
    id: '7',
    name: 'priority',
    type: 'priority',
    label: 'Priority',
    required: false,
    order: 2,
    visibleInCreate: true,
  },
  {
    id: '8',
    name: 'dueDate',
    type: 'date',
    label: 'Due Date',
    required: false,
    order: 3,
    visibleInCreate: true,
  },
  {
    id: '9',
    name: 'assignedTo',
    type: 'user',
    label: 'Assignee',
    required: false,
    order: 4,
    visibleInCreate: true,
  },
  {
    id: '10',
    name: 'workflowType',
    type: 'workflow',
    label: 'Workflow',
    required: false,
    order: 5,
    visibleInCreate: true,
  },
  {
    id: '13',
    name: 'merchantId',
    type: 'text',
    label: 'Merchant ID',
    required: false,
    order: 6,
    visibleInCreate: false,
  },
];

// Constants
export const PRIORITY_OPTIONS: SelectOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export const STATUS_OPTIONS: SelectOption[] = [
  { value: TicketStatusV2.TODO, label: 'To Do' },
  { value: TicketStatusV2.STARTED, label: 'Started' },
  { value: TicketStatusV2.PAUSED, label: 'Paused' },
  { value: TicketStatusV2.COMPLETED, label: 'Completed' },
  { value: TicketStatusV2.CANCELLED, label: 'Cancelled' },
];
