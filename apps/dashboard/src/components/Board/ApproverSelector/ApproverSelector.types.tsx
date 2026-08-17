import type { ApproverType } from '@xyne/shared';

export interface ApproverEntry {
  approverId: string;
  approverType: ApproverType;
}

export interface ApproverSelectorProps {
  selectedApprovers: ApproverEntry[];
  onApproversChange: (approvers: ApproverEntry[]) => void;
}
