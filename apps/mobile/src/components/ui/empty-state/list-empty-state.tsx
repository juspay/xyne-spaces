import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { EmptyStateIllustration, type EmptyIllustrationName } from './empty-state-illustration';

/**
 * Bottom space every empty state reserves, so the block sits at the same optical
 * height whether or not the screen has a tab bar under it. Screens that render
 * the empty state inside a list already apply this as the content container's
 * `paddingBottom`; screens that render it directly pass it as `insetBottom`.
 */
export const EMPTY_STATE_BOTTOM_INSET = 100;

type ListEmptyStateProps = {
  illustration: EmptyIllustrationName;
  title: string;
  subtitle: string;
  /** Space for chrome the parent does not already account for — an absolutely
   *  positioned header, for instance. */
  insetTop?: number;
  insetBottom?: number;
};

/**
 * The empty slot every list screen shares. Before this, each screen hand-rolled
 * the same centred column with its own type scale and its own muted colour —
 * keep new screens pointed here so the set stays consistent.
 *
 * Placement rule: centred between the bottom of the screen's own chrome and
 * `EMPTY_STATE_BOTTOM_INSET` from the bottom. Parents either supply that region
 * through their list padding or pass it here.
 */
export const ListEmptyState = memo(function ListEmptyState({
  illustration,
  title,
  subtitle,
  insetTop = 0,
  insetBottom = 0,
}: ListEmptyStateProps): ReactElement {
  return (
    <View
      className='flex-1 items-center justify-center px-8'
      style={{ paddingTop: insetTop, paddingBottom: insetBottom }}
    >
      <EmptyStateIllustration name={illustration} />
      <Text className='mt-3 text-center text-[17px] font-semibold text-foreground'>{title}</Text>
      <Text className='mt-1.5 text-center text-[14px] leading-5 text-secondary-foreground'>
        {subtitle}
      </Text>
    </View>
  );
});
