import { useValue } from '@legendapp/state/react';
import { memo, type ReactElement } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

import { haptics } from '@/src/utils/haptics';

import { DM_FILTERS, filterShowsCount, type DmFilter } from '../model/filter';
import { dmFilterCounts$, dmFilter$, setDmFilter } from '../state/filter-store';
import { cn } from '@/src/utils/cn';

/**
 * How many conversations this chip would show, or nothing.
 *
 * A separate component so it owns its own subscription: a DM being marked
 * read re-renders this one number, not the chip around it and not the other
 * chips. Zero renders nothing rather than "0" — an empty filter says that
 * better by being empty.
 */
const ChipCount = memo(function ChipCount({
  id,
  isActive,
}: {
  id: DmFilter;
  isActive: boolean;
}): ReactElement | null {
  const count = useValue(dmFilterCounts$[id]);
  if (!count) return null;

  return (
    <Text
      className={cn(
        'text-[13px] font-medium',
        isActive ? 'text-spaces-foreground' : 'text-spaces-muted',
      )}
    >
      {count}
    </Text>
  );
});

/**
 * One chip, subscribed to the comparison rather than to the filter.
 *
 * `useValue` returns a boolean, so switching from All to Unread re-renders the
 * two chips whose answer changed and leaves the other four alone.
 */
const Chip = memo(function Chip({
  id,
  label,
  showsCount,
}: {
  id: DmFilter;
  label: string;
  showsCount: boolean;
}): ReactElement {
  const isActive = useValue(() => dmFilter$.get() === id);

  return (
    <Pressable
      accessibilityRole='tab'
      accessibilityState={{ selected: isActive }}
      onPress={() => {
        if (dmFilter$.peek() === id) return;
        void haptics.buttonTap();
        setDmFilter(id);
      }}
      className={cn(
        'flex-row items-center gap-1.5 px-3 py-2 rounded-xl',
        isActive ? 'bg-spaces-surface' : '',
      )}
    >
      <Text
        className={cn(
          'text-[15px] font-medium',
          isActive ? ' text-spaces-foreground' : 'font-medium text-spaces-muted',
        )}
      >
        {label}
      </Text>
      {showsCount ? <ChipCount id={id} isActive={isActive} /> : null}
    </Pressable>
  );
});

export function DmsFilterBar(): ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps='handled'
      contentContainerStyle={{ gap: 4 }}
      className='py-3 bg-spaces-background'
    >
      {DM_FILTERS.map(filter => (
        <Chip
          key={filter.id}
          id={filter.id}
          label={filter.label}
          showsCount={filterShowsCount(filter)}
        />
      ))}
    </ScrollView>
  );
}
