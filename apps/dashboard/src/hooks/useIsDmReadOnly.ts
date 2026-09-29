import { useChannel } from './useChannels';
import { useUser } from './useUsers';
import { useAuthContextValues } from './useAuth';
import { ChannelScopeType } from '@xyne/shared';
import { parseDMParticipantIds } from '../components/Chat/ChatDirectory/ChatDirectory.utils';
import { isUserDeactivated } from '../utils/userDisplayName';

/**
 * True when `channelId` is a 1:1 DM whose other participant is deactivated.
 * Callers use this to render the DM as an archive: no composer, no reactions,
 * no thread replies, no message edits/deletes — read-only in every surface.
 *
 * Group DMs and self-DMs return false: a group DM has its own membership rules,
 * and a self-DM has no "partner" to deactivate.
 */
export const useIsDmReadOnly = (channelId: string | undefined | null): boolean => {
  const channel = useChannel(channelId ?? '');
  const { userID } = useAuthContextValues();
  const isDm = channel?.scopeType === ChannelScopeType.DM;
  const partnerId = isDm
    ? parseDMParticipantIds({ name: channel.name, scopeType: channel.scopeType }).find(
        id => id !== userID,
      )
    : undefined;
  const partner = useUser(partnerId ?? '');
  return isDm && !!partnerId && isUserDeactivated(partner);
};
