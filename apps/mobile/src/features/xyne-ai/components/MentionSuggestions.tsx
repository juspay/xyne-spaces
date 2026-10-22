import { useDeferredValue, useMemo, type ReactElement, type ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { ChannelVisibility } from '@xyne/shared';

import {
  MentionChannelRow,
  MentionEmpty,
  MentionPanel,
  MentionUserRow,
} from '@/src/components/input-composer/mention-rows';
import type {
  MentionChannelOption,
  MentionUserOption,
} from '@/src/components/input-composer/utils/mentions';
import {
  useChannelsSearch,
  usePeopleSearch,
} from '@/src/features/global-search/hooks/use-directory-search';

import type { MentionTrigger } from '../model/mentionTrigger';

const MAX_SUGGESTIONS = 8;

type Props<T> = { query: string; onPick: (item: T) => void };

// Capped and scrollable like the conversation screen's list, so it never outgrows the screen.
const SuggestionList = ({ children }: { children: ReactNode }): ReactElement => (
  <MentionPanel>
    <ScrollView
      style={{ maxHeight: 200 }}
      keyboardShouldPersistTaps='handled'
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  </MentionPanel>
);

const PeopleSuggestions = ({ query, onPick }: Props<MentionUserOption>): ReactElement => {
  const results = usePeopleSearch(useDeferredValue(query), MAX_SUGGESTIONS);
  const people = useMemo<MentionUserOption[]>(
    () =>
      results.map(({ id, name, subtitle }) => ({
        id,
        name,
        type: 'user',
        ...(subtitle ? { email: subtitle } : {}),
      })),
    [results],
  );

  return (
    <SuggestionList>
      {people.length > 0 ? (
        people.map(item => <MentionUserRow key={item.id} item={item} onSelectItem={onPick} />)
      ) : (
        <MentionEmpty label='No people found' />
      )}
    </SuggestionList>
  );
};

const ChannelSuggestions = ({ query, onPick }: Props<MentionChannelOption>): ReactElement => {
  const results = useChannelsSearch(useDeferredValue(query), MAX_SUGGESTIONS);
  const channels = useMemo<MentionChannelOption[]>(
    () =>
      results.map(({ id, name, visibility }) => ({
        id,
        name,
        type: 'channel',
        isPrivate: visibility === ChannelVisibility.PRIVATE,
      })),
    [results],
  );

  return (
    <SuggestionList>
      {channels.length > 0 ? (
        channels.map(item => <MentionChannelRow key={item.id} item={item} onSelectItem={onPick} />)
      ) : (
        <MentionEmpty label='No channels found' />
      )}
    </SuggestionList>
  );
};

export const MentionSuggestions = ({
  trigger: { indicator, query },
  onPickUser,
  onPickChannel,
}: {
  trigger: Pick<MentionTrigger, 'indicator' | 'query'>;
  onPickUser: (user: MentionUserOption) => void;
  onPickChannel: (channel: MentionChannelOption) => void;
}): ReactElement =>
  indicator === '@' ? (
    <PeopleSuggestions query={query} onPick={onPickUser} />
  ) : (
    <ChannelSuggestions query={query} onPick={onPickChannel} />
  );
