import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { format } from 'date-fns';
import { router } from 'expo-router';
import { Ticket } from 'lucide-react-native';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import { ActivityV2Card } from './activity-v2-card';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';

export const EtaActivity = ({ activity }: ActivityV2Props): ReactElement | null => {
  const [ticket] = useQuery(queries.ticketByIdV2({ ticketId: activity.actionSourceId ?? '' }));

  const isWarning = activity.actorAction === 'eta_warning';
  const isBreach = activity.actorAction === 'eta_breach';
  const isStageBreach = activity.actorAction === 'stage_eta_breach';
  if (!isWarning && !isBreach && !isStageBreach) return null;

  const ticketXyneId = ticket?.xyneId ?? activity.actionSourceId ?? '';
  const etaDate = ticket?.eta ? new Date(ticket.eta) : null;
  const formattedDueDate = etaDate ? format(etaDate, 'MMM d, yyyy') : 'N/A';
  const stageName = ticket?.stageName ?? '';

  const iconColor = isWarning ? '#a16207' : isStageBreach ? '#c2410c' : '#b91c1c';
  const bgClass = isWarning ? 'bg-yellow-100' : isStageBreach ? 'bg-yellow-100' : 'bg-red-100';

  return (
    <ActivityV2Card
      activity={activity}
      actorName='Xyne'
      badgeIcon={<Ticket size={12} color={iconColor} />}
      badgeColorClass={bgClass}
      description='ticket in'
      onPress={() => {
        const channelId = ticket?.conversation?.channelId ?? activity.channelId ?? '';
        if (!channelId) return;
        const intent = createChatOpenIntent({ channelId, openStartedAtMs: Date.now() }, 'activity');
        if (intent) executeChatOpenIntent(router, intent);
      }}
    >
      <View className='gap-1'>
        <Text
          className='text-[15px] text-activity-description font-medium'
          style={{ lineHeight: 24 }}
          numberOfLines={2}
        >
          {isWarning
            ? `Ticket ${ticketXyneId} is due today. Please ensure it's completed or updated.`
            : isStageBreach
              ? `Ticket ${ticketXyneId} stage "${stageName}" is overdue. Please update the Status or Status Deadline.`
              : `Ticket ${ticketXyneId} is overdue. Please update the ticket's status or ETA.`}
        </Text>
        {isBreach ? (
          <Text className='text-xs text-activity-description font-medium'>
            Action required: Ticket #{ticketXyneId} missed its deadline ({formattedDueDate}).
          </Text>
        ) : null}
      </View>
    </ActivityV2Card>
  );
};
