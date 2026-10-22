import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { listChannelAccounts, listMyChannelNumbers } from '../services/claw/clawMessagingService';
import { ClawApiError } from '../services/claw/clawRequest';
import type { MessagingChannelKey } from '../services/claw/clawMessagingTypes';
import {
  channelAccessFromError,
  mergeMyNumbers,
  type ChannelAccess,
  type MyNumber,
} from '../routes/ClawAgentsScreen/messaging/messagingChannels';

/** Connection state moves on its own (a phone logs out, a QR is scanned), so
 *  account lists refresh while visible — same cadence as the claw v3 card. */
const ACCOUNTS_REFRESH_MS = 10_000;

export const clawChannelAccountsKey = (
  channel: MessagingChannelKey,
  userId: string | undefined,
): readonly unknown[] => ['claw-channel-accounts', channel, userId];

export const clawMyNumbersKey = (
  channels: MessagingChannelKey[],
  userId: string | undefined,
): readonly unknown[] => ['claw-my-numbers', channels.join(','), userId];

/** What the caller can see of one channel's accounts (see ChannelAccess). */
export const useClawChannelAccess = (
  channel: MessagingChannelKey,
): UseQueryResult<ChannelAccess, Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: clawChannelAccountsKey(channel, userId),
    queryFn: async (): Promise<ChannelAccess> => {
      try {
        return { kind: 'ok', channel, accounts: await listChannelAccounts(channel) };
      } catch (error) {
        return channelAccessFromError(channel, error);
      }
    },
    enabled: !!userId,
    refetchInterval: query =>
      query.state.data?.kind === 'unavailable' ? false : ACCOUNTS_REFRESH_MS,
  });
};

/**
 * The caller's linked numbers across `channels`, one row per number. A channel
 * this deployment has not seeded answers 404 and simply contributes nothing;
 * any other failure fails the whole load rather than reading as "no numbers".
 */
export const useClawMyNumbers = (
  channels: MessagingChannelKey[],
): UseQueryResult<MyNumber[], Error> => {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: clawMyNumbersKey(channels, userId),
    queryFn: async (): Promise<MyNumber[]> => {
      const perChannel = await Promise.all(
        channels.map(async channel => {
          try {
            return { channel, numbers: await listMyChannelNumbers(channel) };
          } catch (error) {
            if (error instanceof ClawApiError && error.status === 404) {
              return { channel, numbers: [] };
            }
            throw error;
          }
        }),
      );
      return mergeMyNumbers(perChannel);
    },
    enabled: !!userId,
  });
};

/** A confirmed code links the number on every channel, so refresh them all. */
export const invalidateClawMessaging = async (queryClient: QueryClient): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['claw-my-numbers'] }),
    queryClient.invalidateQueries({ queryKey: ['claw-channel-accounts'] }),
  ]);
};
