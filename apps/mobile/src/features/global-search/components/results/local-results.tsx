import { useCallback, useMemo, useState, type ReactElement } from 'react';

import {
  useChannelsSearch,
  useGroupDmsSearch,
  usePeopleSearch,
} from '../../hooks/use-directory-search';
import { useSearchNavigation } from '../../hooks/use-search-navigation';
import type { SearchChannelItem, SearchGroupDmItem, SearchPersonItem } from '../../types';
import { SearchChannelRow } from '../rows/search-channel-row';
import { SearchGroupDmRow } from '../rows/search-group-dm-row';
import { SearchPersonRow } from '../rows/search-person-row';
import { LOCAL_STATUS, SearchList, type EmptyCopy, type ListChrome } from '../search-list';

type LocalProps = ListChrome & {
  query: string;
  /** False when only filters are set, which the on-device lists cannot apply. */
  browse: boolean;
  hasQuery: boolean;
  onLeave: () => void;
};

const CHATS_EMPTY: EmptyCopy = {
  idleTitle: 'Search people and DMs',
  idleSubtitle: 'Find teammates and group DMs.',
  emptyTitle: 'No matching people',
  emptySubtitle: 'Try another name, or switch to Messages to search message text.',
};

type ChatRow =
  { kind: 'person'; person: SearchPersonItem } | { kind: 'groupDm'; groupDm: SearchGroupDmItem };

export function ChatResults({
  query,
  browse,
  hasQuery,
  onLeave,
  ...chrome
}: LocalProps): ReactElement {
  const { openPerson, openGroupDm } = useSearchNavigation(onLeave);
  const people = usePeopleSearch(query);
  const groupDms = useGroupDmsSearch(query);

  const sections = useMemo(
    () =>
      browse
        ? [
            {
              id: 'people',
              title: query.length > 0 ? 'People' : 'Suggested',
              items: people.map((person): ChatRow => ({ kind: 'person', person })),
            },
            {
              id: 'group-dms',
              title: 'Group DMs',
              items: groupDms.map((groupDm): ChatRow => ({ kind: 'groupDm', groupDm })),
            },
          ]
        : [],
    [browse, groupDms, people, query.length],
  );

  const renderItem = useCallback(
    (row: ChatRow) =>
      row.kind === 'person' ? (
        <SearchPersonRow item={row.person} query={query} onPress={openPerson} />
      ) : (
        <SearchGroupDmRow item={row.groupDm} query={query} onPress={openGroupDm} />
      ),
    [openGroupDm, openPerson, query],
  );

  return (
    <SearchList
      {...chrome}
      sections={sections}
      status={LOCAL_STATUS}
      hasQuery={hasQuery}
      renderItem={renderItem}
      itemKey={chatRowKey}
      estimatedItemSize={64}
      empty={CHATS_EMPTY}
    />
  );
}

const CHANNEL_PREVIEW_LIMIT = 15;
const NO_CHANNELS: readonly SearchChannelItem[] = [];

const CHANNELS_EMPTY: EmptyCopy = {
  idleTitle: 'Search channels',
  idleSubtitle: 'Jump to any channel you can see.',
  emptyTitle: 'No matching channels',
  emptySubtitle: 'Try another channel name, or switch to Messages to search message text.',
};

export function ChannelResults({
  query,
  browse,
  hasQuery,
  onLeave,
  ...chrome
}: LocalProps): ReactElement {
  const { openChannel } = useSearchNavigation(onLeave);
  const found = useChannelsSearch(query);
  const channels = browse ? found : NO_CHANNELS;
  const [expanded, setExpanded] = useState(false);

  const sections = useMemo(() => {
    const hidden = Math.max(0, channels.length - CHANNEL_PREVIEW_LIMIT);

    return [
      {
        id: 'channels',
        title: query.length > 0 ? 'Channels' : 'Suggested',
        items: expanded ? channels : channels.slice(0, CHANNEL_PREVIEW_LIMIT),
        ...(hidden > 0
          ? {
              action: {
                label: expanded ? 'Show less' : `Show ${hidden} more`,
                onPress: (): void => setExpanded(value => !value),
              },
            }
          : {}),
      },
    ];
  }, [channels, expanded, query.length]);

  const renderItem = useCallback(
    (item: SearchChannelItem) => (
      <SearchChannelRow item={item} query={query} onPress={openChannel} />
    ),
    [openChannel, query],
  );

  return (
    <SearchList
      {...chrome}
      sections={sections}
      status={LOCAL_STATUS}
      hasQuery={hasQuery}
      renderItem={renderItem}
      itemKey={channelKey}
      estimatedItemSize={64}
      empty={CHANNELS_EMPTY}
    />
  );
}

function chatRowKey(row: ChatRow): string {
  return row.kind === 'person' ? `person-${row.person.id}` : `group-dm-${row.groupDm.id}`;
}

function channelKey(item: SearchChannelItem): string {
  return item.id;
}
