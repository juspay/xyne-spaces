import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { describeRecordingSummary } from '@/src/features/activity/model/recording-summary';
import { navigateToActivityTarget } from '@/src/features/activity/presentation/activityRowAssembler';
import { ActivityV2Card } from './activity-v2-card';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export function RecordingSummaryActivity({ activity }: ActivityV2Props): ReactElement | null {
  const color = useCSSVariable('--color-activity-description') as string;
  const summary = describeRecordingSummary(activity);
  if (!summary) return null;

  return (
    <ActivityV2Card
      activity={activity}
      actorName={summary.actorName}
      badgeIcon={<Sparkles size={12} color={color} />}
      description={summary.description}
      hideChannel
      onPress={() => navigateToActivityTarget(summary.target)}
    >
      <Text className='text-[15px] text-activity-description font-medium' numberOfLines={2}>
        {summary.body}
      </Text>
    </ActivityV2Card>
  );
}
