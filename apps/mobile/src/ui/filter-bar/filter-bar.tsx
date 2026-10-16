import { useValue } from '@legendapp/state/react';
import type { Observable } from '@legendapp/state';
import { memo, type ReactElement } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

export type FilterBarOption<Id extends string> = {
  readonly id: Id;
  readonly label: string;
  /**
   * Whether the chip shows how many items it would show. Off for "All", where
   * the number is the length of the list the user is already looking at.
   */
  readonly showsCount: boolean;
};

export type FilterBarProps<Id extends string> = {
  filters: readonly FilterBarOption<Id>[];
  /** The active chip. */
  active$: Observable<Id>;
  /** How many items each chip would show, keyed by chip. */
  counts$: Observable<Record<Id, number>>;
  onSelect: (id: Id) => void;
};

/**
 * How many items this chip would show, or nothing.
 *
 * A separate component so it owns its own subscription: one number changing
 * re-renders that number, not the chip around it and not the other chips. Zero
 * renders nothing rather than "0" — an empty filter says that better by being
 * empty.
 */
const ChipCount = memo(function ChipCount({
  count$,
  isActive,
}: {
  count$: Observable<number>;
  isActive: boolean;
}): ReactElement | null {
  const count = useValue(count$);
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

type ChipProps = {
  id: string;
  label: string;
  active$: Observable<string>;
  count$: Observable<number> | null;
  onSelect: (id: string) => void;
};

/**
 * One chip, subscribed to the comparison rather than to the filter.
 *
 * `useValue` returns a boolean, so switching chips re-renders the two whose
 * answer changed and leaves the rest alone.
 */
const Chip = memo(function Chip({ id, label, active$, count$, onSelect }: ChipProps): ReactElement {
  const isActive = useValue(() => active$.get() === id);

  return (
    <Pressable
      accessibilityRole='tab'
      accessibilityState={{ selected: isActive }}
      onPress={() => {
        if (active$.peek() === id) return;
        void haptics.buttonTap();
        onSelect(id);
      }}
      className={cn(
        'flex-row items-center gap-1.5 px-3 py-2 rounded-xl',
        isActive ? 'bg-spaces-surface' : '',
      )}
    >
      <Text
        className={cn(
          'text-[15px] font-medium',
          isActive ? 'text-spaces-foreground' : 'text-spaces-muted',
        )}
      >
        {label}
      </Text>
      {count$ !== null ? <ChipCount count$={count$} isActive={isActive} /> : null}
    </Pressable>
  );
});

/**
 * The row of filter chips under a list screen's header.
 *
 * Shared by the DMs and Channels screens so the two are the same control, not
 * two copies kept alike by hand. State lives in each screen's own store; this
 * only subscribes.
 */
export function FilterBar<Id extends string>({
  filters,
  active$,
  counts$,
  onSelect,
}: FilterBarProps<Id>): ReactElement {
  // `Id` is only a label for the caller; the chips treat ids as plain strings.
  const countNodes = counts$ as unknown as Record<string, Observable<number>>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps='handled'
      contentContainerStyle={{ gap: 4 }}
      className='py-3 px-4 bg-spaces-background'
    >
      {filters.map(filter => (
        <Chip
          key={filter.id}
          id={filter.id}
          label={filter.label}
          active$={active$ as unknown as Observable<string>}
          count$={filter.showsCount ? (countNodes[filter.id] ?? null) : null}
          onSelect={onSelect as (id: string) => void}
        />
      ))}
    </ScrollView>
  );
}
