import { ChannelScopeType } from '@xyne/shared';

import type { PostCallUpdatesChannel } from '../hooks/usePostCallUpdates';
import type { ScheduleCallParticipants } from '../hooks/useScheduleCallForm';
import type { EditCallData } from './types';

interface PrefillUser {
  id: string;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
}

interface PrefillChannel {
  id: string;
  name: string;
  scopeType: ChannelScopeType;
}

export interface EditPrefill {
  title: string;
  startsAt: Date;
  endsAt: Date;
  participants: ScheduleCallParticipants;
  guests: string[];
  callUpdatesChannel: PostCallUpdatesChannel | null;
}

export function getEditPrefill(
  editCall: EditCallData,
  selfId: string | undefined,
  users: readonly PrefillUser[],
  channels: readonly PrefillChannel[],
): EditPrefill {
  const callChannel = editCall.channelId ? channels.find(c => c.id === editCall.channelId) : null;
  const isChannelCall =
    !!callChannel &&
    callChannel.scopeType !== ChannelScopeType.DM &&
    callChannel.scopeType !== ChannelScopeType.GROUP_DM;
  const usersById = new Map(users.map(user => [user.id, user]));

  const participants: ScheduleCallParticipants =
    isChannelCall && callChannel
      ? { users: [], channel: { id: callChannel.id, name: callChannel.name } }
      : {
          users: editCall.participants
            .filter(p => !p.isExternal && p.userId !== selfId)
            .map(p => {
              const user = usersById.get(p.userId);
              const email = user?.email ?? p.email ?? '';
              return {
                id: p.userId,
                name: user?.name ?? (email || 'Unknown'),
                email,
                picture: user?.picture ?? null,
              };
            }),
          channel: null,
        };

  const guests = editCall.participants
    .flatMap(p => (p.isExternal && p.email ? [p.email] : []))
    .sort((a, b) => a.localeCompare(b));

  const updatesChannelId = editCall.callUpdatesChannel;
  const callUpdatesChannel = updatesChannelId
    ? {
        id: updatesChannelId,
        name: channels.find(c => c.id === updatesChannelId)?.name ?? 'Unknown channel',
      }
    : null;

  return {
    title: editCall.title,
    startsAt: new Date(editCall.startsAt),
    endsAt: new Date(editCall.endsAt),
    participants,
    guests,
    callUpdatesChannel,
  };
}
