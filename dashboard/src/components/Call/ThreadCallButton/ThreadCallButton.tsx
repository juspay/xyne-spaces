import { PhoneDefault, CalendarDefault } from '@xyne/icons';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui/dropdown-menu';

interface ThreadCallButtonProps {
  onStartCall: () => void;
  onScheduleCall: () => void;
  hasActiveCall?: boolean;
  callTooltip?: string;
  testId?: string;
  trackCategory?: string;
  trackName?: string;
  trackMetadata?: Record<string, unknown>;
}

/**
 * Call button for thread/conversation headers.
 * Matches the conversation-header action buttons (28px ghost, phone icon).
 * Clicking opens a dropdown with call options (Start call / Schedule Call).
 */
export const ThreadCallButton = ({
  onStartCall,
  onScheduleCall,
  hasActiveCall = false,
  callTooltip = 'Start thread call',
  testId = 'thread-initiate-call-button',
  trackCategory,
  trackName,
  trackMetadata,
}: ThreadCallButtonProps) => {
  return (
    <DropdownMenu>
      <Tooltip content={hasActiveCall ? 'Call already in progress' : callTooltip}>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            className='h-7 w-7 rounded-lg'
            data-testid={testId}
            {...(trackCategory && { 'data-track-category': trackCategory })}
            {...(trackName && { 'data-track-name': trackName })}
            {...(trackMetadata && {
              'data-track-metadata': JSON.stringify(trackMetadata),
            })}
          >
            <PhoneDefault size={16} />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align='end' side='bottom'>
        <DropdownMenuItem onSelect={onStartCall} disabled={hasActiveCall}>
          <PhoneDefault size={14} className='mr-2' />
          Start call
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onScheduleCall}>
          <CalendarDefault size={14} className='mr-2' />
          Schedule Call
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
