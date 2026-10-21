import { type ReactElement } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { CalendarCheck, CalendarClock, CalendarDays, CalendarX } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { ActivityV2Card } from './activity-v2-card';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';
import { tabRoute } from '@/src/navigation/routes';

export const ScheduledCallActivity = ({ activity }: ActivityV2Props): ReactElement | null => {
  const isReminder = activity.actorAction === 'call_reminder';
  const isUpdated = activity.actorAction === 'call_updated';
  const isMeetingAccepted = activity.actorAction === 'meeting_accepted';
  const isMeetingDeclined = activity.actorAction === 'meeting_declined';
  const callIconColor = useCSSVariable('--color-activity-call-icon') as string;
  const callBgColor = useCSSVariable('--color-activity-call-bg') as string;

  const description = isReminder
    ? 'reminded you about a scheduled call in'
    : isUpdated
      ? 'updated a scheduled call in'
      : isMeetingAccepted
        ? 'accepted your meeting invite in'
        : isMeetingDeclined
          ? 'declined your meeting invite in'
          : 'scheduled a call in';

  const badgeIcon = isMeetingAccepted ? (
    <CalendarCheck size={12} color='#15603e' />
  ) : isMeetingDeclined ? (
    <CalendarX size={12} color='#b91c1c' />
  ) : isReminder ? (
    <CalendarClock size={12} color={callIconColor} />
  ) : (
    <CalendarDays size={12} color={callIconColor} />
  );

  const badgeStyle =
    !isMeetingAccepted && !isMeetingDeclined ? { backgroundColor: callBgColor } : undefined;

  const body = isReminder
    ? 'Your call is starting in 10 min'
    : isUpdated
      ? 'A scheduled call was updated'
      : isMeetingAccepted
        ? 'Accepted your meeting invitation'
        : isMeetingDeclined
          ? 'Declined your meeting invitation'
          : 'You have a new scheduled call';

  return (
    <ActivityV2Card
      activity={activity}
      actorName={activity.actorId ? undefined : 'Xyne'}
      badgeIcon={badgeIcon}
      badgeColorClass={badgeStyle ? undefined : 'bg-card'}
      badgeStyle={badgeStyle}
      description={description}
      onPress={() => router.push(tabRoute('calls'))}
    >
      <Text
        className='text-[15px] text-activity-description font-medium'
        style={{ lineHeight: 24 }}
        numberOfLines={2}
      >
        {body}
      </Text>
    </ActivityV2Card>
  );
};
