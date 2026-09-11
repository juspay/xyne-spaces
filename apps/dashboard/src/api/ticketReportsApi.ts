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

type TicketExportDownloadRequest =
  | { exportId: string }
  | { workspaceId: string; filters: TicketExportFilters };

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
  downloadExport: async (
    request: TicketExportDownloadRequest,
  ): Promise<{ blob: Blob; fileName: string }> => {
    try {
      const res = await apiInstance.post('/ticket-reports/exports/download', request, {
        responseType: 'blob',
      });
      const disposition = String(res.headers['content-disposition'] || '');
      const match = disposition.match(/filename="?([^"]+)"?/);
      const fileName =
        match?.[1] ?? `ticket-export-${'exportId' in request ? request.exportId : Date.now()}.xlsx`;
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
