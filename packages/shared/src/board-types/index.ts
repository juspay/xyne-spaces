/**
 * Shared type definitions for Xyne Spaces
 */

// Flow-board plan types, schema, and the FlowPlanModel read-model live in
// their own module; re-exported here so `@xyne/shared` consumers are unchanged.
export * from './flow-plan';

import type { BoardEtaManagement } from '../validation/etaManagementSchema';

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
  showNextStageFormInTicketDetails?: boolean;
  fieldOrder?: FieldOrderItem[];
  customFieldsFormId?: string;
  /**
   * Auto-assign one user per configured roleId when a ticket is assigned to a
   * user group. Non-empty → role-driven path (each slot's user has
   * `UserGroupMapping.roleId === slot.roleId`; the slot with `isPrimary: true`
   * also becomes `ticket.assignedTo`). Empty/missing → falls back to the legacy
   * `fullRoleAssignment` 5-enum path (MANAGER/TEAM_LEAD/MEMBER/PR_REVIEWER/QA).
   */
  assignmentRoles?: Array<{ roleId: string; isPrimary: boolean }>;
  /**
   * RoleIds allowed to change a ticket's Assignee, ETA, Stage, or Board on this
   * board. Non-empty → the actor's `UserGroupMapping.roleId` must be in this
   * list (raw roleId membership; works for custom roles). Empty/missing →
   * falls back to the legacy `isAllowedToTransfer` + MANAGER/TEAM_LEAD enum
   * path. A board with neither config is unrestricted. Restriction is opt-in:
   * `ticketControlRoleIds` is only set when a user explicitly adds roleIds via
   * the board config UI; it is never auto-populated.
   */
  ticketControlRoleIds?: string[];
  /**
   * RoleIds used by the bitbucket/github PR-webhook flow to auto-assign a user
   * to the linked ticket when a PR event fires. Each event picks one user whose
   * `UserGroupMapping.roleId === <roleId>`.
   *
   * - `prOpenedRoleId`: fires on PR CREATED or UPDATED (PR-opened/updated event).
   * - `prMergedRoleId`: fires on PR MERGED.
   *
   * Missing/empty → falls back to the legacy enum path
   * (`evaluateAssignmentRule(PR_REVIEWER/QA)` which reads `mapping.responsibility`).
   */
  bitbucketEventRoles?: {
    prOpenedRoleId?: string;
    prMergedRoleId?: string;
  };
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
  /**
   * Per-custom-field visibility in the create ticket modal, keyed by field id.
   * Absent = treat as visible (backward compat for boards saved before this existed).
   */
  customFieldVisibility?: Record<string, boolean>;
  /**
   * Config + versioning for the ETA risk-detection/auto-recalculation
   * feature (planning risk, Standard Path, automatic due-date extension).
   * Absent = no Standard Path, automation disabled - see
   * `parseBoardEtaManagement` in `validation/etaManagementSchema.ts`, which
   * every reader must go through rather than casting this field directly.
   */
  etaManagement?: BoardEtaManagement;
}
