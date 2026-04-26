import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiInstance } from '../services/clients/apiClient';

export interface RefetchResponse {
  success: boolean;
  processed: number;
  newTickets: number;
  skipped: number;
  errors: string[];
}

/**
 * Hook that wires the manual-refetch button for a channel-backed external source.
 *
 * Returns `refetch` (a no-arg callback to invoke from the button's onClick) and
 * `isPending` (for the spinner/disabled state). Toast feedback for success/error
 * and the 403 reconnect case lives here so the UI stays dumb.
 */
export const useRefetchExternalSource = (
  channelId: string | undefined,
): { refetch: () => void; isPending: boolean } => {
  const queryClient = useQueryClient();

  const mutation = useMutation<RefetchResponse, Error & { status?: number }, void>({
    mutationFn: async () => {
      if (!channelId) throw new Error('channelId required');
      const response = await apiInstance.post<RefetchResponse>(
        `/external-source-sync/${channelId}/refetch`,
      );
      return response.data;
    },
    onSuccess: () => {
      if (!channelId) return;
      void queryClient.invalidateQueries({ queryKey: ['messages', channelId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations', channelId] });
      void queryClient.invalidateQueries({ queryKey: ['emails', channelId] });
    },
  });

  const refetch = useCallback((): void => {
    if (!channelId || mutation.isPending) return;
    mutation.mutate(undefined, {
      onSuccess: result => {
        if (result.newTickets > 0) {
          toast.success(
            `Fetched ${result.newTickets} new email${result.newTickets === 1 ? '' : 's'}`,
          );
        } else if (result.processed > 0) {
          // Replies-only run: tickets stayed the same, but threads got updates.
          toast.success(`Updated ${result.processed} thread${result.processed === 1 ? '' : 's'}`);
        } else if (result.errors.length > 0) {
          toast.error(`Refetch completed with ${result.errors.length} error(s)`);
        } else {
          toast.success('Inbox is up to date');
        }
      },
      onError: err => {
        if (err.status === 403) {
          toast.error('Reconnect required', {
            description: 'Your email account needs to be reconnected.',
          });
        } else {
          toast.error('Failed to refetch', { description: err.message });
        }
      },
    });
  }, [channelId, mutation]);

  return { refetch, isPending: mutation.isPending };
};
