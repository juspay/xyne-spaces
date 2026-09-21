import { useMemo } from 'react';
import { ChannelRole } from '@xyne/shared';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useHasResourceAccess } from './usePermissions';

/**
 * Whether the current user may link boards to a channel.
 *
 * Mirrors ChannelBoardMappingsACL.canInsert: a channel admin, or a LISTPROJECTS
 * resource admin. The ACL is the real gate — this only decides whether to render
 * the control, so the two must agree or users get a button that always errors.
 */
export const useCanLinkChannelBoards = (channelId: string | undefined): boolean => {
  const isProjectsAdmin = useHasResourceAccess('LISTPROJECTS');

  // Only asked when the cheaper check misses. Returns the current user's ADMIN
  // participations across all channels, so it is a single small query.
  const [adminParticipations] = useCachedQuery(queries.myChannelParticipations({}), {
    enabled: !!channelId && !isProjectsAdmin,
  });

  return useMemo(() => {
    if (!channelId) return false;
    if (isProjectsAdmin) return true;
    return (adminParticipations ?? []).some(
      participation =>
        participation.channelId === channelId && participation.role === ChannelRole.ADMIN,
    );
  }, [channelId, isProjectsAdmin, adminParticipations]);
};
