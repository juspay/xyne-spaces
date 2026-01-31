import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { MessageMentionActivity } from './MessageMentionActivity';
import { MessageRepliedActivity } from './MessageRepliedActivity';
import { ReactionAddedActivity } from './ReactionAddedActivity';
import { DirectMessageActivity } from './DirectMessageActivity';
import { EtaActivity } from './EtaActivity';

interface ActivityItemProps {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}

export const ActivityItem = ({ activity, isExpanded }: ActivityItemProps): ReactElement | null => {
  switch (activity.actorAction) {
    case 'mentioned_user':
    case 'group_mention':
      return <MessageMentionActivity activity={activity} isExpanded={isExpanded} />;

    case 'direct_message':
      return <DirectMessageActivity activity={activity} isExpanded={isExpanded} />;

    case 'replied':
      return <MessageRepliedActivity activity={activity} isExpanded={isExpanded} />;

    case 'added':
      return <ReactionAddedActivity activity={activity} isExpanded={isExpanded} />;

    case 'removed':
      return <ReactionAddedActivity activity={activity} isExpanded={isExpanded} />;

    case 'eta_warning':
    case 'eta_breach':
      return <EtaActivity activity={activity} isExpanded={isExpanded} />;

    default:
      return null;
  }
};
