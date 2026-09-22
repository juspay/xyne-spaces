import { PRStatusEvent, TicketStatusV2, FormFieldType } from '@xyne/shared';
import type {
  WhenFieldOption,
  ThenFieldOption,
  ConditionOption,
  ThenConditionOption,
  SelectOption,
  FieldTypeOption,
} from './stageConfigUtils.types';

// ─── Options Configuration ─────────────────────────────────────────────────
export const WHEN_FIELD_OPTIONS: WhenFieldOption[] = [
  { value: '', label: 'Choose field' },
  { value: 'status', label: 'Status' },
  { value: 'pr_status', label: 'PR Status' },
  { value: 'release_status', label: 'Release Status' },
  { value: 'form', label: 'Form' },
];

export const WHEN_CONDITION_OPTIONS: ConditionOption[] = [
  { value: '', label: 'Choose condition', whenField: 'status' },
  { value: 'is', label: 'Is', whenField: 'pr_status' },
  { value: 'is', label: 'Is', whenField: 'release_status' },
  { value: 'in', label: 'In', whenField: 'form' },
  { value: 'changes_to', label: 'Changes to', whenField: 'status' },
];

export const THEN_FIELD_OPTIONS: ThenFieldOption[] = [
  { value: '', label: 'Choose field', whenField: 'status' },
  { value: 'form', label: 'Form', whenField: 'status' },
  { value: 'approver', label: 'Approver', whenField: 'status' },
  { value: 'approver', label: 'Approver', whenField: 'form' },
  { value: 'status', label: 'Status', whenField: 'pr_status' },
  { value: 'status', label: 'Status', whenField: 'release_status' },
];

export const THEN_CONDITION_OPTIONS: ThenConditionOption[] = [
  { value: '', label: 'Choose condition', thenField: 'form' },
  { value: 'set_to', label: 'Set to', thenField: 'status' },
  { value: 'is_triggered', label: 'Is Triggered', thenField: 'form' },
  { value: 'is_needed', label: 'Is Needed', thenField: 'approver' },
];

export const PR_STATUS_OPTIONS: SelectOption[] = [
  { value: '', label: 'Choose value' },
  { value: PRStatusEvent.CREATED, label: 'Created' },
  { value: PRStatusEvent.UPDATED, label: 'Updated' },
  { value: PRStatusEvent.MERGED, label: 'Merged' },
  { value: PRStatusEvent.DECLINED, label: 'Declined' },
  { value: PRStatusEvent.DELETED, label: 'Deleted' },
];

// The release ticket's canonical statuses — every board stage collapses onto
// these five, so they are the trigger vocabulary for release-driven moves.
export const RELEASE_STATUS_OPTIONS: SelectOption[] = [
  { value: '', label: 'Choose value' },
  { value: TicketStatusV2.STARTED, label: 'Started (deploying)' },
  { value: TicketStatusV2.COMPLETED, label: 'Completed (live)' },
  { value: TicketStatusV2.CANCELLED, label: 'Cancelled' },
  { value: TicketStatusV2.PAUSED, label: 'Paused (on hold)' },
  { value: TicketStatusV2.TODO, label: 'To Do (planning)' },
];

export const FIELD_TYPE_OPTIONS: FieldTypeOption[] = [
  { value: FormFieldType.STRING, label: 'Text' },
  { value: FormFieldType.SINGLE_SELECT, label: 'Single Select' },
  { value: FormFieldType.MULTI_SELECT, label: 'Multi Select' },
  { value: FormFieldType.NUMBER, label: 'Number' },
  { value: FormFieldType.DATE, label: 'Date' },
  { value: FormFieldType.BOOLEAN, label: 'Boolean' },
  { value: FormFieldType.DOC, label: 'Document' },
  { value: FormFieldType.TICKET, label: 'Ticket' },
];

// ─── Helper Functions ───────────────────────────────────────────────────────
