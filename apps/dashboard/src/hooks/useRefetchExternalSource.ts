import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiInstance } from '../services/clients/apiClient';

export interface RefetchResponseInline {
  success: boolean;
  queued?: false;
  processed: number;
  newTickets: number;
  skipped: number;
  errors: string[];
}
export interface RefetchResponseQueued {
  success: boolean;
  queued: true;
  jobId: string;
}
export type RefetchResponse = RefetchResponseInline | RefetchResponseQueued;

export interface RefetchRange {
  startDate?: string;
  endDate?: string;
}

export const useRefetchExternalSource = (
  channelId: string | undefined,
): { refetch: (range?: RefetchRange) => void; isPending: boolean } => {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    RefetchResponse,
    Error & { status?: number },
    RefetchRange | undefined
  >({
    mutationFn: async range => {
      if (!channelId) throw new Error('channelId required');
      const body = range?.startDate && range?.endDate ? range : undefined;
      const response = await apiInstance.post<RefetchResponse>(
        `/external-source-sync/${channelId}/refetch`,
        body,
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

  const refetch = useCallback(
    (range?: RefetchRange): void => {
      if (!channelId || mutation.isPending) return;
      mutation.mutate(range, {
        onSuccess: result => {
          if (result.queued) {
            toast.success('Fetching emails in background', {
              description: 'We’ll notify you when this finishes.',
            });
            return;
          }
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
    },
    [channelId, mutation],
  );

  return { refetch, isPending: mutation.isPending };
};
