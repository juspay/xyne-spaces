import { apiInstance } from './clients/apiClient';
import type {
  AuditEntityType,
  AuditLogEntityOption,
  AuditLogExport,
  AuditLogPage,
} from '@xyne/shared';

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

export interface AuditFeedFilter {
  entityType: AuditEntityType;
  /** Omitted = every entity of the type. */
  entityId?: string | undefined;
  /** Inclusive epoch-ms window; omitted = all time. */
  from?: number | undefined;
  to?: number | undefined;
  /** Only entries touching these audited tables, with only their change rows. */
  tables?: string[] | undefined;
}

const feedParams = (filter: AuditFeedFilter): Record<string, string | number> => ({
  entityType: filter.entityType,
  ...(filter.entityId && { entityId: filter.entityId }),
  ...(filter.from !== undefined && { from: filter.from }),
  ...(filter.to !== undefined && { to: filter.to }),
  ...(filter.tables && filter.tables.length > 0 && { tables: filter.tables.join(',') }),
});

const unwrap = <T>(envelope: ApiEnvelope<T>, fallbackError: string): T => {
  if (envelope.success === false || !envelope.data) {
    throw new Error(envelope.error ?? fallbackError);
  }
  return envelope.data;
};

/**
 * Fetch one page of the audit feed (newest first).
 * `cursor` is the opaque keyset cursor from the previous page.
 */
export const fetchAuditLogPage = async (
  params: AuditFeedFilter & { limit: number; cursor: string | null },
): Promise<AuditLogPage> => {
  const response = await apiInstance.get<ApiEnvelope<AuditLogPage>>('/audit-logs', {
    params: {
      ...feedParams(params),
      limit: params.limit,
      ...(params.cursor && { cursor: params.cursor }),
    },
  });
  return unwrap(response.data, 'Failed to load audit logs');
};

/** Entities of a type that have audit history, sorted by name. */
export const fetchAuditLogEntities = async (
  entityType: AuditEntityType,
): Promise<AuditLogEntityOption[]> => {
  const response = await apiInstance.get<ApiEnvelope<AuditLogEntityOption[]>>(
    '/audit-logs/entities',
    { params: { entityType } },
  );
  return unwrap(response.data, 'Failed to load audited entities');
};

/** Every entry in the window (newest first, capped server-side) for CSV export. */
export const fetchAuditLogExport = async (filter: AuditFeedFilter): Promise<AuditLogExport> => {
  const response = await apiInstance.get<ApiEnvelope<AuditLogExport>>('/audit-logs/export', {
    params: feedParams(filter),
  });
  return unwrap(response.data, 'Failed to export audit logs');
};
