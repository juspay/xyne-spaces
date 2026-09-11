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
