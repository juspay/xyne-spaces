import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiInstance } from '../services/clients/apiClient';
import { fetchGooglePlayReviews } from '../services/clients/socialMediaDeskApi';

export interface RefetchResponseInline {
  success: boolean;
  queued?: false;
  processed: number;
  newTickets: number;
  skipped: number;
  errors: string[];
}
export interface RefetchQueuedJob {
  sourceId: string;
  installedAppId: string | null;
  jobId: string;
}
export interface RefetchResponseQueued {
  success: boolean;
  queued: true;
  jobs: RefetchQueuedJob[];
}
export interface SocialMediaRefetchResponse {
  synced: number;
  sourceCount: number;
}
export interface SocialMediaQueuedResponse {
  success: true;
  queued: true;
  jobId: string;
  jobs?: undefined;
}
export type RefetchResponse =
  | RefetchResponseInline
  | RefetchResponseQueued
  | SocialMediaRefetchResponse
  | SocialMediaQueuedResponse;

export interface RefetchRange {
  startDate?: string;
  endDate?: string;
}

export interface RefetchTarget {
  sourceId?: string | undefined;
  sourceName?: string | undefined;
}

export const useRefetchExternalSource = (
  channelId: string | undefined,
  isSocialMedia = false,
): {
  refetch: (range?: RefetchRange, target?: RefetchTarget) => void;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    RefetchResponse,
    Error & { status?: number },
    { range?: RefetchRange | undefined; target?: RefetchTarget | undefined }
  >({
    mutationFn: async ({ range, target }) => {
      if (!channelId) throw new Error('channelId required');
      if (isSocialMedia && !target?.sourceId) return fetchGooglePlayReviews(channelId);
      const body = {
        ...(range?.startDate && range?.endDate ? range : undefined),
        ...(target?.sourceId ? { sourceId: target.sourceId } : undefined),
      };
      const response = await apiInstance.post<RefetchResponse>(
        `/external-source-sync/${channelId}/refetch`,
        Object.keys(body).length > 0 ? body : undefined,
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
    (range?: RefetchRange, target?: RefetchTarget): void => {
      if (!channelId || mutation.isPending) return;
      mutation.mutate(
        { range, target },
        {
          onSuccess: result => {
            if ('synced' in result) {
              toast.success(
                result.synced > 0
                  ? `Processed ${result.synced} review interaction${result.synced === 1 ? '' : 's'}`
                  : 'Google Play reviews are up to date',
              );
              return;
            }
            if (result.queued) {
              const jobCount = result.jobs?.length ?? 0;
              const label =
                jobCount > 1
                  ? `Fetching from ${jobCount} sources in background`
                  : target?.sourceName
                    ? `Fetching from ${target.sourceName} in background`
                    : isSocialMedia
                      ? 'Fetching Google Play reviews in background'
                      : 'Fetching emails in background';
              toast.success(label, {
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
              toast.success(
                `Updated ${result.processed} thread${result.processed === 1 ? '' : 's'}`,
              );
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
        },
      );
    },
    [channelId, isSocialMedia, mutation],
  );

  return { refetch, isPending: mutation.isPending };
};
