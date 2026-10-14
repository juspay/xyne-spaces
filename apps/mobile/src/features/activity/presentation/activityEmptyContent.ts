import type { EmptyIllustrationName } from '@/src/components/ui/empty-state';
import type { ActivityTab } from '../domain/activityTypes';

export type ActivityEmptyContent = {
  illustration: EmptyIllustrationName;
  title: string;
  subtitle: string;
};

/** Per-tab artwork and copy. The unread toggle keeps the tab's illustration and
 *  swaps only the wording, so switching it on doesn't change the picture. */
export function getActivityEmptyContent(activeTab: ActivityTab): ActivityEmptyContent {
  switch (activeTab) {
    case 'your_mentions':
      return {
        illustration: 'activityMentions',
        title: 'No mentions',
        subtitle: 'Messages that mention you directly will appear here.',
      };
    case 'replies':
      return {
        illustration: 'activityReplies',
        title: 'No replies',
        subtitle: 'Replies to your messages will appear here.',
      };
    case 'reactions':
      return {
        illustration: 'activityReactions',
        title: 'No reactions',
        subtitle: 'Reactions to your messages will appear here.',
      };
    case 'tickets':
      return {
        illustration: 'activityTickets',
        title: 'No ticket updates',
        subtitle: 'Activity on your tickets will appear here.',
      };
    case 'group_mentions':
      return {
        illustration: 'activityGroupMentions',
        title: 'No group mentions',
        subtitle: 'Channel-wide and group mentions will appear here.',
      };
    case 'actionable':
      return {
        illustration: 'activityActionable',
        title: 'Nothing to action',
        subtitle: 'Activities that need a response from you will appear here.',
      };
    case 'fyi':
      return {
        illustration: 'activityFyi',
        title: 'Nothing for your info',
        subtitle: 'Updates worth knowing about will appear here.',
      };
    case 'all':
    default:
      return {
        illustration: 'activityAll',
        title: 'No activities yet',
        subtitle: 'Mentions, replies and updates will appear here.',
      };
  }
}
