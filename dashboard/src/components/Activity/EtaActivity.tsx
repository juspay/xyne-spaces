import { ReactElement } from 'react';
import { Activity } from '@xyne/shared';
import { useQuery } from '../../hooks/useQuery';
import { Ticket } from 'lucide-react';
import { format } from 'date-fns';
import { queries } from '../../zero/queries';
import { ActivityItemCard } from './ActivityItemCard';

interface EtaActivityProps {
  activity: Activity;
  isExpanded: boolean;
  isSelected?: boolean;
}

export const EtaActivity = ({
  activity,
  isExpanded,
  isSelected,
}: EtaActivityProps): ReactElement | null => {
  const [ticket] = useQuery(queries.ticketById({ ticketId: activity.actionSourceId }));
  const ticketXyneId = ticket?.xyneId || activity.actionSourceId;
  const etaDate = ticket?.eta ? new Date(ticket.eta) : null;
  const formattedDueDate = etaDate ? format(etaDate, 'MMM d, yyyy') : 'N/A';

  const isWarning = activity.actorAction === 'eta_warning';
  const isBreach = activity.actorAction === 'eta_breach';
  const isStageBreach = activity.actorAction === 'stage_eta_breach';

  if (!isWarning && !isBreach && !isStageBreach) {
    return null;
  }

  // On mobile: will navigate to minimized view with details tab
  // On desktop: will navigate to tab-based route in ConversationPannel
  const targetPath = `/chat/activity/${activity.channelId || ticket?.conversation?.channelId}/${ticket?.conversationId}/${activity.actionSourceId}?selectedTab=details`;
  const channelIdForPath = activity.channelId || ticket?.conversation?.channelId;
  const supportTargetPath =
    channelIdForPath && ticket?.conversationId
      ? `/support/${channelIdForPath}?conversationId=${ticket.conversationId}`
      : undefined;
  const stageName = ticket?.stageName || '';

  const expandedContent = (
    <div className='flex flex-col gap-1 mt-2'>
      <div className='text-sm text-foreground font-medium'>
        {isWarning
          ? `Ticket ${ticketXyneId} is due today. Please ensure it's completed or updated.`
          : isStageBreach
            ? `Ticket ${ticketXyneId} stage "${stageName}" is overdue. Please update the Status or Status Deadline.`
            : `Ticket ${ticketXyneId} is overdue. Please update the ticket's status or ETA.`}
      </div>
      {isBreach && (
        <div className='text-xs text-muted-foreground'>
          Action required: Ticket #{ticketXyneId} missed its deadline ({formattedDueDate}).
        </div>
      )}
    </div>
  );

  return (
    <ActivityItemCard
      activity={activity}
      actorId='system'
      actorName='Xyne'
      channelId={ticket?.conversation?.channelId}
      badgeIcon={
        <Ticket
          className={`w-4 h-4 ${isWarning ? 'text-yellow-600' : isStageBreach ? 'text-orange-600' : 'text-red-600'}`}
        />
      }
      badgeColorClass={isWarning ? 'bg-yellow-100' : isStageBreach ? 'bg-orange-100' : 'bg-red-100'}
      description={<span className='text-muted-foreground text-sm'>ticket in</span>}
      targetPath={targetPath}
      focusThread
      supportTargetPath={supportTargetPath}
      isExpanded={isExpanded}
      isSelected={isSelected}
    >
      {isExpanded ? (
        expandedContent
      ) : (
        <span className='text-sm text-foreground'>
          <span className='font-semibold'>{ticketXyneId}</span>
          <span className='text-muted-foreground'>
            {isWarning
              ? ' is due today'
              : isStageBreach
                ? ' stage deadline has passed'
                : ' deadline has passed'}
          </span>
        </span>
      )}
    </ActivityItemCard>
  );
};
