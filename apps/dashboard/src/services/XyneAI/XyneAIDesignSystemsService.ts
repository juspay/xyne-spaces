import { apiInstance } from '../clients/apiClient';

const DESIGN_SYSTEMS_URL = '/xyne-ai/v2/design-systems';

export interface DesignSystemRecord {
  id: string;
  orgId: string;
  name: string;
  designMd: string;
  tokensCss: string;
  assets: unknown;
  source: string;
  sourceUrl: string | null;
  sourceRepo: string | null;
  sourceCommit: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export async function fetchDesignSystems(): Promise<DesignSystemRecord[]> {
  const response = await apiInstance.get<Envelope<DesignSystemRecord[]>>(DESIGN_SYSTEMS_URL);
  return response.data.success ? (response.data.data ?? []) : [];
}

export async function updateDesignSystem(
  id: string,
  patch: { name?: string; designMd?: string; tokensCss?: string },
): Promise<DesignSystemRecord> {
  const response = await apiInstance.patch<Envelope<DesignSystemRecord>>(
    `${DESIGN_SYSTEMS_URL}/${encodeURIComponent(id)}`,
    patch,
  );
  return response.data.data;
}

export async function deleteDesignSystem(id: string): Promise<void> {
  await apiInstance.delete(`${DESIGN_SYSTEMS_URL}/${encodeURIComponent(id)}`);
}

export async function fetchConversationDesignSystem(
  conversationId: string,
): Promise<DesignSystemRecord | null> {
  const response = await apiInstance.get<Envelope<DesignSystemRecord | null>>(
    `${DESIGN_SYSTEMS_URL}/conversations/${encodeURIComponent(conversationId)}`,
  );
  return response.data.data ?? null;
}

export async function pinConversationDesignSystem(
  conversationId: string,
  designSystemId: string,
): Promise<void> {
  await apiInstance.put(
    `${DESIGN_SYSTEMS_URL}/conversations/${encodeURIComponent(conversationId)}`,
    { designSystemId },
  );
}

export async function unpinConversationDesignSystem(conversationId: string): Promise<void> {
  await apiInstance.delete(
    `${DESIGN_SYSTEMS_URL}/conversations/${encodeURIComponent(conversationId)}`,
  );
}

export async function setAgentDesignSystem(
  agentSlug: string,
  designSystemId: string,
): Promise<void> {
  await apiInstance.patch(`/xyne-ai/v2/agents/${encodeURIComponent(agentSlug)}/design-system`, {
    designSystemId,
  });
}
