import { TicketPriority, TicketStatusV2, isFieldActive } from '@xyne/shared';
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

export interface TicketFormSnapshot {
  title: string;
  description: string;
  priority: string;
  status: string;
  assignee: string;
  eta: number | null;
  tags: string;
  boardId: string;
  channelId: string;
  workflowType: string;
  merchantId: string;
  ticketType: string;
  dynamicFields: string;
}

export const serializeDynamicFields = (
  dynamicFields: CreateTicketFormData['dynamicFields'] | undefined,
): string => {
  const entries = Object.entries(dynamicFields ?? {})
    .map(([key, value]): [string, string[]] => [
      key,
      (Array.isArray(value) ? value : [value]).map(item => (item ?? '').trim()).filter(Boolean),
    ])
    .filter(([, values]) => values.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
};

export const snapshotTicketForm = (values: CreateTicketFormData): TicketFormSnapshot => ({
  title: (values.title ?? '').trim(),
  description: (values.description ?? '').trim(),
  priority: values.priority ?? '',
  status: values.status ?? '',
  assignee: values.assignee?.value ?? '',
  eta: values.eta ? new Date(values.eta).getTime() : null,
  tags: JSON.stringify([...(values.tags ?? [])].sort()),
  boardId: values.boardId ?? '',
  channelId: values.channelId ?? '',
  workflowType: (values.workflowType ?? '').trim(),
  merchantId: (values.merchantId ?? '').trim(),
  ticketType: values.ticketType ?? '',
  dynamicFields: serializeDynamicFields(values.dynamicFields),
});

export const ticketFormSnapshotsEqual = (a: TicketFormSnapshot, b: TicketFormSnapshot): boolean => {
  const keys = Object.keys(a) as Array<keyof TicketFormSnapshot>;
  return keys.every(key => a[key] === b[key]);
};

// Get source id

interface MissingMandatoryFieldInput {
  formValues: CreateTicketFormData;
  boards: ReadonlyArray<{ id: string }> | undefined;
  formMapping:
    | {
        formFields?: ReadonlyArray<{
          id: string;
          fieldName: string;
          isOptional?: boolean | null;
          parentOptionId?: string | null;
          fieldEnum?: unknown;
        }>;
      }
    | null
    | undefined;
  showUserGroupsOnly: boolean;
  showAssignee: boolean;
  showTodo: boolean;
  showDueDate: boolean;
  showLabels: boolean;
  showMerchantId: boolean;
  showTicketType: boolean;
  mandatoryUserGroupsOnly: boolean;
  mandatoryAssignee: boolean;
  mandatoryTodo: boolean;
  mandatoryDueDate: boolean;
  mandatoryLabels: boolean;
  mandatoryMerchantId: boolean;
  mandatoryTicketType: boolean;
  isRelease?: boolean;
  releaseOnly?: boolean;
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
    showLabels,
    showMerchantId,
    showTicketType,
    mandatoryUserGroupsOnly,
    mandatoryAssignee,
    mandatoryTodo,
    mandatoryDueDate,
    mandatoryLabels,
    mandatoryMerchantId,
    mandatoryTicketType,
    isRelease,
    releaseOnly,
  } = input;

  const boardMissingMessage = isRelease ? 'Select at least one repository' : 'Select a board first';
  if (!formValues?.boardId?.trim()) return boardMissingMessage;
  if (boards && !boards.some(b => b.id === formValues.boardId)) return boardMissingMessage;
  if (!formValues?.title?.trim()) return 'Title is required';
  if (!formValues?.description?.trim()) return 'Description is required';
  // releaseOnly hides assignee/userGroups/dueDate/labels, so the gate must skip them
  // (matching handleCreateTicket) or submit stays permanently disabled. Todo/merchantId
  // remain visible, so they stay enforced.
  if (!releaseOnly && showUserGroupsOnly && mandatoryUserGroupsOnly && !formValues?.assignee?.value)
    return 'User Group is required';
  if (
    !releaseOnly &&
    !showUserGroupsOnly &&
    showAssignee &&
    mandatoryAssignee &&
    !formValues?.assignee?.value
  )
    return 'Assignee is required';
  if (showTodo && mandatoryTodo && !formValues?.status) return 'Status is required';
  if (!releaseOnly && showDueDate && mandatoryDueDate && !formValues?.eta)
    return 'Due Date is required';
  if (
    !releaseOnly &&
    showLabels &&
    mandatoryLabels &&
    (!formValues?.tags || formValues.tags.length === 0)
  )
    return 'Labels are required';
  if (showMerchantId && mandatoryMerchantId && !formValues?.merchantId?.trim())
    return 'Merchant ID is required';
  if (showTicketType && mandatoryTicketType && !formValues?.ticketType)
    return 'Ticket Type is required';

  if (formMapping?.formFields && formMapping.formFields.length > 0) {
    const allFields = formMapping.formFields;
    const getFieldEffectiveValue = (fieldId: string): string | undefined => {
      const parentField = allFields.find(f => f.id === fieldId);
      const parentRaw = parentField
        ? formValues?.dynamicFields?.[parentField.fieldName]
        : undefined;
      return typeof parentRaw === 'string' ? parentRaw : undefined;
    };

    const missing = allFields.find(field => {
      if (field.isOptional === true) return false;
      // An inactive branch field was never shown, so it can't block submission.
      if (!isFieldActive(field, allFields, getFieldEffectiveValue)) return false;
      const value = formValues?.dynamicFields?.[field.fieldName];
      return !value || (typeof value === 'string' && !value.trim());
    });
    if (missing) return `${missing.fieldName} is required`;
  }

  return null;
}

// Drops entries left over from a field switched out of its active branch — the backend
// otherwise rejects the whole submission over a value the user can no longer even see.
export function filterActiveDynamicFieldValues(
  allFields: ReadonlyArray<{
    id: string;
    fieldName: string;
    parentOptionId?: string | null;
    fieldEnum?: unknown;
  }>,
  dynamicFields: Record<string, string | string[]>,
): Record<string, string | string[]> {
  const fieldByName = new Map(allFields.map(field => [field.fieldName, field]));
  const getFieldEffectiveValue = (fieldId: string): string | undefined => {
    const parentField = allFields.find(f => f.id === fieldId);
    const parentRaw = parentField ? dynamicFields[parentField.fieldName] : undefined;
    return typeof parentRaw === 'string' ? parentRaw : undefined;
  };

  return Object.fromEntries(
    Object.entries(dynamicFields).filter(([fieldName]) => {
      const field = fieldByName.get(fieldName);
      if (!field) return true; // not a known form field — leave whatever this key is alone
      return isFieldActive(field, allFields, getFieldEffectiveValue);
    }),
  );
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
