import { isAxiosError } from 'axios';
import { apiInstance } from '../clients/apiClient';

export interface DesignShare {
  id: string;
  title: string;
  attachmentId: string;
  conversationId: string;
  sharePath: string;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DesignShareInput {
  attachmentId: string;
  conversationId: string;
  title?: string;
}

const BASE = '/xyne-ai/v2/design-shares';

export const designShareQueryKey = (conversationId: string): [string, string] => [
  'xyne-ai-design-share',
  conversationId,
];

export async function getDesignShare(conversationId: string): Promise<DesignShare | null> {
  const response = await apiInstance.get<{ data: DesignShare | null }>(
    `${BASE}/conversation/${encodeURIComponent(conversationId)}`,
  );
  return response.data?.data ?? null;
}

export async function publishDesignShare(input: DesignShareInput): Promise<DesignShare> {
  const response = await apiInstance.post<{ data: DesignShare }>(BASE, input);
  return response.data.data;
}

export async function revokeDesignShare(shareId: string): Promise<void> {
  await apiInstance.delete(`${BASE}/${encodeURIComponent(shareId)}`);
}

export function designShareUrl(sharePath: string, origin: string): string {
  return new URL(sharePath, origin).toString();
}

export function designShareViews(count: number): string {
  return `${count} view${count === 1 ? '' : 's'}`;
}

export function publishShareErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    if (error.response?.status === 404) {
      return 'This version can’t be shared. Only designs saved in this chat can be.';
    }
    const message = (error.response?.data as { error?: unknown } | undefined)?.error;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}
