import { TicketStatusV2 } from '@xyne/shared';
import { StageStatusIcon } from '../../../utils/board/stageStatusIcon';
import type { ApproverEntry } from '../ApproverSelector/ApproverSelector.types';

/**
 * Types for Board Stage Configuration Screen
 */

export interface StageCondition {
  id: string;
  name: string;
  whenField: string;
  whenCondition: string;
  whenValue: string;
  thenField: string;
  thenCondition: string;
  thenValue: string;
  approverIds?: string[];
  approvers?: ApproverEntry[];
  // When true (approver conditions only), auto-request approval the moment a
  // ticket enters the PREVIOUS stage, instead of waiting for a manual move.
  requestApprovalOnEntry?: boolean;
}

export interface StageNode {
  id?: string;
  tempId: number;
  name: string;
  eta: number;
  sequenceNumber: number;
  defaultTicketStatusV2: TicketStatusV2;
  prStatuses: string[];
  approvers: ApproverEntry[];
  formId?: string;
  // NULL/undefined treated as false in code; auto-create the approval request
  // when a ticket enters the PREVIOUS stage (linear boards only).
  requestApprovalOnEntry?: boolean;
  conditions: StageCondition[];
  // Visual properties
  position: { x: number; y: number };
}

// Constants
// Status options for the status indicator (used in stage config)
export const STATUS_OPTIONS = [
  {
    status: TicketStatusV2.TODO,
    label: 'To Do',
    icon: <StageStatusIcon status={TicketStatusV2.TODO} />,
  },
  {
    status: TicketStatusV2.STARTED,
    label: 'Started',
    icon: <StageStatusIcon status={TicketStatusV2.STARTED} />,
  },
  {
    status: TicketStatusV2.PAUSED,
    label: 'Paused',
    icon: <StageStatusIcon status={TicketStatusV2.PAUSED} />,
  },
  {
    status: TicketStatusV2.COMPLETED,
    label: 'Completed',
    icon: <StageStatusIcon status={TicketStatusV2.COMPLETED} />,
  },
  {
    status: TicketStatusV2.CANCELLED,
    label: 'Cancelled',
    icon: <StageStatusIcon status={TicketStatusV2.CANCELLED} />,
  },
];

export const getStatusOption = (
  status: TicketStatusV2,
): { status: TicketStatusV2; label: string; icon: React.ReactElement } => {
  return STATUS_OPTIONS.find(opt => opt.status === status) ?? STATUS_OPTIONS[0]!;
};
