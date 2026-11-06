import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { useRouteContext } from '../../hooks/useRouteContext';
import { getUserDisplayName } from '../../utils/userDisplayName';

interface GenericActivityText {
  /** Shown after the actor's name. */
  description: string;
  /** Short summary shown as the row's content. */
  summary: string;
}

const GENERIC_ACTIVITY_TEXT: Record<string, GenericActivityText> = {
  missed_call: { description: 'called you', summary: 'Missed call' },
  workflow_question: {
    description: 'asked a question in a workflow',
    summary: 'A workflow is waiting for your answer',
  },
  delayed_message_cancelled: {
    description: 'cancelled a scheduled message',
    summary: 'Your scheduled message was cancelled',
  },
  delayed_message_failed: {
    description: 'could not send a scheduled message',
    summary: 'Your scheduled message failed to send',
  },
  created: { description: 'created a channel', summary: 'Channel created' },
  archived: { description: 'archived a channel', summary: 'Channel archived' },
  visibility_changed: {
    description: 'changed channel visibility',
    summary: 'Channel visibility changed',
  },
};

const FALLBACK_TEXT: GenericActivityText = {
  description: 'sent an update',
  summary: 'New activity',
};

export function getGenericActivityText(actorAction: string): GenericActivityText {
  return GENERIC_ACTIVITY_TEXT[actorAction] ?? FALLBACK_TEXT;
}

/**
 * Minimal row for activities without a dedicated renderer, so they never show
 * up as blank rows in the feed.
 */
export const GenericActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement => {
  const { baseRoute } = useRouteContext();
  const actorId = activity.actorId || 'system';
  const actor = useUser(actorId);
  const actorName = actor ? getUserDisplayName(actor) : 'Xyne';
  const { description, summary } = getGenericActivityText(activity.actorAction);
  const targetPath = activity.channelId ? `${baseRoute}/${activity.channelId}` : '';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={actorId}
      actorName={actorName}
      channelId={activity.channelId ?? undefined}
      description={<span className='text-muted-foreground text-sm'>{description}</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
    >
      <div
        className={
          isExpanded ? 'text-sm text-muted-foreground mt-2' : 'text-sm text-muted-foreground'
        }
      >
        {summary}
      </div>
    </ActivityItemCard>
  );
};
