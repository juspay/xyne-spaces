import { TicketPriority } from '@xyne/shared';
import { apiInstance } from '../services/clients/apiClient';

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  timestamp?: string;
}

export interface ConversationLabelDeleteImpact {
  label: {
    id: string;
    name: string;
    channelId: string;
  };
  mappingCount: number;
  linkedDeskRuleCount: number;
}

export interface ConversationLabelDeleteResult extends ConversationLabelDeleteImpact {
  archivedDeskRuleCount: number;
  removedMappingCount: number;
}

async function unwrap<T>(promise: Promise<{ data: SuccessEnvelope<T> }>): Promise<T> {
  const res = await promise;
  return res.data.data;
}

export async function fetchConversationLabelUnreadCounts(
  channelId: string,
): Promise<Record<string, number>> {
  const data = await unwrap(
    apiInstance.get<SuccessEnvelope<{ counts: Record<string, number> }>>(
      `/conversation-labels/unread-counts?channelId=${encodeURIComponent(channelId)}`,
    ),
  );
  return data.counts;
}

/**
 * Filter surface for the filtered label unread count (mode B). An empty
 * `conversationIds` array is meaningful (match nothing) — pass it through,
 * never collapse it to undefined.
 */
export interface LabelUnreadFilters {
  assignedTo?: string[] | undefined;
  createdBy?: string[] | undefined;
  priority?: TicketPriority[] | undefined;
  stageName?: string[] | undefined;
  aiCategory?: string[] | undefined;
  conversationIds?: string[] | undefined;
  hasAiDraft?: boolean | undefined;
  hasSubTickets?: boolean | undefined;
  userGroups?: string[] | undefined;
  lastEmailAtStart?: number | undefined;
  lastEmailAtEnd?: number | undefined;
  createdAtStart?: number | undefined;
  createdAtEnd?: number | undefined;
  dynamicFieldFilters?:
    | Array<{
        fieldId: string;
        values?: Array<string | number | boolean>;
      }>
    | undefined;
}

export interface FilteredLabelUnreadCountPayload {
  channelId: string;
  labelId: string;
  filters?: LabelUnreadFilters | undefined;
}

export interface FilteredLabelUnreadCountResult {
  labelId: string;
  unreadCount: number;
}

export function fetchFilteredLabelUnreadCount(
  payload: FilteredLabelUnreadCountPayload,
): Promise<FilteredLabelUnreadCountResult> {
  return unwrap(
    apiInstance.post<SuccessEnvelope<FilteredLabelUnreadCountResult>>(
      '/conversation-labels/unread-counts',
      payload,
    ),
  );
}

export function fetchConversationLabelDeleteImpact(
  labelId: string,
): Promise<ConversationLabelDeleteImpact> {
  return unwrap(
    apiInstance.get<SuccessEnvelope<ConversationLabelDeleteImpact>>(
      `/conversation-labels/${encodeURIComponent(labelId)}/delete-impact`,
    ),
  );
}

export function deleteConversationLabel(labelId: string): Promise<ConversationLabelDeleteResult> {
  return unwrap(
    apiInstance.delete<SuccessEnvelope<ConversationLabelDeleteResult>>(
      `/conversation-labels/${encodeURIComponent(labelId)}`,
    ),
  );
}
