import { router } from 'expo-router';

import { tabRoute } from '@/src/navigation/routes';

import type { ActivityTarget } from '../model/row';
import { navigateToActivityTarget } from './activityRowAssembler';

/**
 * Opens whatever an activity points at.
 *
 * Message, ticket and channel targets go through the classic screen's own
 * navigator, so a tap lands exactly where it does there — including the
 * activity-open journey it records. The two cases the classic cards handled
 * with a bespoke `onPress` are the extra arms here.
 */
export function openActivityTarget(target: ActivityTarget): void {
  switch (target.kind) {
    case 'calls':
      router.push(tabRoute('calls'));
      return;
    case 'canvas': {
      const params = {
        from: 'activity',
        canvasId: target.canvasId,
        ...(target.blockId ? { blockId: target.blockId } : {}),
      };
      if (target.channelId) {
        router.push({
          pathname: '/(protected)/chat/[channelId]/canvas',
          params: { channelId: target.channelId, ...params },
        });
        return;
      }
      router.push({ pathname: '/(protected)/canvas', params });
      return;
    }
    default:
      navigateToActivityTarget(target);
  }
}
