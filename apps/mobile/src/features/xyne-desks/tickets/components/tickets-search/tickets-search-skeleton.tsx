import { memo } from 'react';
import { View } from 'react-native';

import { TicketsListSkeleton } from '../tickets-list/tickets-list-skeleton';

/**
 * Email-row shaped placeholders for the first search while results load.
 */
export const TicketsSearchSkeleton = memo(function TicketsSearchSkeleton() {
  return (
    <View accessibilityLabel='Loading search results'>
      <View className='px-4 pb-2 pt-3'>
        <View className='h-3 w-20 rounded-md bg-foreground/8' />
      </View>
      <TicketsListSkeleton rowCount={6} />
    </View>
  );
});
