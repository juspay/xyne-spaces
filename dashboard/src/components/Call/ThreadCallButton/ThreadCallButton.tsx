import { Headphones, ChevronDown, Calendar } from 'lucide-react';
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
 * Split-button for thread/conversation headers.
 * Left side: instant call (headphone icon).
 * Right side: chevron dropdown → Schedule Call.
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
    <div className='flex items-center border border-border rounded-lg overflow-hidden h-8'>
      <Tooltip content={hasActiveCall ? 'Call already in progress' : callTooltip}>
        <span className='inline-flex cursor-pointer'>
          <Button
            variant='ghost'
            className='p-2 rounded-none rounded-l-lg h-8 w-8 border-0 border-r border-border'
            size='sm'
            onClick={onStartCall}
            disabled={hasActiveCall}
            data-testid={testId}
            {...(trackCategory && { 'data-track-category': trackCategory })}
            {...(trackName && { 'data-track-name': trackName })}
            {...(trackMetadata && {
              'data-track-metadata': JSON.stringify(trackMetadata),
            })}
          >
            <Headphones size={20} />
          </Button>
        </span>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className='flex items-center justify-center h-8 w-5 px-1 hover:bg-accent transition-colors'
            aria-label='More call options'
          >
            <ChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' side='bottom'>
          <DropdownMenuItem onSelect={onScheduleCall}>
            <Calendar size={14} className='mr-2' />
            Schedule Call
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
