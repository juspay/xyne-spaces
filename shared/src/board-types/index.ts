/**
 * Shared type definitions for Xyne Spaces
 */

export interface TicketFormConfig {
  userGroupsOnly?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  assignedTo?:{
    enabled: boolean;
    mandatory?: boolean;
  }
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
  ticketType?: {
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
  /**
   * Controls which SLA mechanism is active for this board.
   *
   * - `'stages'` (default): SLA deadlines are derived from per-stage ETAs
   *   (the existing behaviour — each stage has an `eta` field in hours that is
   *   used to compute `ticket_stage_eta` due dates).
   * - `'priority'`: SLA deadlines are derived from the board's
   *   `board_sla_policies` table rows, keyed by ticket priority.  When a ticket
   *   is created the matching policy is used to compute `eta` / `slaResolutionDue`.
   *
   * The value is stored in the `boards.metadata` JSON column so it requires no
   * schema migration and defaults gracefully to `'stages'` when absent.
   */
  slaPolicyType?: 'stages' | 'priority';
}
