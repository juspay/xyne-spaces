import { PhoneDefault, CalendarDefault, ChevronDown } from '@xyne/icons';
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
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          className='group h-7 w-auto gap-0 rounded-lg border border-border p-0 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground'
          data-testid={testId}
          {...(trackCategory && { 'data-track-category': trackCategory })}
          {...(trackName && { 'data-track-name': trackName })}
          {...(trackMetadata && {
            'data-track-metadata': JSON.stringify(trackMetadata),
          })}
        >
          <Tooltip content={hasActiveCall ? 'Call already in progress' : callTooltip}>
            <span className='flex h-full items-center'>
              <span className='flex h-full items-center px-1.5'>
                <PhoneDefault size={16} />
              </span>
              <span className='h-full w-px bg-border' />
              <span className='flex h-full items-center px-1.5'>
                <ChevronDown
                  size={16}
                  className='transition-transform duration-200 group-data-[state=open]:rotate-180'
                />
              </span>
            </span>
          </Tooltip>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='end'
        side='bottom'
        sideOffset={6}
        className='rounded-xl p-1.5 shadow-sm text-muted-foreground'
      >
        <DropdownMenuItem
          onSelect={onStartCall}
          disabled={hasActiveCall}
          className='gap-1.5 rounded-lg font-medium'
        >
          <PhoneDefault size={16} />
          Start call
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onScheduleCall} className='gap-1.5 rounded-lg font-medium'>
          <CalendarDefault size={16} />
          Schedule Call
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
