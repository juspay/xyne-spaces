import { ReactElement } from 'react';
import { ClipboardCheck, CheckCircle2, XCircle } from 'lucide-react';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';

interface StageApprovalActivityProps {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}

type ApprovalVariant = 'requested' | 'approved' | 'rejected';

const variantFromActorAction = (actorAction: string | null | undefined): ApprovalVariant | null => {
  switch (actorAction) {
    case 'stage_approval_requested':
      return 'requested';
    case 'stage_approval_approved':
      return 'approved';
    case 'stage_approval_rejected':
      return 'rejected';
    default:
      return null;
  }
};

const variantPresentation = (
  variant: ApprovalVariant,
): { icon: ReactElement; badgeBg: string; verb: string; preposition: string } => {
  switch (variant) {
    case 'requested':
      return {
        icon: <ClipboardCheck className='w-4 h-4 text-blue-600' />,
        badgeBg: 'bg-blue-100',
        verb: 'requested your approval for stage change on',
        preposition: 'in',
      };
    case 'approved':
      return {
        icon: <CheckCircle2 className='w-4 h-4 text-green-600' />,
        badgeBg: 'bg-green-100',
        verb: 'approved your stage change on',
        preposition: 'in',
      };
    case 'rejected':
      return {
        icon: <XCircle className='w-4 h-4 text-red-600' />,
        badgeBg: 'bg-red-100',
        verb: 'rejected your stage change on',
        preposition: 'in',
      };
  }
};

export const StageApprovalActivity = ({
  activity,
  isExpanded,
}: StageApprovalActivityProps): ReactElement | null => {
  // All hooks must run unconditionally before any early returns (React rule of
  // hooks). Same pattern as TicketAssignmentActivity.
  const actorId = activity.actorId || 'system';
  const actor = useUser(actorId);
  const actorName = actor?.name || 'Xyne';

  const variant = variantFromActorAction(activity.actorAction);
  const ticket = activity.ticket;

  if (!variant) return null;
  if (!ticket) return null;

  const presentation = variantPresentation(variant);
  const ticketXyneId = ticket.xyneId || activity.ticketId || activity.actionSourceId;
  const ticketIdValue = activity.ticketId || activity.actionSourceId;

  const targetPath = `/chat/activity/${ticket.channelId}/${ticket.conversationId}/${ticketIdValue}?selectedTab=details`;
  const supportTargetPath =
    ticket.channelId && ticket.conversationId
      ? `/support/${ticket.channelId}?conversationId=${ticket.conversationId}`
      : undefined;

  const headline =
    variant === 'requested'
      ? `Approval requested on "${ticket.title}"`
      : variant === 'approved'
        ? `Stage change approved on "${ticket.title}"`
        : `Stage change rejected on "${ticket.title}"`;

  const expandedContent = (
    <div className='flex flex-col gap-1 mt-2'>
      <div className='text-sm text-foreground font-medium break-words whitespace-normal'>
        {headline}
      </div>
      <div className='text-xs text-muted-foreground break-words whitespace-normal'>
        Ticket ID: <span className='font-mono'>{ticketXyneId}</span>
      </div>
    </div>
  );

  const condensedContent = (
    <span className='text-sm text-foreground'>
      <span className='font-semibold'>{ticketXyneId}</span>
      <span className='text-muted-foreground'>
        {variant === 'requested'
          ? ' awaiting your approval'
          : variant === 'approved'
            ? ' stage change approved'
            : ' stage change rejected'}
      </span>
    </span>
  );

  const description = (
    <span className='text-muted-foreground text-sm'>
      {presentation.verb} ticket {presentation.preposition}
    </span>
  );

  return (
    <ActivityItemCard
      activity={activity}
      actorId={actorId}
      actorName={actorName}
      channelId={ticket.channelId}
      badgeIcon={presentation.icon}
      badgeColorClass={presentation.badgeBg}
      description={description}
      targetPath={targetPath}
      focusThread
      supportTargetPath={supportTargetPath}
      isExpanded={isExpanded}
    >
      {isExpanded ? expandedContent : condensedContent}
    </ActivityItemCard>
  );
};
