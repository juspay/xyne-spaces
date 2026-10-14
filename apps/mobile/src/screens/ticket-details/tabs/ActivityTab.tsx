import { format } from 'date-fns';
import { type ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ActivityType } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { cn } from '@/src/utils/cn';
import {
  activityText,
  getActivityIcon,
  getLabelChipClass,
  getLabelTextClass,
  parseLabelValues,
} from '../helpers';
import type { ActivityGroup } from '../types';

type ActivityTabProps = {
  groupedActivities: ActivityGroup[];
  users: Array<{ id: string; name: string; picture?: string | null }>;
};

export function ActivityTab({ groupedActivities, users }: ActivityTabProps): ReactElement {
  const activityIconColor = useCSSVariable('--color-foreground') as string;

  return (
    <ScrollView className='flex-1'>
      <View className='px-4 py-3'>
        {groupedActivities.map(group => (
          <View key={group.key} className='mb-4'>
            <View className='items-center mb-3'>
              <View className='rounded-xl bg-ticket-activity-day-bg px-4 py-1.5'>
                <Text className='text-[12px] font-semibold tracking-[1.2px] text-ticket-activity-day-text'>
                  {group.label}
                </Text>
              </View>
            </View>
            {group.items.map((item, index) => {
              const actor = users.find(u => u.id === item.updatedBy);
              const text = activityText(item, users);
              const labelValues =
                item.activityType === ActivityType.TAGS ? parseLabelValues(text.emphasize) : [];
              const hasLabelValues = labelValues.length > 0;

              return (
                <View key={item.id} className='flex-row gap-3 pb-3'>
                  <View className='items-center w-10'>
                    <View className='relative'>
                      <Avatar userIds={item.updatedBy ? [item.updatedBy] : []} size={32} />
                      <View className='absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-card border border-ticket-overview-divider items-center justify-center'>
                        {getActivityIcon(item.activityType, activityIconColor)}
                      </View>
                    </View>
                    {index < group.items.length - 1 ? (
                      <View className='w-px flex-1 bg-ticket-activity-line mt-1' />
                    ) : null}
                  </View>
                  <View className='flex-1'>
                    <View className='flex-row flex-wrap items-center gap-1'>
                      <Text className='text-[14px] leading-[19px] text-foreground'>
                        <Text className='font-semibold'>{actor?.name ?? 'Someone'}</Text>{' '}
                        {text.prefix}{' '}
                        {text.oldValue ? (
                          <Text className='text-ticket-activity-old line-through'>
                            {text.oldValue}
                          </Text>
                        ) : null}
                        {text.newValue ? (
                          <Text className='font-semibold text-ticket-activity-accent'>
                            {' -> '}
                            {text.newValue}
                          </Text>
                        ) : null}
                        {text.emphasize && !hasLabelValues ? (
                          <Text className='font-semibold text-ticket-activity-accent'>
                            {' '}
                            {text.emphasize}
                          </Text>
                        ) : null}
                      </Text>
                      {hasLabelValues
                        ? labelValues.map(label => (
                            <View
                              key={`${item.id}-${label}`}
                              className={cn('rounded-full px-2 py-0.5', getLabelChipClass(label))}
                            >
                              <Text
                                className={cn('text-[14px] font-medium', getLabelTextClass(label))}
                              >
                                {label}
                              </Text>
                            </View>
                          ))
                        : null}
                    </View>
                    <Text className='text-[11px] text-ticket-activity-time mt-0.5'>
                      {format(new Date(item.timestamp), 'h:mm a')}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
