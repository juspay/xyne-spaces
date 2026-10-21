import { apiInstance } from './clients/apiClient';
import type { AuditEntityType, AuditLogPage } from '@xyne/shared';

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

/**
 * Fetch one page of the audit feed for an entity context (newest first).
 * `cursor` is the opaque keyset cursor from the previous page.
 */
export const fetchAuditLogPage = async (params: {
  entityType: AuditEntityType;
  entityId: string;
  limit: number;
  cursor: string | null;
}): Promise<AuditLogPage> => {
  const response = await apiInstance.get<ApiEnvelope<AuditLogPage>>('/audit-logs', {
    params: {
      entityType: params.entityType,
      entityId: params.entityId,
      limit: params.limit,
      ...(params.cursor && { cursor: params.cursor }),
    },
  });
  const envelope = response.data;
  if (envelope.success === false || !envelope.data) {
    throw new Error(envelope.error ?? 'Failed to load audit logs');
  }
  return envelope.data;
};
