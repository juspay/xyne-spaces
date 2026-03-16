import { type User } from '@xyne/shared';

export interface ApproverSelectorProps {
  selectedApprovers: User[];
  onApproversChange: (approvers: User[]) => void;
}
