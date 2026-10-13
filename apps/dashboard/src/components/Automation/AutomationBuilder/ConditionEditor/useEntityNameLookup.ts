import { useCallback, useMemo } from 'react';
import { useAllChannels } from '../../../../hooks/useChannels';
import { useUsersById } from '../../../../hooks/useUsers';
import { getUserDisplayName } from '../../../../utils/userDisplayName';
import { EntityKind } from '../SchemaForm/SchemaForm.utils';
import type { EntityNameLookup } from './ConditionEditor.utils';

/**
 * Names for the ids a condition's value picker stores, read from the same
 * in-memory user and channel lists `EntityField` shows. Other kinds stay ids.
 */
export function useEntityNameLookup(): EntityNameLookup {
  const usersById = useUsersById();
  const channels = useAllChannels();
  const channelNames = useMemo(
    () => new Map(channels.map(c => [c.id, c.name || '(unnamed channel)'])),
    [channels],
  );

  return useCallback(
    (kind, id) => {
      if (kind === EntityKind.CHANNEL) return channelNames.get(id);
      if (kind === EntityKind.USER || kind === EntityKind.SENDER) {
        const user = usersById.get(id);
        return user ? getUserDisplayName(user) : undefined;
      }
      return undefined;
    },
    [channelNames, usersById],
  );
}
