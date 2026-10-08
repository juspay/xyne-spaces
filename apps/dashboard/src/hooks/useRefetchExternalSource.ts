import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiInstance } from '../services/clients/apiClient';
import { fetchSocialMediaReviews } from '../services/clients/socialMediaDeskApi';

export interface RefetchSkippedSource {
  sourceId: string;
  sourceType: string;
  reason: string;
}
export interface RefetchResponseInline {
  success: boolean;
  queued?: false;
  processed: number;
  newTickets: number;
  skipped: number;
  errors: string[];
  skippedUnsupported?: RefetchSkippedSource[];
}
export interface RefetchQueuedJob {
  sourceId: string;
  installedAppId: string | null;
  jobId: string;
}
export interface RefetchResponseQueued {
  success: boolean;
  queued: true;
  jobId?: string;
  jobs: RefetchQueuedJob[];
  skippedUnsupported?: RefetchSkippedSource[];
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
  isCallDesk = false,
  /** What a social-media desk fetches, for the toasts: reviews, or Facebook activity. */
  socialItems: 'reviews' | 'Facebook activity' = 'reviews',
): {
  refetch: (range?: RefetchRange, target?: RefetchTarget) => void;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    RefetchResponse,
    Error & { status?: number; responseData?: unknown },
    { range?: RefetchRange | undefined; target?: RefetchTarget | undefined }
  >({
    mutationFn: async ({ range, target }) => {
      if (!channelId) throw new Error('channelId required');
      const range$ =
        range?.startDate && range?.endDate
          ? { startDate: range.startDate, endDate: range.endDate }
          : undefined;
      // Review desks sync through their own endpoint — unless the picker named a
      // specific source, which on a review desk only ever means an app binding.
      if (isSocialMedia && !target?.sourceId) {
        return fetchSocialMediaReviews(channelId, range$);
      }
      const body = {
        ...range$,
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
            const skipped = 'skippedUnsupported' in result ? result.skippedUnsupported : undefined;
            if (skipped?.length) {
              toast.warning(`Skipped ${skipped.length} source${skipped.length === 1 ? '' : 's'}`, {
                description: skipped.map(s => s.reason).join('; '),
              });
            }
            if ('synced' in result) {
              const interaction = socialItems === 'reviews' ? 'review interaction' : 'new item';
              toast.success(
                result.synced > 0
                  ? `Processed ${result.synced} ${interaction}${result.synced === 1 ? '' : 's'}`
                  : socialItems === 'reviews'
                    ? 'Reviews are up to date'
                    : 'Already up to date',
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
                      ? `Fetching ${socialItems} in background`
                      : isCallDesk
                        ? 'Fetching calls in background'
                        : 'Fetching emails in background';
              toast.success(label, {
                description: 'We’ll notify you when this finishes.',
              });
              return;
            }
            if (result.newTickets > 0) {
              toast.success(
                `Fetched ${result.newTickets} new ${isCallDesk ? 'call' : 'email'}${result.newTickets === 1 ? '' : 's'}`,
                { description: `${result.newTickets} new, ${result.skipped} already imported.` },
              );
            } else if (result.processed > 0) {
              // Replies-only run: tickets stayed the same, but threads got updates.
              toast.success(
                `Updated ${result.processed} thread${result.processed === 1 ? '' : 's'}`,
              );
            } else if (result.errors.length > 0) {
              toast.error(`Refetch completed with ${result.errors.length} error(s)`, {
                description: result.errors[0],
              });
            } else {
              toast.success(isCallDesk ? 'Calls are up to date' : 'Inbox is up to date', {
                description: `${result.skipped} already imported.`,
              });
            }
          },
          onError: err => {
            const needsReauth =
              err.status === 403 &&
              (err.responseData as { needsReauth?: boolean } | undefined)?.needsReauth === true;
            if (needsReauth) {
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
    [channelId, isSocialMedia, isCallDesk, mutation],
  );

  return { refetch, isPending: mutation.isPending };
};
