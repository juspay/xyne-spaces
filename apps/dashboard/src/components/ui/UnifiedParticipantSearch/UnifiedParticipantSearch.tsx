import { useMemo, type ReactElement, type ReactNode } from 'react';
import { Hash, Users } from 'lucide-react';
import { ChannelScopeType } from '@xyne/shared';
import { useChannelSearch, useUserGroupSearch } from '@xyne/shared/hooks';
import { SearchParticipants } from '../../../routes/CallHistoryScreen/SearchParticipants';
import { useRankedActivePeople } from '../../../hooks/useRankedPeopleSearch';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import Avatar from '../Avatar/Avatar';

const DEFAULT_USER_LIMIT = 20;
const DEFAULT_GROUP_LIMIT = 10;
const DEFAULT_CHANNEL_LIMIT = 10;
const EMPTY_IDS: ReadonlySet<string> = new Set();

export interface UnifiedParticipantSearchProps {
  selectedValues: string[];
  onMultiSelect: (values: string[]) => void | Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  excludedUserIds?: ReadonlySet<string>;
  excludedUserGroupIds?: ReadonlySet<string>;
  excludedChannelIds?: ReadonlySet<string>;
  userLimit?: number;
  userGroupLimit?: number;
  channelLimit?: number;
  exclusiveSelection?: boolean;
  helperText?: ReactNode;
}

/**
 * Bounded, locally-backed recipient search for people, user groups, and channels.
 *
 * This follows the fast Forward Message picker: users are token/MFU/DM-recency
 * ranked, while channels and groups use their shared local search hooks. Only the
 * top results from each entity type are converted to rows and rendered.
 */
export function UnifiedParticipantSearch({
  selectedValues,
  onMultiSelect,
  searchQuery,
  setSearchQuery,
  excludedUserIds = EMPTY_IDS,
  excludedUserGroupIds = EMPTY_IDS,
  excludedChannelIds = EMPTY_IDS,
  userLimit = DEFAULT_USER_LIMIT,
  userGroupLimit = DEFAULT_GROUP_LIMIT,
  channelLimit = DEFAULT_CHANNEL_LIMIT,
  exclusiveSelection = false,
  helperText,
}: UnifiedParticipantSearchProps): ReactElement {
  // Fetch enough ranked candidates to replace excluded rows without ever mapping
  // the complete workspace user list on each keystroke.
  const rankedUsers = useRankedActivePeople(searchQuery.trim(), userLimit + excludedUserIds.size);
  const userGroups = useUserGroupSearch(searchQuery, userGroupLimit + excludedUserGroupIds.size);
  const channels = useChannelSearch(searchQuery, channelLimit + excludedChannelIds.size);

  const options = useMemo(() => {
    const userOptions = rankedUsers
      .filter(user => !excludedUserIds.has(user.id))
      .slice(0, userLimit)
      .map(user => ({
        ...user,
        label: getUserDisplayName(user),
        subtitle: user.email ?? '',
        value: `user:${user.id}`,
        icon: <Avatar userId={user.id} size='sm' showActiveStatus={false} />,
      }));

    const groupOptions = userGroups
      .filter(group => !excludedUserGroupIds.has(group.id))
      .slice(0, userGroupLimit)
      .map(group => ({
        ...group,
        label: group.name,
        subtitle: group.alias ? `@${group.alias} · Group` : 'Group',
        value: `user_group:${group.id}`,
        icon: <Users className='size-3.5 text-muted-foreground' />,
        isDeactivated: group.isActive === false,
      }));

    const channelOptions = channels
      .filter(
        channel =>
          channel.scopeType === ChannelScopeType.DEFAULT && !excludedChannelIds.has(channel.id),
      )
      .slice(0, channelLimit)
      .map(channel => ({
        ...channel,
        label: channel.name,
        subtitle: 'Channel',
        value: `channel:${channel.id}`,
        icon: <Hash className='size-3.5 text-muted-foreground' />,
      }));

    return [...userOptions, ...groupOptions, ...channelOptions];
  }, [
    channelLimit,
    channels,
    excludedChannelIds,
    excludedUserGroupIds,
    excludedUserIds,
    rankedUsers,
    userGroupLimit,
    userGroups,
    userLimit,
  ]);

  return (
    <SearchParticipants
      options={options}
      selectedValues={selectedValues}
      onMultiSelect={onMultiSelect}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
      exclusiveSelection={exclusiveSelection}
      helperText={helperText}
      disableClientFiltering
    />
  );
}
