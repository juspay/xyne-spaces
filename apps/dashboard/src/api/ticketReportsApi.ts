import { apiInstance } from '../services/clients/apiClient';

export type TicketExportStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'READY'
  | 'EXPIRED'
  | 'FAILED'
  | 'CANCELED';

export interface TicketExportFilters {
  projectId?: string;
  sourceChannelId?: string;
  boardIds?: string[];
  dateRange?: { from?: string; to?: string };
  statuses?: string[];
  priorities?: string[];
  assignees?: string[];
  tags?: string[];
  includeArchived?: boolean;
  includeLinkedTickets?: boolean;
  includeLinkedTicketDetails?: boolean;
  includeActivity?: boolean;
  timezone?: string;
  columnsByBoard?: Record<string, string[]>;
}

export interface TicketExportRecord {
  id: string;
  workspaceId: string;
  requestedBy: string;
  status: TicketExportStatus;
  filters: TicketExportFilters;
  createdAt: string;
  updatedAt: string;
}

function getErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const { error, message } = payload as { error?: unknown; message?: unknown };
  if (typeof error === 'string') return error;
  if (typeof message === 'string') return message;
  if (Array.isArray(error)) {
    const messages = error
      .map(item =>
        item &&
        typeof item === 'object' &&
        typeof (item as { message?: unknown }).message === 'string'
          ? (item as { message: string }).message
          : null,
      )
      .filter((item): item is string => Boolean(item));
    return messages.length > 0 ? messages.join(', ') : null;
  }
  return null;
}

export const ticketReportsApi = {
  /**
   * POST /ticket-reports/exports
   * Request a new export — creates a PENDING record and enqueues a worker job.
   * Returns the export record with status PENDING.
   */
  requestExport: async (
    workspaceId: string,
    filters: TicketExportFilters,
  ): Promise<TicketExportRecord> => {
    try {
      const res = await apiInstance.post('/ticket-reports/exports', { workspaceId, filters });
      return res.data.data as TicketExportRecord;
    } catch (error) {
      const data = (error as { response?: { data?: unknown } })?.response?.data;
      const message = getErrorMessage(data);
      if (message) throw new Error(message);
      throw error;
    }
  },

  /**
   * GET /ticket-reports/exports/:id
   * Get the current status of an export (for polling).
   */
  getExport: async (exportId: string): Promise<TicketExportRecord> => {
    try {
      const res = await apiInstance.get(`/ticket-reports/exports/${exportId}`);
      return res.data.data as TicketExportRecord;
    } catch (error) {
      const data = (error as { response?: { data?: unknown } })?.response?.data;
      const message = getErrorMessage(data);
      if (message) throw new Error(message);
      throw error;
    }
  },

  /**
   * GET /ticket-reports/exports/:id/download
   * Download the XLSX file for a READY export. Returns a blob.
   */
  downloadExport: async (
    exportId: string,
  ): Promise<{ blob: Blob; fileName: string }> => {
    try {
      const res = await apiInstance.get(`/ticket-reports/exports/${exportId}/download`, {
        responseType: 'blob',
      });
      const disposition = String(res.headers['content-disposition'] || '');
      const match = disposition.match(/filename="?([^"]+)"?/);
      const fileName = match?.[1] ?? `ticket-export-${exportId}.xlsx`;
      return { blob: res.data as Blob, fileName };
    } catch (error) {
      const data = (error as { response?: { data?: unknown } })?.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed: unknown = JSON.parse(await data.text());
          const message = getErrorMessage(parsed);
          if (message) throw new Error(message);
        } catch (parseError) {
          if (parseError instanceof Error && parseError.name !== 'SyntaxError') {
            throw parseError;
          }
        }
      }
      throw error;
    }
  },
};
