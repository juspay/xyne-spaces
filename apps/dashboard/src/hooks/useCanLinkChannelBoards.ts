import { useQuery } from '@tanstack/react-query';
import { channelService } from '../services/Chat/channelService';

/**
 * Whether the current user may link boards to a channel.
 *
 * Answered by the backend (`GET /channels/:id/can-link-boards`) rather than by
 * client-side queries: it decides whether to render one control, so it does not
 * warrant a live Zero subscription, and a single server answer cannot drift from
 * ChannelBoardMappingsACL the way two parallel implementations would.
 *
 * The ACL is the enforcement boundary; this only governs what is shown.
 */
export const useCanLinkChannelBoards = (channelId: string | undefined): boolean => {
  const { data } = useQuery({
    queryKey: ['channel-can-link-boards', channelId],
    enabled: !!channelId,
    queryFn: (): Promise<boolean> => channelService.canLinkBoards(channelId!),
  });

  return data ?? false;
};
