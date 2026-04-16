import { ReactElement, useState, useEffect, useMemo } from 'react';
import { Phone, Mic, MicOff } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import { formatDuration } from '../../../utils/dateUtils';

interface ParticipantInfo {
  identity: string;
  name?: string;
}

interface ActiveCall {
  externalId: string;
  startedAt: number;
}

interface MobileCallHeaderProps {
  participants: ParticipantInfo[];
  activeCalls: ActiveCall[];
  externalId: string;
  isMicEnabled: boolean;
  onToggleMic: () => void;
  onDisconnect: () => void;
  onExpand: () => void;
}

export function MobileCallHeader({
  participants,
  activeCalls,
  externalId,
  isMicEnabled,
  onToggleMic,
  onDisconnect,
  onExpand,
}: MobileCallHeaderProps): ReactElement {
  // Track call duration
  const [callDuration, setCallDuration] = useState('00:00');

  useEffect(() => {
    const activeCall = activeCalls.find(call => call.externalId === externalId);
    if (!activeCall?.startedAt) return;

    const updateDuration = (): void => {
      const duration = Date.now() - activeCall.startedAt;
      setCallDuration(formatDuration(duration));
    };

    updateDuration();
    const interval = setInterval(updateDuration, 1000);
    return (): void => clearInterval(interval);
  }, [activeCalls, externalId]);

  // Get participant name
  const participantName = useMemo(() => {
    if (participants.length === 0) return 'Connecting...';
    if (participants.length === 1) return participants[0]?.name || 'Unknown';
    if (participants.length === 2) {
      return `${participants[0]?.name || 'Unknown'}, ${participants[1]?.name || 'Unknown'}`;
    }

    const remaining = participants.length - 1;
    return `${participants[0]?.name || 'Unknown'} +${remaining} other${remaining > 1 ? 's' : ''}`;
  }, [participants]);

  return (
    <div className='md:hidden fixed top-0 left-0 right-0 z-[60] bg-background border-b border-border shadow-sm'>
      <div className='flex items-center justify-between px-3 py-2.5'>
        {/* Left: Mic Toggle */}
        <Button
          onClick={e => {
            e.stopPropagation();
            onToggleMic();
          }}
          variant='ghost'
          size='icon'
          className={cn(
            'flex-shrink-0 hover:bg-muted rounded-full',
            isMicEnabled ? 'bg-muted' : 'bg-destructive/10 hover:bg-destructive/20',
          )}
          title={isMicEnabled ? 'Mute' : 'Unmute'}
          data-track-category='CALLS'
          data-track-name='Mobile_Toggle_Mic'
          data-track-metadata={JSON.stringify({ enabled: isMicEnabled })}
        >
          {isMicEnabled ? (
            <Mic size={18} className='text-foreground' />
          ) : (
            <MicOff size={18} className='text-destructive' />
          )}
        </Button>

        {/* Center: Call Info */}
        <Button
          onClick={onExpand}
          variant='ghost'
          className='flex flex-col items-center justify-center flex-1 min-w-0 mx-3 h-auto py-0 hover:bg-muted rounded-full'
          data-track-category='CALLS'
          data-track-name='Mobile_Expand_Call'
        >
          <span className='text-[15px] font-medium truncate leading-tight w-full text-center text-foreground'>
            {participantName}
          </span>
          <span className='text-[13px] text-muted-foreground leading-tight'>{callDuration}</span>
        </Button>

        {/* Right: End Call */}
        <Button
          onClick={e => {
            e.stopPropagation();
            onDisconnect();
          }}
          variant='destructive'
          size='icon'
          className='flex-shrink-0 rounded-full'
          title='End call'
          data-track-category='CALLS'
          data-track-name='Mobile_End_Call'
        >
          <Phone size={18} className='rotate-[135deg]' />
        </Button>
      </div>
    </div>
  );
}
