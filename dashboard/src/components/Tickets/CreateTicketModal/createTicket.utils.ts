import { TicketPriority, TicketStatusV2 } from '@xyne/shared';
import { getPriorityIcon } from '../TicketCard/TicketCard.utils';
import { CreateTicketFormData } from './CreateTicketModal';
import {
  CREATE_TICKET_FIELD_PARAM_KEYS,
  CREATE_TICKET_PARAM_KEYS,
  CREATE_TICKET_URL_FLAG,
} from './constants';
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
  showTicketType: boolean;
  mandatoryUserGroupsOnly: boolean;
  mandatoryAssignee: boolean;
  mandatoryTodo: boolean;
  mandatoryDueDate: boolean;
  mandatoryWorkflows: boolean;
  mandatoryLabels: boolean;
  mandatoryMerchantId: boolean;
  mandatoryTicketType: boolean;
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
    showTicketType,
    mandatoryUserGroupsOnly,
    mandatoryAssignee,
    mandatoryTodo,
    mandatoryDueDate,
    mandatoryWorkflows,
    mandatoryLabels,
    mandatoryMerchantId,
    mandatoryTicketType,
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
  if (showTicketType && mandatoryTicketType && !formValues?.ticketType)
    return 'Ticket Type is required';

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

export interface CreateTicketUrlPrefill {
  priority?: TicketPriority | null;
  status?: TicketStatusV2;
  boardId?: string;
  assignee?: { type: 'assigneeTo' | 'userGroup'; value: string } | null;
  eta?: Date | null;
  tags?: string[];
  workflowType?: string;
}

export function hasCreateTicketFlag(params: URLSearchParams): boolean {
  return params.get(CREATE_TICKET_URL_FLAG) === '1';
}

export function readCreateTicketPrefillFromUrl(params: URLSearchParams): CreateTicketUrlPrefill {
  const prefill: CreateTicketUrlPrefill = {};

  const priority = params.get(CREATE_TICKET_PARAM_KEYS.priority);
  if (priority && Object.values(TicketPriority).includes(priority as TicketPriority)) {
    prefill.priority = priority as TicketPriority;
  }

  const status = params.get(CREATE_TICKET_PARAM_KEYS.status);
  if (status && Object.values(TicketStatusV2).includes(status as TicketStatusV2)) {
    prefill.status = status as TicketStatusV2;
  }

  const boardId = params.get(CREATE_TICKET_PARAM_KEYS.boardId);
  if (boardId) prefill.boardId = boardId;

  const assignee = params.get(CREATE_TICKET_PARAM_KEYS.assignee);
  if (assignee) {
    const sep = assignee.indexOf(':');
    const type = sep >= 0 ? assignee.slice(0, sep) : '';
    const value = sep >= 0 ? assignee.slice(sep + 1) : '';
    if ((type === 'assigneeTo' || type === 'userGroup') && value) {
      prefill.assignee = { type, value };
    }
  }

  const eta = params.get(CREATE_TICKET_PARAM_KEYS.eta);
  if (eta) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eta);
    if (m) {
      const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!isNaN(date.getTime())) prefill.eta = date;
    }
  }

  const tags = params.getAll(CREATE_TICKET_PARAM_KEYS.tag).filter(Boolean);
  if (tags.length) prefill.tags = tags;

  const workflowType = params.get(CREATE_TICKET_PARAM_KEYS.workflowType);
  if (workflowType) prefill.workflowType = workflowType;

  return prefill;
}

function clearCreateTicketFields(params: URLSearchParams): URLSearchParams {
  CREATE_TICKET_FIELD_PARAM_KEYS.forEach(key => params.delete(key));
  return params;
}

export function clearCreateTicketParams(params: URLSearchParams): URLSearchParams {
  params.delete(CREATE_TICKET_URL_FLAG);
  return clearCreateTicketFields(params);
}

export function writeCreateTicketFields(
  params: URLSearchParams,
  prefill: CreateTicketUrlPrefill,
): URLSearchParams {
  clearCreateTicketFields(params);

  if (prefill.priority) params.set(CREATE_TICKET_PARAM_KEYS.priority, prefill.priority);
  if (prefill.status && prefill.status !== TicketStatusV2.TODO) {
    params.set(CREATE_TICKET_PARAM_KEYS.status, prefill.status);
  }
  if (prefill.boardId) params.set(CREATE_TICKET_PARAM_KEYS.boardId, prefill.boardId);
  if (prefill.assignee?.value) {
    params.set(
      CREATE_TICKET_PARAM_KEYS.assignee,
      `${prefill.assignee.type}:${prefill.assignee.value}`,
    );
  }
  if (prefill.eta) {
    const d = prefill.eta;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    params.set(CREATE_TICKET_PARAM_KEYS.eta, dateStr);
  }
  if (prefill.tags?.length) {
    prefill.tags.filter(Boolean).forEach(tag => params.append(CREATE_TICKET_PARAM_KEYS.tag, tag));
  }
  if (prefill.workflowType) {
    params.set(CREATE_TICKET_PARAM_KEYS.workflowType, prefill.workflowType);
  }

  return params;
}

export function buildCreateTicketShareLink(
  currentParams: URLSearchParams,
  prefill: CreateTicketUrlPrefill,
): string {
  const params = new URLSearchParams(currentParams);
  clearCreateTicketParams(params);
  params.set(CREATE_TICKET_URL_FLAG, '1');
  writeCreateTicketFields(params, prefill);
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}
