import { memo } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { SearchIcon } from '@/src/components/icons';

type TicketsSearchEmptyStateProps = {
  title: string;
  subtitle?: string;
  isLoading?: boolean;
};

export const TicketsSearchEmptyState = memo(function TicketsSearchEmptyState({
  title,
  subtitle,
  isLoading,
}: TicketsSearchEmptyStateProps) {
  const muted = useCSSVariable('--color-muted') as string;

  if (isLoading) {
    return (
      <View className='items-center justify-center px-8 py-16'>
        <ActivityIndicator />
        <Text className='mt-3 text-sm text-muted'>Searching…</Text>
      </View>
    );
  }

  return (
    <View className='items-center justify-center px-8 py-16'>
      <View className='mb-4 size-16 items-center justify-center rounded-full bg-card'>
        <SearchIcon size={26} color={muted} />
      </View>
      <Text className='text-center text-base font-semibold text-foreground'>{title}</Text>
      {subtitle ? <Text className='mt-1 text-center text-sm text-muted'>{subtitle}</Text> : null}
    </View>
  );
});
