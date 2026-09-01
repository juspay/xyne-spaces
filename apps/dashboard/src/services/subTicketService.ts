import { apiInstance } from './clients/apiClient';

interface LinkSubTicketResponse {
  subTicketId: string;
  mappingId: string;
}

/**
 * apiClient's interceptor replaces the axios error with a plain Error carrying `status` and
 * `responseData`, so read that rather than `error.response`.
 */
export const getSubTicketLinkErrorMessage = (error: unknown, fallback: string): string =>
  (error as { responseData?: { error?: string } })?.responseData?.error ||
  (error instanceof Error ? error.message : '') ||
  fallback;

/**
 * Sub-ticket links are written through the API rather than a Zero mutator: the guards are
 * read-then-writes that need an advisory lock, which belongs in the Prisma layer. The tree
 * itself still reads through Zero, and replication syncs these writes back to every client.
 */
export const subTicketService = {
  async link(
    ticketId: string,
    mappedTicketId: string,
    subTicketTitle: string,
  ): Promise<LinkSubTicketResponse> {
    const response = await apiInstance.post<LinkSubTicketResponse>('/sub-tickets/link', {
      ticketId,
      mappedTicketId,
      subTicketTitle,
    });
    return response.data;
  },

  async unlink(mappingId: string): Promise<void> {
    await apiInstance.post('/sub-tickets/unlink', { mappingId });
  },
};
