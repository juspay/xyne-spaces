import { useCallback, useMemo, type ReactElement } from 'react';

import { useInTargetsSearch, usePeopleSearch } from '../../hooks/use-directory-search';
import { fromChip, inChip } from '../../utils/filter-chip';
import type { FilterTrigger } from '../../utils/filter-trigger';
import type { SearchFilterChip, SearchInTargetItem, SearchPersonItem } from '../../types';
import { SearchInTargetRow } from '../rows/search-in-target-row';
import { SearchPersonRow } from '../rows/search-person-row';
import { LOCAL_STATUS, SearchList, type EmptyCopy, type ListChrome } from '../search-list';

type SuggestionProps = ListChrome & {
  /** Live, not debounced: suggestions that lag the operator being typed feel broken. */
  trigger: FilterTrigger;
  onPick: (chip: SearchFilterChip) => void;
};

const FROM_EMPTY: EmptyCopy = {
  idleTitle: 'Search people',
  idleSubtitle: 'Pick someone to filter messages they sent.',
  emptyTitle: 'No matching people',
  emptySubtitle: 'Try another name.',
};

const IN_EMPTY: EmptyCopy = {
  idleTitle: 'Search channels and DMs',
  idleSubtitle: 'Pick a channel or DM to search inside.',
  emptyTitle: 'No matching conversations',
  emptySubtitle: 'Try another name.',
};

export function FromSuggestions({ trigger, onPick, ...chrome }: SuggestionProps): ReactElement {
  const people = usePeopleSearch(trigger.query);

  const sections = useMemo(() => [{ id: 'from', title: 'From', items: people }], [people]);

  const pick = useCallback((person: SearchPersonItem) => onPick(fromChip(person)), [onPick]);

  const renderItem = useCallback(
    (person: SearchPersonItem) => (
      <SearchPersonRow item={person} query={trigger.query} onPress={pick} />
    ),
    [pick, trigger.query],
  );

  return (
    <SearchList
      {...chrome}
      sections={sections}
      status={LOCAL_STATUS}
      hasQuery={trigger.query.length > 0}
      renderItem={renderItem}
      itemKey={personKey}
      estimatedItemSize={64}
      empty={FROM_EMPTY}
    />
  );
}

export function InSuggestions({ trigger, onPick, ...chrome }: SuggestionProps): ReactElement {
  const targets = useInTargetsSearch(trigger.query, trigger.inMode);

  // `in:#` and `in:@` already narrowed `targets`, so the other section is just empty.
  const sections = useMemo(
    () => [
      {
        id: 'in-channels',
        title: 'Channels',
        items: targets.filter(target => target.kind === 'channel'),
      },
      {
        id: 'in-dms',
        title: 'Direct messages',
        items: targets.filter(target => target.kind === 'dm'),
      },
    ],
    [targets],
  );

  const pick = useCallback((target: SearchInTargetItem) => onPick(inChip(target)), [onPick]);

  const renderItem = useCallback(
    (target: SearchInTargetItem) => (
      <SearchInTargetRow item={target} query={trigger.query} onPress={pick} />
    ),
    [pick, trigger.query],
  );

  return (
    <SearchList
      {...chrome}
      sections={sections}
      status={LOCAL_STATUS}
      hasQuery={trigger.query.length > 0}
      renderItem={renderItem}
      itemKey={targetKey}
      estimatedItemSize={64}
      empty={IN_EMPTY}
    />
  );
}

function personKey(person: SearchPersonItem): string {
  return person.id;
}

function targetKey(target: SearchInTargetItem): string {
  return `${target.kind}-${target.id}`;
}
