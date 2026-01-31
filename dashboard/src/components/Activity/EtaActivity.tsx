import { ReactElement } from 'react';
import { Activity } from '@xyne/shared';
import { useQuery } from '@rocicorp/zero/react';
import { Ticket } from 'lucide-react';
import { format } from 'date-fns';
import { queries } from '../../zero/queries';
import { ActivityItemCard } from './ActivityItemCard';

interface EtaActivityProps {
  activity: Activity;
  isExpanded: boolean;
}

export const EtaActivity = ({ activity, isExpanded }: EtaActivityProps): ReactElement | null => {
  const [ticket] = useQuery(queries.ticketById({ ticketId: activity.actionSourceId }));
  const ticketXyneId = ticket?.xyneId || activity.actionSourceId;
  const etaDate = ticket?.eta ? new Date(ticket.eta) : null;
  const formattedDueDate = etaDate ? format(etaDate, 'MMM d, yyyy') : 'N/A';

  const isWarning = activity.actorAction === 'eta_warning';
  const isBreach = activity.actorAction === 'eta_breach';

  if (!isWarning && !isBreach) {
    return null;
  }

  const targetPath = `/chat/activity/${activity.channelId || ticket?.conversation?.channelId}?tab=tickets&ticketId=${activity.actionSourceId}&conversationId=${ticket?.conversationId}`;

  const expandedContent = (
    <div className='flex flex-col gap-1 mt-2'>
      <div className='text-sm text-[#181B1D] font-medium'>
        {isWarning
          ? `Ticket ${ticketXyneId} is due today. Please ensure it's completed or updated.`
          : `Ticket ${ticketXyneId} is overdue. Please update the ticket's status or ETA.`}
      </div>
      {isBreach && (
        <div className='text-xs text-[#505B62]'>
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
      badgeIcon={<Ticket className={`w-4 h-4 ${isWarning ? 'text-orange-600' : 'text-red-600'}`} />}
      badgeColorClass={isWarning ? 'bg-orange-100' : 'bg-red-100'}
      description={<span className='text-[#505B62] text-sm'>ticket in</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
    >
      {isExpanded ? (
        expandedContent
      ) : (
        <span className='text-sm text-[#181B1D]'>
          <span className='font-semibold'>{ticketXyneId}</span>
          <span className='text-[#505B62]'>
            {isWarning ? ' is due today.' : ' deadline has passed'}
          </span>
        </span>
      )}
    </ActivityItemCard>
  );
};
