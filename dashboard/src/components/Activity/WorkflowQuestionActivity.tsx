import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { HelpCircle } from 'lucide-react';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';

export const WorkflowQuestionActivity = ({
  activity,
  isExpanded,
  isSelected,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
  isSelected?: boolean;
}): ReactElement | null => {
  const workflowId = activity.actionSourceId;
  const ticketIdValue = activity.ticketId;
  const actorId = activity.actorId || 'system';
  const actor = useUser(actorId);
  const actorName = actor?.name || 'Xyne';
  const targetPath = ticketIdValue
    ? `/tickets/${ticketIdValue}/workflow/${workflowId}`
    : `/tickets`;

  const ticketTitle = activity.ticket?.title;
  const ticketXyneId = activity.ticket?.xyneId;

  const expandedContent = (
    <div className='flex flex-col gap-1 mt-2'>
      <div className='text-sm text-foreground font-medium'>
        A workflow needs your input to continue.
      </div>
      {ticketTitle && (
        <div className='text-xs text-muted-foreground break-words whitespace-normal'>
          Ticket: {ticketXyneId ? `${ticketXyneId} — ` : ''}
          {ticketTitle}
        </div>
      )}
    </div>
  );

  const condensedContent = (
    <span className='text-sm text-foreground'>
      <span className='font-semibold'>Workflow</span>
      <span className='text-muted-foreground'> needs your input</span>
    </span>
  );

  return (
    <ActivityItemCard
      activity={activity}
      actorId={actorId}
      actorName={actorName}
      channelId={undefined}
      badgeIcon={<HelpCircle className='w-4 h-4 text-amber-600' />}
      badgeColorClass='bg-amber-100'
      description={<span className='text-muted-foreground text-sm'>workflow needs input</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      isSelected={isSelected}
      actorAction={activity.actorAction}
    >
      {isExpanded ? expandedContent : condensedContent}
    </ActivityItemCard>
  );
};
