import { ActivityClassification } from '@xyne/shared';

import type { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';

import type { ActivityTab } from '../domain/activityTypes';

type Zero = ReturnType<typeof useZero>;

/**
 * Marks as read every activity the given tab holds.
 *
 * The one place that maps a tab onto the mutations that clear it, so the
 * classic screen's menu and the redesigned screen's tray cannot disagree about
 * what "Mark as read" means. Replies are two actions because the feed carries
 * both the old and the current reply shape.
 */
export function markTabAsRead(zero: Zero, tab: ActivityTab): void {
  const timestamp = Date.now();
  const mark = (filters: { actorAction?: string; classification?: ActivityClassification }): void =>
    void zero.mutate(mutators.activities.markAsReadByFilter({ ...filters, timestamp }));

  switch (tab) {
    case 'your_mentions':
      mark({ actorAction: 'mentioned_user' });
      return;
    case 'group_mentions':
      mark({ actorAction: 'group_mention' });
      return;
    case 'replies':
      mark({ actorAction: 'replied' });
      mark({ actorAction: 'replied_v2' });
      return;
    case 'actionable':
      mark({ classification: ActivityClassification.ACTIONABLE });
      return;
    case 'fyi':
      mark({ classification: ActivityClassification.FYI });
      return;
    default:
      // All, and the tabs that have no narrower mutation, clear everything.
      mark({});
  }
}
