import { memo } from 'react';
import { Text, View } from 'react-native';

import { TICKET_LIST_CARD_RADIUS, TICKET_LIST_H_INSET } from '../../constants';

type TicketsListEmptyStateProps = {
  title: string;
  subtitle?: string;
  /** Explicit height so the card fills remaining viewport under list chrome. */
  minHeight: number;
};

/**
 * Card-backed empty region matching email row surface (`bg-card`).
 * Height is passed in — LegendList footers/empty slots won't expand via flex alone.
 */
export const TicketsListEmptyState = memo(function TicketsListEmptyState({
  title,
  subtitle,
  minHeight,
}: TicketsListEmptyStateProps) {
  return (
    <View style={{ paddingHorizontal: TICKET_LIST_H_INSET, minHeight }} className='pb-1'>
      <View
        className='flex-1 items-center justify-center bg-card px-8'
        style={{ borderRadius: TICKET_LIST_CARD_RADIUS, minHeight: minHeight - 4 }}
      >
        <Text className='text-center text-[16px] font-medium text-foreground'>{title}</Text>
        {subtitle ? (
          <Text className='mt-2 text-center text-[14px] text-foreground/50'>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
});
