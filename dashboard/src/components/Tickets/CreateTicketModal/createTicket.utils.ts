import { TicketPriority } from '@xyne/shared';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { CreateTicketFormData } from './CreateTicketModal';
export const TAG_COLORS = [
  'bg-cyan-600',
  'bg-yellow-600',
  'bg-purple-600',
  'bg-green-600',
  'bg-pink-600',
  'bg-blue-600',
];

export const getPriorityOptions = () => [
  { label: 'Low', value: 'LOW', icon: getPriorityIcon(TicketPriority.LOW) },
  { label: 'Medium', value: 'MEDIUM', icon: getPriorityIcon(TicketPriority.MEDIUM) },
  { label: 'High', value: 'HIGH', icon: getPriorityIcon(TicketPriority.HIGH) },
  { label: 'Critical', value: 'CRITICAL', icon: getPriorityIcon(TicketPriority.CRITICAL) },
];

// Parse assignee with type
export const parseAssignee = (value: string | null): CreateTicketFormData['assignee'] => {
  if (!value) return null;
  const [type, id] = value.split(':');
  if (!id) return null;
  return type === 'user' ? { type: 'assigneeTo', value: id } : { type: 'userGroup', value: id };
};

// Get source id

interface MissingMandatoryFieldInput {
  formValues: CreateTicketFormData;
  boards: ReadonlyArray<{ id: string }> | undefined;
  formMapping:
    | { formFields?: ReadonlyArray<{ fieldName: string; isOptional?: boolean | null }> }
    | null
    | undefined;
  showUserGroupsOnly: boolean;
  showAssignee: boolean;
  showTodo: boolean;
  showDueDate: boolean;
  showWorkflows: boolean;
  showLabels: boolean;
  showMerchantId: boolean;
  mandatoryUserGroupsOnly: boolean;
  mandatoryAssignee: boolean;
  mandatoryTodo: boolean;
  mandatoryDueDate: boolean;
  mandatoryWorkflows: boolean;
  mandatoryLabels: boolean;
  mandatoryMerchantId: boolean;
}

// Returns the tooltip message for the first missing mandatory field on the
// create-ticket form, or null when every required field has a value.
export function getMissingMandatoryFieldMessage(input: MissingMandatoryFieldInput): string | null {
  const {
    formValues,
    boards,
    formMapping,
    showUserGroupsOnly,
    showAssignee,
    showTodo,
    showDueDate,
    showWorkflows,
    showLabels,
    showMerchantId,
    mandatoryUserGroupsOnly,
    mandatoryAssignee,
    mandatoryTodo,
    mandatoryDueDate,
    mandatoryWorkflows,
    mandatoryLabels,
    mandatoryMerchantId,
  } = input;

  if (!formValues?.boardId?.trim()) return 'Select a board first';
  if (boards && !boards.some(b => b.id === formValues.boardId)) return 'Select a board first';
  if (!formValues?.title?.trim()) return 'Title is required';
  if (!formValues?.description?.trim()) return 'Description is required';
  if (showUserGroupsOnly && mandatoryUserGroupsOnly && !formValues?.assignee?.value)
    return 'User Group is required';
  if (!showUserGroupsOnly && showAssignee && mandatoryAssignee && !formValues?.assignee?.value)
    return 'Assignee is required';
  if (showTodo && mandatoryTodo && !formValues?.status) return 'Status is required';
  if (showDueDate && mandatoryDueDate && !formValues?.eta) return 'Due Date is required';
  if (showWorkflows && mandatoryWorkflows && !formValues?.workflowType)
    return 'Workflow is required';
  if (showLabels && mandatoryLabels && (!formValues?.tags || formValues.tags.length === 0))
    return 'Labels are required';
  if (showMerchantId && mandatoryMerchantId && !formValues?.merchantId?.trim())
    return 'Merchant ID is required';

  if (formMapping?.formFields && formMapping.formFields.length > 0) {
    const missing = formMapping.formFields.find(field => {
      if (field.isOptional === true) return false;
      const value = formValues?.dynamicFields?.[field.fieldName];
      return !value || (typeof value === 'string' && !value.trim());
    });
    if (missing) return `${missing.fieldName} is required`;
  }

  return null;
}
