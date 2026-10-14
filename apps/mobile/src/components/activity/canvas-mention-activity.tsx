import { type ReactElement } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { AtSign } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { ActivityV2Card } from './activity-v2-card';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';
import { haptics } from '@/src/utils/haptics';

export const CanvasMentionActivity = ({ activity }: ActivityV2Props): ReactElement | null => {
  const mentionBadgeBg = useCSSVariable('--color-activity-v2-user-mention-badge-bg') as string;
  const mentionBadgeStroke = useCSSVariable(
    '--color-activity-v2-user-mention-badge-text',
  ) as string;
  const canvasId = activity.canvasId ?? undefined;
  const canvas = activity.canvas;
  const actorId = activity.actorId ?? canvas?.lastEditedBy ?? '';

  if (!canvasId || !canvas) return null;

  return (
    <ActivityV2Card
      activity={activity}
      actorId={actorId}
      badgeIcon={<AtSign size={12} color={mentionBadgeStroke} />}
      badgeStyle={{ backgroundColor: mentionBadgeBg }}
      description='mentioned you in'
      onPress={() => {
        const channelId = activity.channelId;

        void haptics.buttonTap();

        if (channelId) {
          router.push({
            pathname: '/(protected)/chat/[channelId]/canvas',
            params: {
              channelId,
              from: 'activity',
              canvasId,
              ...(activity.blockId ? { blockId: activity.blockId } : {}),
            },
          });
          return;
        }

        router.push({
          pathname: '/(protected)/canvas',
          params: {
            from: 'activity',
            canvasId,
            ...(activity.blockId ? { blockId: activity.blockId } : {}),
          },
        });
      }}
    >
      <Text className='text-xs text-activity-description font-medium'>
        Canvas: {canvas.title ?? 'Untitled'}
      </Text>
    </ActivityV2Card>
  );
};
