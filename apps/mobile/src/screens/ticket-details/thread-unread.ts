import { ActivityClassification } from '@xyne/shared';

type UnreadActivityLike = {
  isThreadActivity?: boolean | null;
  classification?: string | null;
  ticketId?: string | null;
  conversationId?: string | null;
};

/** Count unread thread activities for this ticket / conversation. */
export function countThreadUnreadActivities(
  activities: ReadonlyArray<UnreadActivityLike> | null | undefined,
  args: { ticketId: string; conversationId: string },
): number {
  const { ticketId, conversationId } = args;
  if (!activities?.length) return 0;

  return activities.filter(activity => {
    if (activity.isThreadActivity !== true) return false;
    const classification = activity.classification ?? ActivityClassification.PENDING;
    if (classification === ActivityClassification.SKIP) return false;
    return (
      activity.ticketId === ticketId ||
      (conversationId ? activity.conversationId === conversationId : false)
    );
  }).length;
}
