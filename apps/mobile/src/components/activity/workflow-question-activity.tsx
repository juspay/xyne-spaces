import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { HelpCircle } from 'lucide-react-native';
import { ActivityV2Card } from './activity-v2-card';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export const WorkflowQuestionActivity = ({ activity }: ActivityV2Props): ReactElement | null => {
  const actorId = activity.actorId ?? 'system';
  const ticketTitle = activity.ticket?.title;
  const ticketXyneId = activity.ticket?.xyneId;

  return (
    <ActivityV2Card
      activity={activity}
      actorId={actorId}
      actorName={activity.actorId ? undefined : 'Xyne'}
      badgeIcon={<HelpCircle size={12} color='#a16207' />}
      badgeColorClass='bg-yellow-100'
      description='workflow needs input'
      hideChannel
    >
      <View className='gap-1'>
        <Text
          className='text-[15px] text-activity-description font-medium'
          style={{ lineHeight: 24 }}
          numberOfLines={2}
        >
          A workflow needs your input to continue.
        </Text>
        {ticketTitle ? (
          <Text className='text-xs text-activity-description font-medium'>
            Ticket: {ticketXyneId ? `${ticketXyneId} — ` : ''}
            {ticketTitle}
          </Text>
        ) : null}
      </View>
    </ActivityV2Card>
  );
};
