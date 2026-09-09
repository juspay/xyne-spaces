import { logger, Event as LogEvent } from '../../utils/logger';
import { ReactElement } from 'react';
import { CalendarClock, Calendar, Clock, User } from 'lucide-react';
import { cn } from '../../utils/classNames';
import { useChannel } from '../../hooks/useChannels';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { RenderMessageWithHTML } from '../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import type { ScheduledMessage } from '../../services/scheduledMessageService';

interface ScheduledMessageCardProps {
  scheduledMessage: ScheduledMessage;
  onClick: () => void;
}

const ScheduledMessageCard = ({
  scheduledMessage,
  onClick,
}: ScheduledMessageCardProps): ReactElement => {
  // Fetch channel by ID to get the name
  const channel = useChannel(scheduledMessage?.channelId ?? '');

  // Fetch creator user to display name
  const creatorUser = useUser(scheduledMessage?.createdBy ?? '');

  if (!scheduledMessage) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[ScheduledMessageCard] Scheduled message is undefined'),
    });
    return <div>Invalid scheduled message data</div>;
  }

  const channelName = channel?.name ?? scheduledMessage.channelId ?? 'Unknown Channel';

  const formatDays = (daysOfWeek: string): string => {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = daysOfWeek.split(',').map(d => dayNames[Number(d)]);

    if (daysOfWeek === '1,2,3,4,5') {
      return 'Weekdays (Mon-Fri)';
    }

    if (daysOfWeek === '0,1,2,3,4,5,6') {
      return 'Every day';
    }

    return days.join(', ');
  };

  // Convert UTC time to IST (UTC+5:30)
  const convertUTCtoIST = (utcTime: string): string => {
    const [hours, minutes] = utcTime.split(':').map(Number);
    const utcDate = new Date();
    utcDate.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);

    // IST is UTC+5:30
    const istDate = new Date(utcDate.getTime() + 5.5 * 60 * 60 * 1000);

    const istHours = istDate.getUTCHours().toString().padStart(2, '0');
    const istMinutes = istDate.getUTCMinutes().toString().padStart(2, '0');

    return `${istHours}:${istMinutes}`;
  };

  const scheduleText = formatDays(scheduledMessage.daysOfWeek);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'bg-card rounded-lg border border-border p-4 cursor-pointer',
        'hover:border-primary transition-colors',
        !scheduledMessage.isActive && 'opacity-50',
      )}
      data-track-category='scheduled-message'
      data-track-name='OpenScheduledMessage'
      data-track-metadata={JSON.stringify({
        messageId: scheduledMessage.id,
        channelId: scheduledMessage.channelId,
      })}
    >
      <div className='flex items-start justify-between mb-2'>
        <div className='flex items-center gap-2'>
          <CalendarClock className='h-4 w-4 text-primary' />
          <h3 className='font-semibold text-foreground'>{scheduledMessage.title}</h3>
        </div>
        {!scheduledMessage.isActive && (
          <span className='text-xs bg-muted text-muted-foreground px-2 py-1 rounded'>Inactive</span>
        )}
      </div>

      <div className='text-sm text-muted-foreground mb-3 line-clamp-2'>
        <RenderMessageWithHTML message={scheduledMessage.messageContent} />
      </div>

      <div className='space-y-1 text-xs text-muted-foreground'>
        <div className='flex items-center gap-2'>
          <span className='font-medium'>{channelName}</span>
        </div>
        <div className='flex items-center gap-2'>
          <User className='h-3 w-3' />
          <span>{getUserDisplayName(creatorUser)}</span>
        </div>
        <div className='flex items-center gap-2'>
          <Calendar className='h-3 w-3' />
          <span>{scheduleText}</span>
        </div>
        <div className='flex items-center gap-2'>
          <Clock className='h-3 w-3' />
          <span>{convertUTCtoIST(scheduledMessage.scheduledTime)} IST</span>
        </div>
      </div>
    </div>
  );
};

export default ScheduledMessageCard;
