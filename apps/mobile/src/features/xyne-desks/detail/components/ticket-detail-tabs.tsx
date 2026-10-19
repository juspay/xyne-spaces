import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

import { TICKET_DETAIL_TABS } from '../constants';
import type { TicketDetailTabId } from '../types';
import { useCSSVariable } from 'uniwind';

type TicketDetailTabsProps = {
  active: TicketDetailTabId;
  onChange: (tab: TicketDetailTabId) => void;
};

export const TicketDetailTabs = memo(function TicketDetailTabs({
  active,
  onChange,
}: TicketDetailTabsProps) {
  const border = useCSSVariable('--color-border') as string;

  return (
    <View className='flex-row px-2' style={{ borderBottomWidth: 0.3, borderBottomColor: border }}>
      {TICKET_DETAIL_TABS.map(tab => {
        const isActive = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole='tab'
            accessibilityState={{ selected: isActive }}
            onPress={() => {
              // Re-tapping the active tab changes nothing, so it stays silent.
              if (!isActive) void haptics.selection();
              onChange(tab.id);
            }}
            className='min-w-0 flex-1 items-center px-2 py-2.5'
          >
            <Text
              className={cn(
                'text-[14px] font-medium',
                isActive ? 'text-foreground' : 'text-foreground/60',
              )}
            >
              {tab.label}
            </Text>
            <View
              className={cn(
                'mt-1.5 h-0.5 w-10 rounded-full',
                isActive ? 'bg-foreground' : 'bg-transparent',
              )}
            />
          </Pressable>
        );
      })}
    </View>
  );
});
