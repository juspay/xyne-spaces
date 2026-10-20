import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

import type {
  MentionChannelOption,
  MentionUserOption,
} from '@/src/components/input-composer/utils/mentions';
import { createNameSearch } from '@/src/features/global-search/utils/directory-search';
import { peopleSearchFor } from '@/src/features/global-search/hooks/use-directory-search';
import type { useUsers } from '@/src/hooks/useUsers';
import { stateMachineActor } from '@/src/machines/appStateMachine';

const LIMIT = 8;

/** People matching a name or email, searched on the device like the `@` mentions. */
export function findPeople(
  users: ReturnType<typeof useUsers>,
  target: string,
  excludeId?: string,
): MentionUserOption[] {
  return peopleSearchFor(users)(target, LIMIT)
    .filter(({ user }) => user.id !== excludeId)
    .map(({ user, name, email }) => ({
      id: user.id,
      name,
      type: 'user',
      ...(email ? { email } : {}),
    }));
}

/** Channels the user is in, searched on the device like the `#` mentions. */
export function findChannels(target: string): MentionChannelOption[] {
  const { visibleChannels, userChannelStatuses } = stateMachineActor.getSnapshot().context;
  const gone = new Set(
    userChannelStatuses
      .filter(({ isDeleted, isClosed }) => isDeleted || isClosed)
      .map(({ channelId }) => channelId),
  );
  const channels = visibleChannels
    .filter(({ id, scopeType }) => scopeType === ChannelScopeType.DEFAULT && !gone.has(id))
    .map(({ id, name, visibility }) => ({
      id,
      name: name.replace(/^#/, ''),
      type: 'channel' as const,
      isPrivate: visibility === ChannelVisibility.PRIVATE,
    }));
  return createNameSearch(channels)(target.replace(/^#/, ''), LIMIT);
}
