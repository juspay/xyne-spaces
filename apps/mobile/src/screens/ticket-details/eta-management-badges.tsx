import { AlertCircle } from 'lucide-react-native';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { EtaManagementView } from '@xyne/shared';

type EtaManagementBadgesProps = {
  view: EtaManagementView;
  showOverdue?: boolean;
};

export function EtaManagementBadges({
  view,
  showOverdue = false,
}: EtaManagementBadgesProps): ReactElement | null {
  const showPlanningRisk = view.severity === 'PLANNING_RISK';
  const showEstimateIncomplete = view.forecastStatus === 'INCOMPLETE';

  if (!showOverdue && !showPlanningRisk && !showEstimateIncomplete) {
    return null;
  }

  return (
    <View className='flex-row flex-wrap items-center gap-1.5'>
      {showOverdue ? (
        <View className='rounded bg-destructive/10 px-1.5 py-0.5'>
          <Text className='text-[11px] font-medium text-destructive'>Overdue</Text>
        </View>
      ) : null}
      {showPlanningRisk ? (
        <View className='flex-row items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5'>
          <AlertCircle size={11} color='#B45309' />
          <Text className='text-[11px] font-medium text-amber-700'>
            Planning Risk{view.isPaused ? ' (paused)' : ''}
          </Text>
        </View>
      ) : null}
      {showEstimateIncomplete ? (
        <View className='rounded bg-muted px-1.5 py-0.5'>
          <Text className='text-[11px] font-medium text-secondary-foreground'>
            Estimate Incomplete
          </Text>
        </View>
      ) : null}
    </View>
  );
}
