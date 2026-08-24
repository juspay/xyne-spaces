import type { DateRangeValue } from '../../../ui/DateRangeFilter/DateRangeFilter';
import type { Automation, AutomationStatus, WorkflowEventType } from '../../Automation.types';
import {
  AutomationStatusValues,
  WorkflowEventType as EventType,
  isLiveStatus,
  isProposalStatus,
} from '../../Automation.types';

export type AutomationDateField = 'createdAt' | 'updatedAt';

export interface AutomationFilters {
  triggerTypes: WorkflowEventType[];
  channelIds: string[];
  statuses: AutomationStatus[];
  createdByUserIds: string[];
  dateField: AutomationDateField;
  dateRange: DateRangeValue | null;
}

/**
 * Live statuses shown by default. Archived/Rejected/Revoked/Auto-Revoked
 * lineage rows stay out of the list until explicitly selected — but unlike
 * the old implicit exclusion, this default is an explicit, visible part of
 * `AutomationFilters` state, so the Status checklist can honestly show
 * exactly what's checked instead of lying about a "no filter" state.
 */
export const DEFAULT_AUTOMATION_FILTERS: AutomationFilters = {
  triggerTypes: [],
  channelIds: [],
  statuses: [
    AutomationStatusValues.DRAFT,
    AutomationStatusValues.PENDING_APPROVAL,
    AutomationStatusValues.ACTIVE,
    AutomationStatusValues.DISABLED,
  ],
  createdByUserIds: [],
  dateField: 'createdAt',
  dateRange: null,
};

/**
 * Most trigger types scope themselves to specific Xyne channels via a
 * `channelIds` array inside `trigger.config` (e.g. "only fire for messages
 * in these channels"). Not every trigger has this — e.g. Webhook doesn't —
 * so an automation with no channel-scoped trigger simply won't match any
 * channel filter selection.
 */
export function getAutomationChannelIds(a: Automation): string[] {
  const raw = a.config?.trigger?.config?.['channelIds'];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export const TRIGGER_TYPE_OPTIONS: { value: WorkflowEventType; label: string }[] = [
  { value: EventType.TICKET_CREATED, label: 'Ticket Created' },
  { value: EventType.TICKET_UPDATED, label: 'Ticket Updated' },
  { value: EventType.TICKET_COMMENTED, label: 'Ticket Commented' },
  { value: EventType.EMAIL_RECEIVED, label: 'Email Received' },
  { value: EventType.EMAIL_SENT, label: 'Email Sent' },
  { value: EventType.WEBHOOK, label: 'Webhook' },
  { value: EventType.MESSAGE_RECEIVED, label: 'Message Received' },
  { value: EventType.CALL_EVENT, label: 'Call Event' },
  { value: EventType.TAG_GENERATED, label: 'Tag Generated' },
  { value: EventType.NO_OP, label: 'Manual / Other' },
];

export const STATUS_OPTIONS: { value: AutomationStatus; label: string }[] = [
  { value: AutomationStatusValues.DRAFT, label: 'Draft' },
  { value: AutomationStatusValues.PENDING_APPROVAL, label: 'Pending Approval' },
  { value: AutomationStatusValues.ACTIVE, label: 'Active' },
  { value: AutomationStatusValues.DISABLED, label: 'Disabled' },
  { value: AutomationStatusValues.REJECTED, label: 'Rejected' },
  { value: AutomationStatusValues.REVOKED, label: 'Revoked' },
  { value: AutomationStatusValues.AUTO_REVOKED, label: 'Auto-Revoked' },
  { value: AutomationStatusValues.ARCHIVED, label: 'Archived' },
];

/** Terminal/archived-lineage rows — visible to everyone, hidden from the default view. */
export function isHistoryRow(a: Automation): boolean {
  return (
    a.status === AutomationStatusValues.ARCHIVED ||
    a.status === AutomationStatusValues.REJECTED ||
    a.status === AutomationStatusValues.REVOKED ||
    a.status === AutomationStatusValues.AUTO_REVOKED
  );
}

/**
 * DRAFT and PENDING_APPROVAL rows are visible only to their creator. Every
 * other status — live, or any history status — is visible to everyone. This
 * must be applied before any filter is considered, so that selecting a
 * status filter can never reveal another user's private draft.
 */
export function isVisibleToUser(a: Automation, meId: string | null): boolean {
  if (isLiveStatus(a.status) || isHistoryRow(a)) return true;
  return isProposalStatus(a.status) && meId !== null && a.createdById === meId;
}

export function filterAutomations(
  list: Automation[],
  query: string,
  filters: AutomationFilters,
): Automation[] {
  const q = query.trim().toLowerCase();
  return list.filter(a => {
    if (q) {
      const matchesQuery =
        a.name.toLowerCase().includes(q) ||
        (a.description?.toLowerCase().includes(q) ?? false) ||
        (a.config?.trigger?.type?.toLowerCase().includes(q) ?? false);
      if (!matchesQuery) return false;
    }

    if (filters.triggerTypes.length > 0 && !filters.triggerTypes.includes(a.eventType)) {
      return false;
    }

    if (filters.channelIds.length > 0) {
      const automationChannelIds = getAutomationChannelIds(a);
      if (!filters.channelIds.some(id => automationChannelIds.includes(id))) {
        return false;
      }
    }

    // No length-guard here (unlike the other filters above): an empty
    // `statuses` selection means "show nothing", not "status filter is off"
    // — the checklist always starts with a real default set, so a user who
    // manually unchecks every box is deliberately filtering everything out.
    if (!filters.statuses.includes(a.status)) {
      return false;
    }

    if (filters.createdByUserIds.length > 0 && !filters.createdByUserIds.includes(a.createdById)) {
      return false;
    }

    if (filters.dateRange) {
      const raw = a[filters.dateField];
      const time = raw ? new Date(raw).getTime() : NaN;
      if (
        Number.isNaN(time) ||
        time < filters.dateRange.startDate.getTime() ||
        time > filters.dateRange.endDate.getTime()
      ) {
        return false;
      }
    }

    return true;
  });
}

export function countAutomationsByTriggerType(
  list: Automation[],
  query: string,
  filters: AutomationFilters,
): Partial<Record<WorkflowEventType, number>> {
  const base = filterAutomations(list, query, { ...filters, triggerTypes: [] });
  const counts: Partial<Record<WorkflowEventType, number>> = {};
  for (const a of base) counts[a.eventType] = (counts[a.eventType] ?? 0) + 1;
  return counts;
}

export function countAutomationsByStatus(
  list: Automation[],
  query: string,
  filters: AutomationFilters,
): Partial<Record<AutomationStatus, number>> {
  // Passing every possible status makes the (now unconditional) status
  // check above pass for every row, i.e. "as if status weren't filtered".
  const base = filterAutomations(list, query, {
    ...filters,
    statuses: STATUS_OPTIONS.map(o => o.value),
  });
  const counts: Partial<Record<AutomationStatus, number>> = {};
  for (const a of base) counts[a.status] = (counts[a.status] ?? 0) + 1;
  return counts;
}

/** Order-independent equality — used to check whether `statuses` still matches the default set. */
function sameStatusSet(a: AutomationStatus[], b: AutomationStatus[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every(status => bSet.has(status));
}

export function hasActiveFilters(query: string, filters: AutomationFilters): boolean {
  return (
    !!query.trim() ||
    filters.triggerTypes.length > 0 ||
    filters.channelIds.length > 0 ||
    !sameStatusSet(filters.statuses, DEFAULT_AUTOMATION_FILTERS.statuses) ||
    filters.createdByUserIds.length > 0 ||
    filters.dateRange !== null
  );
}
