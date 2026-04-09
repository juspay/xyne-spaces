/**
 * Shared type definitions for Xyne Spaces
 */

export interface TicketFormConfig {
  userGroupsOnly?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  dueDate?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  todo?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  workflows?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  labels?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  merchantId?: {
    enabled: boolean;
    mandatory?: boolean;
  };
}

export interface FieldOrderItem {
  fieldId: string;
  fieldType: 'core' | 'custom';
}

export interface BoardMetadata {
  ticketFormConfig?: TicketFormConfig;
  isAllowedToTransfer?: boolean;
  fullRoleAssignment?: boolean;
  fieldOrder?: FieldOrderItem[];
  customFieldsFormId?: string;
}
